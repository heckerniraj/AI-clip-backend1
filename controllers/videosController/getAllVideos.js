const Video = require("../../model/videosSchema");

const getAllVideos = async (req, res) => {
    const videos = await Video.find();
    res.status(200).json(videos);
};

module.exports = getAllVideos;
