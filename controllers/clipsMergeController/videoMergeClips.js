const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Video = require('../../model/uploadVideosSchema');
const FinalVideo = require('../../model/finalVideosSchema');
const { uploadToS3 } = require('../../utils/s3');

// Configure FFmpeg path

const configureFfmpeg = () => {
  let ffmpegPath;

  // Determine environment
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    if (isProduction) {
      // Production: Use system FFmpeg installed via apt-get
      ffmpegPath = '/usr/bin/ffmpeg';
    } else {
      // Development: Try ffmpeg-static first
      try {
        ffmpegPath = require('ffmpeg-static');
        console.log('Using ffmpeg-static path:', ffmpegPath);
      } catch (err) {
        // Fallback to environment variable or default Windows path
        ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
      }
    }

    // Set and verify FFmpeg path
    console.log(`Setting FFmpeg path to: ${ffmpegPath}`);
    ffmpeg.setFfmpegPath(ffmpegPath);

    // Verify FFmpeg installation
    const command = ffmpeg();
    command
      .on('start', () => console.log('FFmpeg verification started'))
      .on('error', err => {
        console.error('FFmpeg verification failed:', err);
        if (isProduction) {
          throw new Error(`FFmpeg verification failed in production: ${err.message}`);
        } else {
          console.warn('FFmpeg verification failed in development, but continuing...');
        }
      })
      .on('end', () => console.log('FFmpeg is available for use'))
      .outputOptions(['-version'])
      .output(isProduction ? '/dev/null' : 'NUL')
      .run();

  } catch (err) {
    console.error('Error configuring FFmpeg:', err);
    if (isProduction) {
      throw new Error(`Failed to configure FFmpeg in production: ${err.message}`);
    } else {
      console.warn('FFmpeg configuration failed in development, but continuing...');
    }
  }
};
// Call configuration function
configureFfmpeg();

const resolveVideoPath = (filePath) => {
  console.log(`[Path Resolution] Attempting to resolve: ${filePath}`);

  const uploadsBase = process.env.UPLOADS_DIR || '/app/backend/uploads';
  const filename = path.basename(filePath);
  const normalizedFilePath = filePath.replace(/\\/g, '/');

  const possiblePaths = [
    normalizedFilePath, // Direct path (if absolute)
    path.join(uploadsBase, filename), // Base path + filename
    path.join(uploadsBase, normalizedFilePath.startsWith('uploads/') ? normalizedFilePath.slice(8) : filename),
    path.join(uploadsBase, normalizedFilePath.startsWith('backend/uploads/') ? normalizedFilePath.slice(16) : filename),
  ];

  console.log('[Path Resolution] Checking paths:', possiblePaths);

  for (const p of possiblePaths) {
    const normalizedPath = path.normalize(p);
    if (fs.existsSync(normalizedPath)) {
      console.log(`[Path Resolution] Found at: ${normalizedPath}`);
      return normalizedPath;
    }
  }

  const debugInfo = {
    cwd: process.cwd(),
    environment: process.env.NODE_ENV,
    uploadsBase,
    originalPath: filePath,
    checkedPaths: possiblePaths,
  };
  console.error('[Path Resolution] Debug info:', debugInfo);

  try {
    const uploadsContent = fs.readdirSync(uploadsBase);
    console.log(`[Path Resolution] Contents of ${uploadsBase}:`, uploadsContent);
  } catch (err) {
    console.error(`[Path Resolution] Could not read ${uploadsBase}:`, err);
  }

  throw new Error(`Could not resolve path for: ${filePath}\nTried paths:\n${possiblePaths.join('\n')}`);
};


const generateThumbnail = async (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        timemarks: ['50%'], // Capture from middle of video
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x180'
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
};

