const getVideoById = async (req, res) => {
    const video = await Video.findById(req.params.id);
    res.status(200).json(video);
};

module.exports = getVideoById;
