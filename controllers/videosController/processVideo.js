const Video = require('../../model/uploadVideosSchema');
const { generateTranscript } = require('../transcriptsController/videoGenerateTranscript');
const { generateThumbnail } = require('./thumbnailGenerator');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const processVideo = async ({ videoId, filePath, userId, isBackgroundProcess = false, authToken }) => {
  let finalFilePath; // Declare at top to avoid ReferenceError
  try {
    console.log(`Starting processing for video: ${videoId}`);
    console.log('Auth token:', authToken ? 'provided' : 'not provided');

    const video = await Video.findOne({
      _id: videoId,
      ...(!isBackgroundProcess && { userId }),
    });

    if (!video) {
      throw new Error('Video not found or unauthorized access');
    }

    // Resolve file path
    const uploadsBase = process.env.UPLOADS_DIR || '/app/backend/uploads';
    if (filePath) {
      finalFilePath = filePath.startsWith('uploads/') || filePath.startsWith('backend/uploads/')
        ? path.join(uploadsBase, path.basename(filePath))
        : path.resolve(uploadsBase, path.basename(filePath));
    } else {
      if (!video.videoUrl) throw new Error('No video URL found');
      finalFilePath = video.videoUrl.startsWith('uploads/') || video.videoUrl.startsWith('backend/uploads/')
        ? path.join(uploadsBase, path.basename(video.videoUrl))
        : path.join(uploadsBase, path.basename(video.videoUrl));
    }

    console.log(`[Debug] Resolved file path: ${finalFilePath}`);

    if (!fs.existsSync(finalFilePath)) {
      throw new Error(`Video file not found at: ${finalFilePath}`);
    }

    const stats = fs.statSync(finalFilePath);
    if (stats.size === 0) {
      throw new Error('File exists but is empty (0 bytes)');
    }

    // Create thumbnails directory if it doesn't exist
    const thumbnailsDir = path.join(__dirname, '../../backend/thumbnails');
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    // Generate thumbnail
    const thumbnailFilename = `${videoId}.jpg`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);
    await generateThumbnail(finalFilePath, thumbnailPath);
    video.thumbnailUrl = `${process.env.API_BASE_URL || 'https://ai-clip-backend1-1.onrender.com'}/thumbnails/${thumbnailFilename}`;

    // Generate transcript
    console.log(`Generating transcript for video: ${videoId}`);
    const transcript = await generateTranscript(finalFilePath);

    // Update video status with transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const updatedVideo = await Video.findByIdAndUpdate(
        videoId,
        {
          status: 'processed',
          transcript,
          thumbnailUrl: video.thumbnailUrl,
          duration: transcript.duration,
          updatedAt: new Date(),
          processingCompletedAt: new Date(),
        },
        { new: true, session }
      );

      await session.commitTransaction();
      console.log(`Successfully processed video ${videoId}`);

      return {
        success: true,
        videoId: updatedVideo._id,
        status: updatedVideo.status,
        thumbnailUrl: updatedVideo.thumbnailUrl,
        transcriptId: transcript.id,
      };
    } catch (dbError) {
      await session.abortTransaction();
      throw dbError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error(`Processing failed for video ${videoId}:`, error.stack || error);

    const errorDetails = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
    };

    try {
      await Video.findByIdAndUpdate(videoId, {
        status: 'failed',
        error: errorDetails,
        updatedAt: new Date(),
      });
    } catch (dbError) {
      console.error('Failed to update video status:', dbError);
    }

    // Only clean up if filePath is temporary
    if (finalFilePath && fs.existsSync(finalFilePath) && finalFilePath.includes('/tmp/')) {
      try {
        fs.unlinkSync(finalFilePath);
        console.log(`[Cleanup] Deleted temporary file: ${finalFilePath}`);
      } catch (cleanupError) {
        console.error('File cleanup failed:', cleanupError);
      }
    }

    const processingError = new Error(`Video processing failed: ${error.message}`);
    processingError.details = errorDetails;
    throw processingError;
  }
};

module.exports = processVideo;