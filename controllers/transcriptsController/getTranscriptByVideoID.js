const Transcript = require("../../model/transcriptsSchema");

const getTranscript = async (req, res) => {
    try {
        const transcript = await Transcript.findOne({ videoId: req.params.videoId });
        if (!transcript) {
            return res.status(404).json({ message: 'Transcript not found for this video ID', status: false });
        }
        res.status(200).json({ status: true, message: "Transcript retrieved successfully", transcript });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving transcript', error: error.message, status: false });
    }
};

module.exports = getTranscript;
