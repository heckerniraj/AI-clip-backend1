const PublishedVideo = require("../../model/publishedVideosSchema");

const publishVideo = async (req, res) => {
    try {
        const { userId, title, description, videoUrl, thumbnailUrl, clipsData, promptContext, videoIds } = req.body;
        const publishedVideo = await PublishedVideo.create({ 
            userId, 
            title, 
            description, 
            videoUrl,
            thumbnailUrl: thumbnailUrl || "",
            clipsData: clipsData || [],
            promptContext: promptContext || "",
            videoIds: videoIds || []
        });
        res.status(201).json({ status: true, message: "Video published successfully", publishedVideo });
    } catch (error) {
        res.status(500).json({ message: 'Error publishing video', error: error.message, status: false });
    }
};

module.exports = publishVideo;