const mongoose = require("mongoose");

const savedVideosSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "PublishedVideo", required: true },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SavedVideo", savedVideosSchema);
