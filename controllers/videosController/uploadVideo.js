const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const path = require('path');
const fs = require('fs');
const processVideo = require('./processVideo'); // Use default import

const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: false,
        error: 'No file uploaded',
      });
    }

    const uploadsBase = process.env.UPLOADS_DIR || '/app/backend/uploads';
    const absoluteFilePath = path.join(uploadsBase, req.file.filename).replace(/\\/g, '/');

    if (!fs.existsSync(absoluteFilePath)) {
      throw new Error(`File not saved at: ${absoluteFilePath}`);
    }

    const video = new Video({
      userId: req.user._id,
      title: req.file.originalname,
      videoUrl: absoluteFilePath, // Store absolute path
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await video.save();

    console.log(`[Debug] Saved video with videoUrl: ${video.videoUrl}`);

    processVideo({
      videoId: video._id,
      filePath: absoluteFilePath,
      userId: req.user._id,
      isBackgroundProcess: true,
      authToken: req.headers.authorization,
    }).catch(err => console.error('Background processing error:', err));

    res.status(200).json({
      status: true,
      videoId: video._id,
      message: 'Upload successful. Processing started.',
    });
  } catch (error) {
    console.error('Upload error:', error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`[Cleanup] Deleted file: ${req.file.path}`);
      } catch (cleanupError) {
        console.error('File cleanup failed:', cleanupError);
      }
    }

    res.status(500).json({
      status: false,
      error: 'Failed to process upload',
    });
  }
};

module.exports = uploadVideo;