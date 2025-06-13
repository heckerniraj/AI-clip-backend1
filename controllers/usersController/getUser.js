const User = require("../../model/usersSchema");

const getUser = async (req, res) => {
    try{
        const user = await User.findById(req.params.id);
        if(!user){
            return res.status(404).json({ message : "User not found" , status : false});
        }
        res.status(200).json({ status : true , message : "User fetched successfully", user });
    }
    catch(err){
        res.status(500).json({ status : false , message : "Failed to get user", error : err.message });
    }
};

module.exports = getUser;
