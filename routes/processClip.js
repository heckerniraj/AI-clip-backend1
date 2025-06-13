// routes/processRoute.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');

// Configure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Create directories if they don't exist
const downloadsDir = path.join(__dirname, '../downloads');
const clipsDir = path.join(__dirname, '../clips');

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

if (!fs.existsSync(clipsDir)) {
  fs.mkdirSync(clipsDir, { recursive: true });
}

// Helper function to clean up files
const cleanUpFiles = (filePaths) => {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, err => {
        if (err) console.error(`Error deleting file ${filePath}:`, err);
      });
    }
  });
};

// API endpoint to process video clips
router.post('/process-video', async (req, res) => {
  try {
    const { videoId, startTime, endTime } = req.body;
    
    // Validate input
    if (!videoId || isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters: videoId, startTime, endTime' 
      });
    }

    if (startTime >= endTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'Start time must be before end time' 
      });
    }

    const duration = endTime - startTime;
    if (duration > 600) { // Limit to 10 minutes max
      return res.status(400).json({ 
        success: false, 
        message: 'Clip duration cannot exceed 10 minutes' 
      });
    }

    console.log(`Processing video ${videoId} from ${startTime}s to ${endTime}s`);

    // Generate unique filenames
    const tempFileName = `temp_${uuidv4()}.mp4`;
    const outputFileName = `clip_${videoId}_${startTime}_${endTime}_${uuidv4()}.mp4`;
    const tempFilePath = path.join(downloadsDir, tempFileName);
    const outputFilePath = path.join(clipsDir, outputFileName);

    // Download the video (highest quality audio)
    console.log('Downloading video...');
    const videoStream = ytdl(videoId, {
      quality: 'highestaudio',
      filter: format => format.container === 'mp4',
    }).pipe(fs.createWriteStream(tempFilePath));

    await new Promise((resolve, reject) => {
      videoStream.on('finish', resolve);
      videoStream.on('error', reject);
    });

    // Process the video with FFmpeg
    console.log('Trimming video...');
    await new Promise((resolve, reject) => {
      ffmpeg(tempFilePath)
        .setStartTime(startTime)
        .setDuration(duration)
        .outputOptions([
          '-c:v libx264', // Video codec
          '-c:a aac',     // Audio codec
          '-movflags faststart', // For streaming
          '-preset fast', // Faster encoding
          '-crf 28'       // Quality (lower is better)
        ])
        .on('end', () => {
          console.log('Video processing finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error processing video:', err);
          reject(err);
        })
        .save(outputFilePath);
    });

    // Clean up the temporary file
    cleanUpFiles([tempFilePath]);

    // Generate URL for the processed clip
    const clipUrl = `/api/clips/${outputFileName}`;

    res.json({
      success: true,
      url: clipUrl,
      duration: duration.toFixed(2),
      message: 'Video clip processed successfully'
    });

  } catch (error) {
    console.error('Error in video processing:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process video',
      error: error.message 
    });
  }
});

// Serve processed clips
router.get('/clips/:filename', (req, res) => {
  const filePath = path.join(clipsDir, req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Clip not found');
  }
});

// Clean up old clips periodically (every hour)
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  fs.readdir(clipsDir, (err, files) => {
    if (err) return console.error('Error cleaning up clips:', err);
    
    files.forEach(file => {
      const filePath = path.join(clipsDir, file);
      const stat = fs.statSync(filePath);
      
      if (now - stat.mtimeMs > oneHour) {
        fs.unlink(filePath, err => {
          if (err) console.error(`Error deleting old clip ${file}:`, err);
          else console.log(`Deleted old clip: ${file}`);
        });
      }
    });
  });
}, 60 * 60 * 1000);

module.exports = router;