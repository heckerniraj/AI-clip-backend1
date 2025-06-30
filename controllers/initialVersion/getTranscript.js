const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript');
require('dotenv').config();

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

const getTranscript = async (req, res) => {
    try {
        const { videoId } = req.params;
        console.log("Processing video ID:", videoId);

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

        // **Verify video exists**
        const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        });

        if (!videoResponse.data.items?.length) {
            return res.status(404).json({ 
                message: "Video not found", 
                status: false 
            });
        }
        console.log(`Video found: ${videoResponse.data.items[0].snippet.title}`);

        // **Fetch transcript using YoutubeTranscript**
        let transcript;
        try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId);
            console.log("Transcript fetched successfully");
        } catch (error) {
            console.error("YouTube Transcript error:", error.message);
            return res.status(404).json({
                message: "No transcript available for this video.",
                status: false
            });
        }

        if (!transcript || transcript.length === 0) {
            return res.status(404).json({
                message: "No transcript available for this video.",
                status: false
            });
        }

        // **Format the transcript**
        const formattedTranscript = transcript.map(item => ({
            text: item.text,
            start: item.offset / 1000, // Convert ms to seconds
            duration: item.duration / 1000 // Convert ms to seconds
        }));

        // **Return successful response**
        return res.status(200).json({
            message: "Transcript fetched successfully",
            data: formattedTranscript,
            status: true,
            totalSegments: formattedTranscript.length
        });
    } catch (error) {
        console.error("Unexpected error:", error.message);
        return res.status(500).json({
            message: "Failed to fetch transcript",
            error: error.message,
            status: false
        });
    }
};

module.exports = { getTranscript };