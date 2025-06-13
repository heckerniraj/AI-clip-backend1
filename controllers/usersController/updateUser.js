const User = require("../../model/usersSchema");

const updateUser = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!user) {
            return res.status(404).json({ message: 'User not found' , status : false });
        }
        res.status(200).json({ status : true , message : "User updated successfully", user });
    } catch (error) {
        res.status(500).json({ message: 'Error updating user', error: error.message, status : false });
    }
};

module.exports = updateUser;
