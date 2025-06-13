const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.Mixed, // Changed from ObjectId to Mixed to support both ObjectId and string
        ref: "User",
        required: true 
    },
    title: { type: String, required: true },
    description: { type: String },
    jobId: { type: String },
    duration: { type: Number, default: 0 },
    s3Url: { type: String, required: true },
    thumbnailUrl: { type: String },
    createdAt: { type: Date, default: Date.now },
    userEmail: { type: String },
    userName: { type: String },
    aiSummary: { type: String },
    aiMetadata: {
        generationTimestamp: { type: Date },
        model: { type: String },
        summaryLength: { type: Number },
        keywords: [{ type: String }],
        confidence: { type: Number }
    },
    sourceClips: [{
        videoId: { type: String },
        title: { type: String },
        startTime: { type: Number },
        endTime: { type: Number },
        duration: { type: Number },
        thumbnail: { type: String },
        originalVideoTitle: { type: String },
        aiAnalysis: { type: mongoose.Schema.Types.Mixed },
        contentTags: [{ type: String }],
        sentimentScore: { type: Number },
        highlights: [{ type: String }]
    }],
    stats: {
        totalClips: { type: Number, default: 0 },
        totalDuration: { type: Number, default: 0 },
        processingTime: { type: Number, default: 0 },
        mergeDate: { type: Date }
    },
    publishedVideoId: { type: mongoose.Schema.Types.ObjectId, ref: "PublishedVideo" }
});

module.exports = mongoose.model("Project", projectSchema); 