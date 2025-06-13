
const mongoose = require('mongoose');

// Check if model already exists before defining
if (mongoose.models.UploadedVideo) {
    module.exports = mongoose.models.UploadedVideo;
} else {
    const videoSchema = new mongoose.Schema({
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        title: {
            type: String,
            required: true
        },
        videoUrl: {
            type: String,
            required: true
        },
        fileSize: {
            type: Number,
            required: false
        },
        mimeType: {
            type: String,
            required: false
        },
        thumbnailUrl: {
            type: String,
            default: '/default-thumbnail.jpg'
        },
        thumbnails: [{
            url: String,
            width: Number,
            height: Number,
            time: String
        }],
        status: {
            type: String,
            enum: ['uploading', 'uploaded', 'processing', 'processed', 'failed'],
            default: 'uploading'
        },

        transcript: {
            type: mongoose.Schema.Types.Mixed
        },
        processingError: {
            type: String,
            required: false
        },
        duration: {
            type: Number,
            default: 0,
            get: v => Math.round(v * 100) / 100
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        updatedAt: {
            type: Date,
            default: Date.now
        },
        processingCompletedAt: {
            type: Date,
            required: false
        }
    });

    // Add index for better query performance
    videoSchema.index({ userId: 1 });
    videoSchema.index({ status: 1 });
    videoSchema.index({ createdAt: -1 });

    module.exports = mongoose.model('UploadedVideo', videoSchema);
}