const videoMergeClips = async (clips, user, videoInfo = {}) => {
  const jobId = uuidv4();
  console.log(`[${jobId}] Starting merge process`);

  try {
    if (!clips?.length) throw new Error('No clips provided');

    // Setup directories
    const tempDir = path.join(process.env.TEMP_DIR || path.join(__dirname, '../../../tmp'), jobId);
    const outputDir = process.env.OUTPUT_DIR || path.join(__dirname, '../../../output');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    // Process clips
    let totalDuration = 0;
    const clipDetails = await Promise.all(clips.map(async (clip) => {
      const video = await Video.findById(clip.videoId);
      if (!video) throw new Error(`Video not found: ${clip.videoId}`);

      const resolvedPath = resolveVideoPath(video.videoUrl);
      if (!fs.existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);

      const duration = clip.endTime - clip.startTime;
      totalDuration += duration;

      return {
        path: resolvedPath,
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration,
        videoId: clip.videoId.toString(),
        title: clip.title || video.title,
        thumbnail: video.thumbnailUrl,
        originalVideoTitle: video.title
      };
    }));

    // Merge videos
    const outputPath = path.join(outputDir, `merged_${jobId}.mp4`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const command = ffmpeg();
      let ffmpegProcess;
      let timeout;

      // Add inputs with time trimming
      clipDetails.forEach(clip => {
        command.input(clip.path)
          .inputOptions([`-ss ${clip.startTime}`])
          .inputOptions([`-to ${clip.endTime}`]);
      });

      // Configure merge with robust settings
      command.complexFilter([
        {
          filter: 'concat',
          options: { 
            n: clipDetails.length, 
            v: 1, 
            a: 1,
            unsafe: 1
          },
          outputs: ['v', 'a']
        }
      ])
      .outputOptions([
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'medium', // More reliable than 'fast'
        '-crf', '23',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-max_muxing_queue_size', '9999', // Increased buffer
        '-threads', '1', // Single thread for stability
        '-vsync', 'vfr', // Better frame rate handling
        '-async', '1' // Better audio sync
      ])
      .on('start', (cmd) => {
        console.log(`[${jobId}] FFmpeg command:`, cmd);
        ffmpegProcess = cmd;
        
        // Set timeout to detect hangs (30 minutes)
        timeout = setTimeout(() => {
          if (ffmpegProcess) {
            console.error(`[${jobId}] Process timeout - killing FFmpeg`);
            process.kill(ffmpegProcess.pid, 'SIGKILL');
          }
        }, 30 * 60 * 1000);
      })
      .on('progress', (progress) => {
        console.log(`[${jobId}] Progress: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', async () => {
        clearTimeout(timeout);
        try {
          console.log(`[${jobId}] Merge successful`);
          
          // Generate thumbnail
          let thumbnailUrl;
          try {
            const thumbPath = path.join(outputDir, `thumb_${jobId}.jpg`);
            await generateThumbnail(outputPath, thumbPath);
            thumbnailUrl = await uploadToS3(thumbPath, 
              `merged-videos/${user.id}/thumbs/thumb_${jobId}.jpg`, {
              ContentType: 'image/jpeg',
              ACL: 'public-read'
            });
            fs.unlinkSync(thumbPath);
          } catch (thumbErr) {
            console.error(`[${jobId}] Thumbnail error:`, thumbErr);
            thumbnailUrl = clipDetails[0]?.thumbnail || '';
          }

          // Upload merged video
          const s3Key = `merged-videos/${user.id}/merged_${jobId}.mp4`;
          const s3Url = await uploadToS3(outputPath, s3Key, {
            ContentType: 'video/mp4',
            ACL: 'public-read'
          });

          // Save to database
          const finalVideo = new FinalVideo({
            userId: user.id.toString(),
            title: videoInfo.title || `Merged Video ${new Date().toLocaleDateString()}`,
            description: videoInfo.description || '',
            jobId,
            duration: totalDuration,
            s3Url,
            thumbnailUrl,
            userEmail: user.email || '',
            userName: user.name || '',
            sourceClips: clipDetails.map(c => ({
              videoId: c.videoId,
              title: c.title,
              startTime: c.startTime,
              endTime: c.endTime,
              duration: c.duration,
              thumbnail: c.thumbnail,
              originalVideoTitle: c.originalVideoTitle
            })),
            stats: {
              totalClips: clipDetails.length,
              totalDuration,
              processingTime: Date.now() - startTime,
              mergeDate: new Date()
            }
          });
          await finalVideo.save();

          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });
          fs.unlinkSync(outputPath);

          resolve({
            success: true,
            videoUrl: s3Url,
            videoId: finalVideo._id,
            thumbnailUrl,
            duration: totalDuration
          });
        } catch (err) {
          console.error(`[${jobId}] Post-merge error:`, err);
          reject(err);
        }
      })
      .on('error', (err, stdout, stderr) => {
        clearTimeout(timeout);
        console.error(`[${jobId}] FFmpeg error:`, err);
        console.error(`[${jobId}] FFmpeg stdout:`, stdout);
        console.error(`[${jobId}] FFmpeg stderr:`, stderr);
        reject(new Error(`Merge failed: ${err.message}`));
      })
      .save(outputPath);
    });
  } catch (error) {
    console.error(`[${jobId}] Merge error:`, error);
    throw error;
  }
};

module.exports = {
  videoMergeClips,
  resolveVideoPath
};