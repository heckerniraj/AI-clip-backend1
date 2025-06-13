const Clip = require("../../model/clipsSchema");

const getClips = async (req, res) => {
    try {
        const clips = await Clip.find({ videoID: req.params.videoID });
        if (clips.length === 0) {
            return res.status(404).json({ message: 'No clips found for this video ID', status: false });
        }
        res.status(200).json({ status: true, message: "Clips retrieved successfully", clips });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving clips', error: error.message, status: false });
    }
};

module.exports = getClips;
