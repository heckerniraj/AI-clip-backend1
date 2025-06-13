const Transcript = require("../../model/transcriptsSchema");

const generateTranscript = async (req, res) => {
    try {
        const { videoId, transcript } = req.body;
        const newTranscript = await Transcript.create({ videoId, transcript });
        res.status(201).json({ status: true, message: "Transcript generated successfully", newTranscript });
    } catch (error) {
        res.status(500).json({ message: 'Error generating transcript', error: error.message, status: false });
    }
};

module.exports = generateTranscript;
