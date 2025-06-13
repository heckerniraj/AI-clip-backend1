const SavedVideo = require("../../model/savedVideosSchema");

const saveVideo = async (req, res) => {
    try {
        const { userId, videoId } = req.body;
        const saved = await SavedVideo.create({ userId, videoId });
        res.status(201).json({ status: true, message: "Video saved successfully", saved });
    } catch (error) {
        res.status(500).json({ message: 'Error saving video', error: error.message, status: false });
    }
};

module.exports = saveVideo;
