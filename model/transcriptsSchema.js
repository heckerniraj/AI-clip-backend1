const mongoose = require("mongoose");

const transcriptsSchema = new mongoose.Schema({
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    transcript: [
        {
            text: { type: String, required: true },
            startTime: { type: Number, required: true },
            endTime: { type: Number, required: true },
        }
    ],
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transcript", transcriptsSchema);
