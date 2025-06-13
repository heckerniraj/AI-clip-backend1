const Like = require("../../model/likesSchema");

const likeVideo = async (req, res) => {
    try {
        const { userId, videoId } = req.body;
        const like = await Like.create({ userId, videoId });
        res.status(201).json({ status: true, message: "Video liked successfully", like });
    } catch (error) {
        res.status(500).json({ message: 'Error liking video', error: error.message, status: false });
    }
};

module.exports = likeVideo;
