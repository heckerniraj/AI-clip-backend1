const mongoose = require("mongoose");

const publishedVideosSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.Mixed, // Changed from ObjectId to Mixed to support both ObjectId and string
        ref: "User", 
        required: true 
    },
    title: { type: String, required: true },
    description: { type: String },
    videoUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    // Optional reference to the project
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }
});

module.exports = mongoose.model("PublishedVideo", publishedVideosSchema); 