const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

// Verify FFmpeg installation at startup
ffmpeg.getAvailableFormats((err) => {
  if (err) {
    console.error('FFmpeg not found or not working:', err);
    console.error('Thumbnail generation will fail. Please install FFmpeg and ensure it\'s in your PATH');
  } else {
    console.log('FFmpeg is available for thumbnail generation');
  }
});

const generateThumbnail = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    // Verify input file exists
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Input video file not found: ${videoPath}`));
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Generating thumbnail for: ${videoPath}`);
    
    ffmpeg(videoPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Thumbnail generation progress: ${Math.round(progress.percent)}%`);
      })
      .on('end', () => {
        // Verify thumbnail was created
        if (!fs.existsSync(outputPath)) {
          return reject(new Error('Thumbnail file was not created'));
        }
        
        const stats = fs.statSync(outputPath);
        if (stats.size === 0) {
          fs.unlinkSync(outputPath); // Clean up empty file
          return reject(new Error('Thumbnail file is empty'));
        }
        
        console.log(`Successfully generated thumbnail: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(new Error(`Thumbnail generation failed: ${err.message}`));
      })
      .screenshots({
        count: 1,
        timemarks: ['00:00:01.000'], // Capture at 1 second
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x180' // Standard thumbnail size
      });
  });
};

// Helper function to generate multiple thumbnails
const generateThumbnails = async (videoPath, outputDir, count = 3) => {
  const thumbnails = [];
  const baseName = path.basename(videoPath, path.extname(videoPath));
  
  try {
    for (let i = 0; i < count; i++) {
      const time = Math.floor((i + 1) * 10); // 10s, 20s, 30s
      const outputPath = path.join(outputDir, `${baseName}_thumb_${time}s.jpg`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .on('end', () => {
            if (fs.existsSync(outputPath)) {
              thumbnails.push(outputPath);
              resolve();
            } else {
              reject(new Error(`Thumbnail not created at ${time}s`));
            }
          })
          .on('error', reject)
          .screenshots({
            count: 1,
            timemarks: [`00:00:${time.toString().padStart(2, '0')}.000`],
            filename: path.basename(outputPath),
            folder: path.dirname(outputPath),
            size: '320x180'
          });
      });
    }
    
    return thumbnails;
  } catch (error) {
    // Clean up any partial thumbnails
    thumbnails.forEach(thumb => {
      try {
        fs.unlinkSync(thumb);
      } catch (cleanupError) {
        console.error('Error cleaning up thumbnail:', cleanupError);
      }
    });
    throw error;
  }
};

module.exports = {
  generateThumbnail,
  generateThumbnails
};