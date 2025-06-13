const mongoose = require("mongoose");

const finalVideosSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    jobId: { type: String },
    duration: { type: Number },
    s3Url: { type: String, required: true },
    thumbnailUrl: { type: String },
    userEmail: { type: String },
    userName: { type: String },
    sourceClips: [
        {
            videoId: { type: String },
            title: { type: String },
            startTime: { type: Number },
            endTime: { type: Number },
            duration: { type: Number },
            thumbnail: { type: String },
            originalVideoTitle: { type: String }
        }
    ],
    contentTags: [{ type: String }],
    highlights: [{ type: String }],
    stats: {
        totalClips: { type: Number },
        totalDuration: { type: Number },
        processingTime: { type: Number },
        mergeDate: { type: Date }
    },
    publishedVideoId: { type: String },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("projects", finalVideosSchema);
