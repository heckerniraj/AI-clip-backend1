const deleteVideo = async (req, res) => {
    await Video.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Video deleted successfully" });
};

module.exports = deleteVideo;
