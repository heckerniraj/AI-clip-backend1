const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const PYTHON_API = process.env.PYTHON_API || 'https://clip-py-backend-1.onrender.com';
const APPLICATION_URL = process.env.APPLICATION_URL || 'https://clip-backend-f93c.onrender.com';

// Configure global settings for Google APIs
google.options({
    http2: true,
    headers: {
        'Referer': APPLICATION_URL,
        'Origin': APPLICATION_URL
    }
});

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${APPLICATION_URL}/api/v1/youtube/oauth2callback`
);

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

axios.defaults.headers.common['Referer'] = APPLICATION_URL;
axios.defaults.headers.common['Origin'] = APPLICATION_URL;

function getAuthUrl() {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl']
    });
}

async function fetchYoutubeTranscriptDirectly(videoId, lang = 'en') {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: lang
        });
        return {
            transcript: transcript.map(item => ({
                text: item.text,
                start: item.offset / 1000, // Convert ms to seconds
                duration: item.duration / 1000 // Convert ms to seconds
            })),
            source: 'youtube-transcript',
            language: lang
        };
    } catch (error) {
        console.error(`YouTube-transcript error (${lang}): [YoutubeTranscript] ${error.message}`);
        return null;
    }
}

async function fetchFromPythonAPI(videoId) {
    try {
        if (!PYTHON_API) {
            throw new Error('Python API URL not configured');
        }
        const response = await axios.get(`${PYTHON_API}/transcript/${videoId}`);
        return {
            transcript: response.data?.data || null,
            source: 'python-api',
            language: 'en'
        };
    } catch (error) {
        console.error('Python API error:', error.message);
        return null;
    }
}

async function fetchVideoDescription(videoId) {
    try {
        const response = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        });
        
        if (!response.data.items?.length) {
            return null;
        }
        
        const description = response.data.items[0].snippet.description;
        if (!description) {
            return null;
        }
        
        // Return as a single "segment" with the entire description
        return {
            transcript: [{
                text: description,
                start: 0,
                duration: 0 // Duration unknown for description
            }],
            source: 'video-description',
            language: 'en'
        };
    } catch (error) {
        console.error('Error fetching video description:', error.message);
        return null;
    }
}

const getTranscript = async (req, res) => {
    try {
        const { videoId } = req.params;
        console.log("---->", videoId);

        // Validate input
        if (!videoId) {
            return res.status(400).json({
                message: "Video ID is required",
                status: false
            });
        }

        if (!process.env.YOUTUBE_API_KEY) {
            return res.status(500).json({
                message: "Server configuration error: YouTube API key is missing",
                status: false
            });
        }

        // Verify video exists and get title
        let videoTitle = 'Unknown Video';
        try {
            const videoResponse = await youtube.videos.list({
                part: 'snippet',
                id: videoId
            });

            if (!videoResponse.data.items?.length) {
                return res.status(404).json({
                    message: "Video not found or is not accessible",
                    status: false
                });
            }
            
            videoTitle = videoResponse.data.items[0].snippet.title;
            console.log(`Video found: ${videoTitle}`);
        } catch (error) {
            console.error("Error checking video existence:", error.message);
            return res.status(500).json({
                message: "Failed to verify video existence",
                error: error.message,
                status: false
            });
        }

        // Attempt to fetch transcript using multiple methods
        const methods = [
            { name: 'Python API', fn: () => fetchFromPythonAPI(videoId) },
            { name: 'YouTube Transcript (English)', fn: () => fetchYoutubeTranscriptDirectly(videoId, 'en') },
            { name: 'YouTube Transcript (any language)', fn: () => fetchYoutubeTranscriptDirectly(videoId) },
            { name: 'Video Description', fn: () => fetchVideoDescription(videoId) }
        ];

        let result = null;
        let successfulMethod = null;
        
        for (const method of methods) {
            console.log(`Trying ${method.name}...`);
            result = await method.fn();
            if (result && result.transcript && result.transcript.length > 0) {
                successfulMethod = method.name;
                console.log(`Success with ${method.name}`);
                break;
            }
        }

        if (!result || !result.transcript || result.transcript.length === 0) {
            return res.status(404).json({
                message: "No transcript available for this video. The video might not have captions enabled and no description available.",
                status: false,
                videoTitle: videoTitle,
                availableMethodsTried: methods.map(m => m.name)
            });
        }

        return res.status(200).json({
            message: "Transcript fetched successfully",
            data: result.transcript,
            status: true,
            totalSegments: result.transcript.length,
            metadata: {
                videoId,
                videoTitle,
                source: result.source,
                language: result.language || 'en',
                isAutoGenerated: result.source !== 'video-description'
            }
        });

    } catch (error) {
        console.error("Unexpected error:", {
            message: error.message,
            stack: error.stack,
            videoId: req.params.videoId
        });

        return res.status(500).json({
            message: "Failed to fetch transcript",
            error: error.message,
            status: false
        });
    }
};

module.exports = { getTranscript, getAuthUrl, oauth2Client };