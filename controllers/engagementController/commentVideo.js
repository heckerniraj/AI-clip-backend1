const Comment = require("../../model/commentsSchema");

const addComment = async (req, res) => {
    try {
        const { userId, videoId, comment } = req.body;
        const newComment = await Comment.create({ userId, videoId, comment });
        res.status(201).json({ status: true, message: "Comment added successfully", newComment });
    } catch (error) {
        res.status(500).json({ message: 'Error adding comment', error: error.message, status: false });
    }
};

module.exports = addComment;
