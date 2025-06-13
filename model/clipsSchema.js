const mongoose = require("mongoose");

const clipsSchema = new mongoose.Schema({
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    clipUrl: { type: String, required: true },
    projectNumber: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Clip", clipsSchema);
