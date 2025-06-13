const { google } = require('googleapis');
const youtube = google.youtube('v3');

const extractVideoId = (videoId) => {
    if (!videoId) return null;
    
    // If it's already just a video ID, return it
    if (videoId.length === 11) return videoId;

    // Try to extract from various YouTube URL formats
    const urlPatterns = [
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]+)/
    ];

    for (const pattern of urlPatterns) {
        const match = videoId.match(pattern);
        if (match) return match[1];
    }
    return null;
};

const getDetailsByVideoID = async (req, res) => {
    try {
        let { videoId } = req.params;

        const extractedVideoId = extractVideoId(videoId);

        if (!extractedVideoId) {
            return res.status(400).json({
                message: "Invalid video ID or URL format",
                status: false
            });
        }

        if (!process.env.YOUTUBE_API_KEY) {
            return res.status(400).json({
                message: "YouTube API key is not configured",
                status: false
            });
        }

        const response = await youtube.videos.list({
            key: process.env.YOUTUBE_API_KEY,
            part: 'snippet,contentDetails,statistics',
            id: extractedVideoId
        });

        if (!response.data.items || response.data.items.length === 0) {
            return res.status(404).json({
                message: "Video not found",
                status: false
            });
        }

        const videoDetails = response.data.items[0];
        const formattedResponse = {
            id: videoDetails.id,
            title: videoDetails.snippet.title,
            description: videoDetails.snippet.description,
            publishedAt: videoDetails.snippet.publishedAt,
            thumbnails: videoDetails.snippet.thumbnails,
            channelTitle: videoDetails.snippet.channelTitle,
            channelId: videoDetails.snippet.channelId,
            duration: videoDetails.contentDetails.duration,
            viewCount: videoDetails.statistics.viewCount,
            likeCount: videoDetails.statistics.likeCount,
            commentCount: videoDetails.statistics.commentCount
        };

        // console.log(formattedResponse);
        res.status(200).json({
            message: "Video details fetched successfully",
            data: formattedResponse,
            status: true
        });
    }
    catch (error) {
        // console.log(error);
        res.status(500).json({ message: "Internal server error", error: error.message, status: false });
    }
}

module.exports = getDetailsByVideoID;
