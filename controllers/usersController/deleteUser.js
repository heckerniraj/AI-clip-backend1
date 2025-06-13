const deleteUser = async (req, res) => {
    try{
        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ status : true , message: "User deleted successfully"});
    }
    catch(err){
        res.status(500).json({ status : false , message : "Failed to delete user", error : err.message });
    }
};

module.exports = deleteUser;