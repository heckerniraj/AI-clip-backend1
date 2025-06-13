const Clip = require("../../model/clipsSchema");

const updateClip = async (req, res) => {
    try {
        const { id } = req.params;
        const clip = await Clip.findByIdAndUpdate(id, req.body, { new: true });
        if (!clip) {
            return res.status(404).json({ message: 'Clip not found', status: false });
        }
        res.status(200).json({ status: true, message: "Clip updated successfully", clip });
    } catch (error) {
        res.status(500).json({ message: 'Error updating clip', error: error.message, status: false });
    }
};

module.exports = updateClip;