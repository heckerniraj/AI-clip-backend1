const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
const NodeCache = require('node-cache');
require('dotenv').config();

// Initialize cache with 1-hour TTL for successful transcripts, 5-minute TTL for failures
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// Utility function for logging errors with more detail
const logError = (message, error, metadata = {}) => {
    console.error(message, {
        error: error.message,
        stack: error.stack,
        ...metadata
    });
};

const getTranscript = async (req, res) => {
    const { videoId } = req.params;
    console.log(`Processing video ID: ${videoId}`);

    try {
        // **Validate input**
        if (!videoId) {
            return res.status(400).json({ 
                message: "Video ID is required", 
                status: false 
            });
        }

        if (!process.env.YOUTUBE_API_KEY) {
            return res.status(500).json({ 
                message: "YouTube API key missing", 
                status: false 
            });
        }

        // **Check cache**
        const cached = cache.get(videoId);
        if (cached !== undefined) {
            if (cached.noTranscript) {
                return res.status(404).json({ 
                    message: "No transcript available for this video (cached).", 
                    status: false 
                });
            } else if (cached.rateLimited) {
                return res.status(429).json({ 
                    message: "Rate limit exceeded. Please try again later.", 
                    status: false,
                    retryAfter: 300 // Suggest retrying after 5 minutes
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

        // **Verify video exists**
        try {
            const videoResponse = await youtube.videos.list({
                part: 'snippet',
                id: videoId
            });

            if (!videoResponse.data.items?.length) {
                cache.set(videoId, { noTranscript: true }, 300); // Cache for 5 minutes
                return res.status(404).json({ 
                    message: "Video not found", 
                    status: false 
                });
            }
            console.log(`Video found: ${videoResponse.data.items[0].snippet.title}`);
        } catch (error) {
            logError("Error checking video existence:", error, { videoId });
            return res.status(500).json({
                message: "Failed to verify video existence",
                error: error.message,
                status: false
            });
        }

        // **Fetch transcript with retry logic**
        const maxRetries = 3;
        let transcript;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
                console.log(`Transcript fetched successfully on attempt ${attempt}`);
                break;
            } catch (error) {
                lastError = error;
                logError(`Transcript fetch failed on attempt ${attempt}:`, error, { videoId });
                if (attempt < maxRetries) {
                    const delay = 2000 * attempt; // Exponential backoff: 2s, 4s, 6s
                    console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // **Handle fetch result**
        if (transcript && transcript.length > 0) {
            const formattedTranscript = transcript.map(item => ({
                text: item.text,
                start: item.offset / 1000, // Convert ms to seconds
                duration: item.duration / 1000 // Convert ms to seconds
            }));
            cache.set(videoId, formattedTranscript); // Cache successful result
            return res.status(200).json({
                message: "Transcript fetched successfully",
                data: formattedTranscript,
                status: true,
                totalSegments: formattedTranscript.length
            });
        } else {
            const errorMessage = lastError?.message?.toLowerCase() || "";
            if (errorMessage.includes("no transcript") || errorMessage.includes("transcript not found")) {
                cache.set(videoId, { noTranscript: true }, 300); // Cache for 5 minutes
                return res.status(404).json({
                    message: "No transcript available for this video.",
                    status: false
                });
            } else if (errorMessage.includes("too many requests")) {
                cache.set(videoId, { rateLimited: true }, 300); // Cache for 5 minutes
                return res.status(429).json({
                    message: "Rate limit exceeded. Please try again later.",
                    status: false,
                    retryAfter: 300 // Suggest retrying after 5 minutes
                });
            } else {
                return res.status(500).json({
                    message: "Failed to fetch transcript",
                    error: lastError?.message || "Unknown error",
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

module.exports = { getTranscript };