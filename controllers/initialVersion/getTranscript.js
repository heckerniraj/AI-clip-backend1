const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const NodeCache = require('node-cache');
require('dotenv').config();

// Initialize cache with 1-hour TTL for successful transcripts, 15-minute TTL for failures
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Initialize OAuth2 client (for private operations if needed)
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI || 'https://ai-clip-backend1-1.onrender.com/api/v1/youtube/oauth2callback'
);

// Set up YouTube API client
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY // Default to API key for public operations
});

// Utility function for logging errors with more detail
const logError = (message, error, metadata = {}) => {
    console.error(message, {
        error: error.message,
        code: error.code,
        stack: error.stack,
        ...metadata
    });
};

// Fallback to youtube-transcript library
async function fetchTranscriptFallback(videoId) {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, { 
            lang: 'en',
            timeout: 20000 // 20-second timeout
        });
        return transcript.map(item => ({
            text: item.text,
            start: item.offset / 1000,
            duration: item.duration / 1000
        }));
    } catch (error) {
        logError("YouTube Transcript fallback failed:", error, { videoId });
        throw error;
    }
}

const getTranscript = async (req, res) => {
    const { videoId } = req.params;
    console.log(`Processing video ID: ${videoId}`);

    try {
        // Validate input
        if (!videoId) {
            return res.status(400).json({ 
                message: "Video ID is required", 
                status: false 
            });
        }

        // Check if API key is available
        if (!process.env.YOUTUBE_API_KEY) {
            return res.status(500).json({ 
                message: "YouTube API key is missing in server configuration", 
                status: false 
            });
        }

        // Check cache
        const cached = cache.get(videoId);
        if (cached !== undefined) {
            if (cached.noTranscript) {
                return res.status(404).json({ 
                    message: "No transcript available for this video (cached).", 
                    status: false 
                });
            } else if (cached.rateLimited || cached.timeout) {
                return res.status(429).json({ 
                    message: cached.rateLimited 
                        ? "Rate limit exceeded. Please try again later." 
                        : "Request timed out. Please try again later.",
                    status: false,
                    retryAfter: 900 // Suggest retrying after 15 minutes
                });
            } else {
                return res.status(200).json({
                    message: "Transcript fetched from cache",
                    data: cached,
                    status: true,
                    totalSegments: cached.length
                });
            }
        }

        // Verify video exists using API key
        try {
            const videoResponse = await youtube.videos.list({
                part: 'snippet',
                id: videoId,
                requestTimeout: 15000 // 15-second timeout
            });

            if (!videoResponse.data.items?.length) {
                cache.set(videoId, { noTranscript: true }, 900); // Cache for 15 minutes
                return res.status(404).json({ 
                    message: "Video not found", 
                    status: false 
                });
            }
            console.log(`Video found: ${videoResponse.data.items[0].snippet.title}`);
        } catch (error) {
            logError("Error checking video existence:", error, { videoId });
            if (error.code === 'ECONNABORTED') {
                cache.set(videoId, { timeout: true }, 900);
                return res.status(429).json({
                    message: "Request timed out while verifying video. Please try again later.",
                    status: false,
                    retryAfter: 900
                });
            }
            return res.status(500).json({
                message: "Failed to verify video existence",
                error: error.message,
                status: false
            });
        }

        // Set OAuth2 credentials if provided (for private operations)
        if (req.headers.authorization) {
            const token = req.headers.authorization.replace('Bearer ', '');
            oauth2Client.setCredentials({ access_token: token });
            youtube.auth = oauth2Client; // Switch to OAuth2 for this request
        }

        // Fetch transcript (using API key or OAuth2 based on auth setup)
        try {
            const captionsResponse = await youtube.captions.list({
                part: 'snippet',
                videoId,
                requestTimeout: 15000 // 15-second timeout
            });

            const captionTrack = captionsResponse.data.items.find(
                item => item.snippet.language === 'en' || item.snippet.language === 'en-US'
            );

            if (!captionTrack) {
                // Fallback to youtube-transcript library
                try {
                    const transcript = await fetchTranscriptFallback(videoId);
                    cache.set(videoId, transcript);
                    return res.status(200).json({
                        message: "Transcript fetched successfully (fallback)",
                        data: transcript,
                        status: true,
                        totalSegments: transcript.length
                    });
                } catch (fallbackError) {
                    cache.set(videoId, { noTranscript: true }, 900);
                    return res.status(404).json({
                        message: "No English transcript available for this video.",
                        status: false
                    });
                }
            }

            // Switch to OAuth2 for downloading captions if token is provided
            if (req.headers.authorization) {
                youtube.auth = oauth2Client;
            }

            const transcriptResponse = await youtube.captions.download({
                id: captionTrack.id,
                tfmt: 'srt',
                requestTimeout: 15000 // 15-second timeout
            });

            const srtData = transcriptResponse.data;
            const transcript = [];
            const lines = srtData.split('\n\n');
            for (const block of lines) {
                const match = block.match(/(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n([\s\S]*)/);
                if (match) {
                    const [, , startTime, endTime, text] = match;
                    const startSeconds = parseSrtTime(startTime);
                    const endSeconds = parseSrtTime(endTime);
                    transcript.push({
                        text: text.replace(/\n/g, ' ').trim(),
                        start: startSeconds,
                        duration: endSeconds - startSeconds
                    });
                }
            }

            if (transcript.length === 0) {
                cache.set(videoId, { noTranscript: true }, 900);
                return res.status(404).json({
                    message: "No transcript available after parsing.",
                    status: false
                });
            }

            cache.set(videoId, transcript);
            return res.status(200).json({
                message: "Transcript fetched successfully",
                data: transcript,
                status: true,
                totalSegments: transcript.length
            });
        } catch (error) {
            logError("Transcript fetch failed:", error, { videoId });
            if (error.message.includes("quota")) {
                cache.set(videoId, { rateLimited: true }, 900);
                return res.status(429).json({
                    message: "YouTube API quota exceeded. Please try again later.",
                    status: false,
                    retryAfter: 900
                });
            }
            // Fallback to youtube-transcript library
            try {
                const transcript = await fetchTranscriptFallback(videoId);
                cache.set(videoId, transcript);
                return res.status(200).json({
                    message: "Transcript fetched successfully (fallback)",
                    data: transcript,
                    status: true,
                    totalSegments: transcript.length
                });
            } catch (fallbackError) {
                cache.set(videoId, { noTranscript: true }, 900);
                return res.status(404).json({
                    message: "No transcript available for this video.",
                    status: false
                });
            }
        }
    } catch (error) {
        logError("Unexpected error:", error, { videoId });
        return res.status(500).json({
            message: "Failed to fetch transcript",
            error: error.message,
            status: false
        });
    }
};

// Helper function to parse SRT time format to seconds
function parseSrtTime(timeStr) {
    const [hours, minutes, seconds] = timeStr.split(/[:,]/).map(Number);
    return hours * 3600 + minutes * 60 + seconds + (Number(timeStr.split(',')[1]) / 1000);
}

module.exports = { getTranscript };