const Clip = require("../../model/clipsSchema");

const deleteClip = async (req, res) => {
    try {
        const { id } = req.params;
        const clip = await Clip.findByIdAndDelete(id);
        if (!clip) {
            return res.status(404).json({ message: 'Clip not found', status: false });
        }
        res.status(200).json({ status: true, message: 'Clip deleted successfully', clip });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting clip', error: error.message, status: false });
    }
};

module.exports = deleteClip;
 