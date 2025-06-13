const Video = require("../../model/videosSchema");

const uploadVideo = async (req, res) => {
    try {
        const { userId, title, description, videoUrl } = req.body;
        const video = await Video.create({ userId, title, description, videoUrl });
        res.status(201).json({ status: true, message: "Video uploaded successfully", video });
    } catch (error) {
        res.status(500).json({ message: 'Error uploading video', error: error.message, status: false });
    }
};

module.exports = uploadVideo;
