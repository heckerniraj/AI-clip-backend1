const PublishedVideo = require("../../model/finalVideosSchema");

const getPublishedVideosByUserID = async (req, res) => {
    try{
        const { userId } = req.params;
        const publishedVideos = await PublishedVideo.find({ userId });
        if(publishedVideos.length === 0){
            return res.status(404).json({ message : "No published videos found" , status : false});
        }
        res.status(200).json({ publishedVideos  , status : true , message : "Published videos retrieved successfully"});
    }
catch(err){
    res.status(500).json({ message : "Internal server error" , error : err.message , status : false});
}}

module.exports = getPublishedVideosByUserID;