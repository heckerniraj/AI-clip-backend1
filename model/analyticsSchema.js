const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "PublishedVideo" },
    eventType: { type: String, enum: ["View", "Like", "Comment", "Save"], required: true },
    timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Analytics", analyticsSchema);
