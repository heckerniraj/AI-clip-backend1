const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const processVideo = require('../controllers/videosController/processVideo');
const path = require('path');
const fs = require('fs');
const Video = require('../model/uploadVideosSchema');

const router = express.Router();

// CORS preflight handler
router.options('/process/:videoId', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(204).end();
});

// Enhanced path resolution with multiple fallbacks
const resolveFilePath = (videoUrl) => {
  // Handle remote URLs
  if (videoUrl.startsWith('http')) {
    return videoUrl;
  }

  // Always use the filename only
  const filename = path.basename(videoUrl);
  const possiblePaths = [];

  // Add Docker absolute path
  possiblePaths.push(
    path.join('/app/backend/uploads', filename), // Docker absolute path
    path.join(__dirname, '../../backend/uploads', filename), // Local dev absolute path
    path.join(__dirname, '../../uploads', filename), // Legacy
    path.join('uploads', filename) // Relative
  );

  // Add the original path as a fallback
  if (videoUrl.startsWith('uploads/')) {
    possiblePaths.push(path.join(__dirname, '../../', videoUrl));
  }

  // Find the first existing path
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      return possiblePath;
    }
  }

  return null;
};

// Main processing endpoint with comprehensive error handling
router.post('/process/:videoId', protect, async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 9);
  
  console.log(`\n[${new Date().toISOString()}] [${requestId}] PROCESS REQUEST STARTED`);
  console.log(`[${requestId}] Method: ${req.method} ${req.originalUrl}`);
  console.log(`[${requestId}] User: ${req.user?._id}`);

  try {
    const { videoId } = req.params;

    // Input validation
    if (!videoId || !/^[a-f0-9]{24}$/.test(videoId)) {
      console.error(`[${requestId}] Invalid video ID format`);
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID format',
        requestId
      });
    }

    if (!req.user?._id) {
      console.error(`[${requestId}] Unauthorized access attempt`);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access',
        requestId
      });
    }

    // Database lookup
    console.log(`[${requestId}] Searching for video ${videoId}`);
    const video = await Video.findOne({
      _id: videoId,
      userId: req.user._id
    }).lean();

    if (!video) {
      console.error(`[${requestId}] Video not found for user`);
      return res.status(404).json({
        success: false,
        error: 'Video not found',
        requestId
      });
    }

    if (!video.videoUrl || typeof video.videoUrl !== 'string') {
      console.error(`[${requestId}] Invalid video URL in database`);
      return res.status(500).json({
        success: false,
        error: 'Invalid video data',
        requestId
      });
    }

    // File path resolution
    console.log(`[${requestId}] Resolving path for: ${video.videoUrl}`);
    const filePath = resolveFilePath(video.videoUrl);

    if (!filePath) {
      console.error(`[${requestId}] File not found. Searched locations:`);
      const possiblePaths = [
        path.join('/backend/uploads', path.basename(video.videoUrl)),
        path.join('/app/uploads', path.basename(video.videoUrl)),
        path.join(__dirname, '../../uploads', path.basename(video.videoUrl))
      ];
      possiblePaths.forEach(p => console.log(`[${requestId}] - ${p}`));
      
      return res.status(404).json({
        success: false,
        error: 'Video file not found',
        requestId,
        debug: process.env.NODE_ENV === 'development' ? { 
          attemptedPaths: possiblePaths 
        } : undefined
      });
    }

    console.log(`[${requestId}] Using file path: ${filePath}`);

    // Video processing
    console.log(`[${requestId}] Starting video processing...`);
    const result = await processVideo({
      videoId,
      filePath,
      userId: req.user._id.toString(),
      authToken: req.headers.authorization || '',
      requestId
    });

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] Processing completed in ${duration}ms`);

    return res.status(200).json({
      success: true,
      data: result,
      requestId,
      durationMs: duration
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${requestId}] PROCESSING ERROR (${duration}ms):`, error);
    
    return res.status(500).json({
      success: false,
      error: 'Video processing failed',
      requestId,
      durationMs: duration,
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
});

// Thumbnail endpoint with improved caching
const defaultThumbnail = path.join(__dirname, '../../backend/public/default-thumbnail.jpg');

// Supported thumbnail extensions
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

router.get('/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // Validate video ID format
    if (!videoId || !/^[a-f0-9]{24}$/.test(videoId)) {
      return sendDefaultThumbnail(res);
    }

    // Find video document (only need thumbnailUrl)
    const video = await Video.findById(videoId).select('thumbnailUrl').lean();
    if (!video || !video.thumbnailUrl) {
      return sendDefaultThumbnail(res);
    }

    // Generate possible thumbnail filenames (with different extensions)
    const baseFilename = path.basename(video.thumbnailUrl, path.extname(video.thumbnailUrl));
    const possibleFilenames = ALLOWED_EXTENSIONS.map(ext => `${baseFilename}${ext}`);

    // Check all possible locations
    const foundPath = findThumbnailPath(possibleFilenames);
    if (foundPath) {
      return sendThumbnail(res, foundPath);
    }

    // Fallback to default thumbnail
    return sendDefaultThumbnail(res);

  } catch (error) {
    console.error('Thumbnail serving error:', error);
    return sendDefaultThumbnail(res);
  }
});

// Helper function to find thumbnail in possible locations
function findThumbnailPath(filenames) {
  const possiblePaths = [];
  
  // Production paths (Railway)
  if (process.env.RAILWAY_ENVIRONMENT === 'production') {
    possiblePaths.push(
      '/backend/thumbnails',
      '/app/thumbnails',
      '/backend/uploads/thumbnails',
      '/app/uploads/thumbnails'
    );
  } 
  // Development paths
  else {
    possiblePaths.push(
      path.join(__dirname, '../../backend/thumbnails'),
      path.join(__dirname, '../../uploads/thumbnails')
    );
  }

  // Check all combinations of paths and filenames
  for (const dir of possiblePaths) {
    for (const filename of filenames) {
      const fullPath = path.join(dir, filename);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  
  return null;
}

// Helper function to send thumbnail with proper headers
function sendThumbnail(res, filePath) {
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h cache
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.sendFile(filePath);
}

// Helper function to send default thumbnail
function sendDefaultThumbnail(res) {
  res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h cache for default
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.sendFile(defaultThumbnail);
}

module.exports = router;