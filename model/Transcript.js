const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  status: { type: String, enum: ['success', 'rate_limited', 'no_transcript'], required: true },
  transcript: { type: Array, default: null }, // Array of transcript segments
  language: { type: String, default: 'en' },
  fetchedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
});

transcriptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

module.exports = mongoose.model('Transcript', transcriptSchema);