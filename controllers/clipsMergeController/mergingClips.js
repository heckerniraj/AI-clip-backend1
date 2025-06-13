const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const { rimraf } = require('rimraf');
const youtubeDl = require('youtube-dl-exec');

// Configure AWS SDK
const configureAWS = () => {
  const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.warn(`Warning: Missing AWS environment variables: ${missingVars.join(', ')}`);
    console.warn('S3 upload functionality may not work correctly.');
  }
  
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
  });
  
  return new AWS.S3();
};

const s3 = configureAWS();

// Set up temp directories
const TMP_DIR = path.join(__dirname, '../../tmp');
const OUTPUT_DIR = path.join(__dirname, '../../output');

// Maximum allowed duration for a merged video (in seconds)
const MAX_MERGED_DURATION = 3600; // 1 hour
// Maximum allowed video count per merge request
const MAX_CLIPS_COUNT = 20;
// Download timeout (in milliseconds)
const DOWNLOAD_TIMEOUT = 300000; // 5 minutes

// Custom error classes for better error handling
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadError';
  }
}

class ProcessingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProcessingError';
  }
}

class UploadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadError';
  }
}

// Ensure temp directories exist
const ensureDirs = async () => {
  try {
    // Use native fs.mkdirSync with recursive option
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
  } catch (error) {
    throw new ProcessingError(`Failed to create temporary directories: ${error.message}`);
  }
};

// Validate YouTube video ID
const validateYoutubeVideoId = async (videoId) => {
  try {
    // Try with ytdl-core first
    try {
      const info = await ytdl.getBasicInfo(videoId);
      return {
        valid: true,
        info: {
          title: info.videoDetails.title,
          lengthSeconds: info.videoDetails.lengthSeconds,
          author: info.videoDetails.author.name
        }
      };
    } catch (ytdlError) {
      // console.log(`ytdl-core validation failed: ${ytdlError.message}, trying youtubeDl...`);
      
      // Fallback to youtube-dl-exec
      const info = await youtubeDl(`https://www.youtube.com/watch?v=${videoId}`, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true
      });
      
      return {
        valid: true,
        info: {
          title: info.title,
          lengthSeconds: info.duration,
          author: info.channel
        }
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

// Download a YouTube video - with fallback to youtube-dl-exec
const downloadYoutubeVideo = async (videoId, outputPath) => {
  console.log(`Starting download of video ${videoId}...`);
  
  // Add a timeout promise to limit download time
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new DownloadError(`Download timeout for video ${videoId}`)), DOWNLOAD_TIMEOUT);
  });
  
  try {
    // Try with ytdl-core first
    try {
      return await Promise.race([
        downloadWithYtdl(videoId, outputPath),
        timeoutPromise
      ]);
    } catch (ytdlError) {
      // console.log(`ytdl-core download failed: ${ytdlError.message}, falling back to youtube-dl...`);
      
      // Fallback to youtube-dl-exec
      return await Promise.race([
        downloadWithYoutubeDl(videoId, outputPath),
        timeoutPromise
      ]);
    }
  } catch (error) {
    if (error instanceof DownloadError) {
      throw error;
    }
    throw new DownloadError(`Failed to download video ${videoId}: ${error.message}`);
  }
};

// Download using ytdl-core
const downloadWithYtdl = (videoId, outputPath) => {
  return new Promise((resolve, reject) => {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    ytdl.getInfo(videoId).then(info => {
      const videoReadStream = ytdl(videoUrl, { 
        quality: 'highest',
        filter: 'videoandaudio'
      });
      
      // Track download progress
      let downloadedBytes = 0;
      const totalBytes = parseInt(info.videoDetails.lengthSeconds) * 250000; // Rough estimation
      
      videoReadStream.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const progress = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
        if (progress % 10 === 0) { // Log every 10%
          // console.log(`Downloading video ${videoId}: ${progress}% complete`);
        }
      });
      
      videoReadStream.pipe(fs.createWriteStream(outputPath))
        .on('finish', () => {
          // console.log(`Downloaded video ${videoId} successfully`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`Error writing video file: ${err.message}`);
          reject(err);
        });
    }).catch(err => {
      reject(err);
    });
  });
};

// Download using youtube-dl-exec (fallback)
const downloadWithYoutubeDl = async (videoId, outputPath) => {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  console.log(`Downloading with youtube-dl: ${videoId}`);
  
  try {
    await youtubeDl(videoUrl, {
      output: outputPath,
      format: 'best',
      noCheckCertificate: true,
      noWarnings: true,
      preferFreeFormats: true
    });
    
    console.log(`Downloaded video ${videoId} successfully using youtube-dl`);
    return outputPath;
  } catch (error) {
    console.error(`youtube-dl download failed: ${error.message}`);
    throw error;
  }
};

// Trim video using ffmpeg
const trimVideo = (inputPath, outputPath, startTime, endTime) => {
  return new Promise((resolve, reject) => {
    // console.log(`Trimming video from ${startTime}s to ${endTime}s...`);
    
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Input file not found: ${inputPath}`));
    }
    
    ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(endTime - startTime)
      .output(outputPath)
      .on('progress', (progress) => {
        if (progress.percent) {
          // console.log(`Trimming progress: ${Math.round(progress.percent)}% complete`);
        }
      })
      .on('end', () => {
        // console.log(`Successfully trimmed video to ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`Error trimming video: ${err.message}`);
        reject(err);
      })
      .run();
  });
};

// Merge videos using ffmpeg
const mergeVideos = (inputFiles, outputPath) => {
  return new Promise((resolve, reject) => {
    // Validate input files
    if (!inputFiles || inputFiles.length === 0) {
      return reject(new Error('No input files provided for merging'));
    }
    
    for (const file of inputFiles) {
      if (!fs.existsSync(file)) {
        return reject(new Error(`Input file not found: ${file}`));
      }
    }
    
    // console.log(`Merging ${inputFiles.length} video clips...`);
    
    // Create a temporary file list for ffmpeg
    const fileListPath = path.join(TMP_DIR, `filelist_${Date.now()}.txt`);
    const fileList = inputFiles.map(file => `file '${file}'`).join('\n');
    
    fs.writeFileSync(fileListPath, fileList);
    
    ffmpeg()
      .input(fileListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions('-c copy')
      .output(outputPath)
      .on('progress', (progress) => {
        if (progress.percent) {
          // console.log(`Merging progress: ${Math.round(progress.percent)}% complete`);
        }
      })
      .on('end', () => {
        // console.log(`Successfully merged videos to ${outputPath}`);
        // Clean up the file list
        try {
          fs.unlinkSync(fileListPath);
        } catch (error) {
          console.warn(`Warning: Could not delete temporary file list: ${error.message}`);
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`Error merging videos: ${err.message}`);
        reject(err);
      })
      .run();
  });
};

// Upload file to S3
const uploadToS3 = async (filePath, key) => {
  // Validate S3 configuration
  if (!process.env.AWS_S3_BUCKET) {
    throw new UploadError('AWS_S3_BUCKET environment variable is not set');
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new UploadError(`File not found for S3 upload: ${filePath}`);
  }
  
  console.log(`Uploading file to S3: ${key}`);
  
  try {
    // Get file info
    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;
    
    if (fileSize === 0) {
      throw new UploadError('Cannot upload empty file to S3');
    }
    
    const fileContent = fs.readFileSync(filePath);
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: 'video/mp4'
      // ACL parameter removed - rely on bucket policy instead for public access
      // For public access, configure bucket policy in AWS console
    };
    
    // Add upload timeout
    const uploadPromise = s3.upload(params).promise();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new UploadError('S3 upload timeout')), 600000); // 10 minute timeout
    });
    
    const data = await Promise.race([uploadPromise, timeoutPromise]);
    console.log(`File uploaded successfully. Size: ${(fileSize / 1024 / 1024).toFixed(2)}MB, URL: ${data.Location}`);
    return data.Location;
  } catch (err) {
    console.error(`Error uploading file to S3: ${err.message}`);
    throw new UploadError(`Failed to upload to S3: ${err.message}`);
  }
};

// Helper function to clean up resources in case of errors
const cleanupResources = async (jobDir, outputPath = null) => {
  try {
    // Clean up job directory
    if (jobDir && fs.existsSync(jobDir)) {
      await rimraf(jobDir);
      console.log(`Cleaned up job directory: ${jobDir}`);
    }
    
    // Clean up output file if it exists
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      console.log(`Cleaned up output file: ${outputPath}`);
    }
  } catch (error) {
    console.warn(`Warning: Error during cleanup: ${error.message}`);
  }
};

// Main controller function
exports.mergingClips = async (req, res) => {
  let jobId = null;
  let jobDir = null;
  let outputPath = null;
  
  try {
    const { clips } = req.body;
    
    // Validate request body
    if (!clips) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'Clips data is missing from request body'
      });
    }
    
    if (!Array.isArray(clips)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_FORMAT',
        message: 'Clips must be provided as an array'
      });
    }
    
    if (clips.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'EMPTY_CLIPS',
        message: 'No clips provided for merging'
      });
    }
    
    if (clips.length > MAX_CLIPS_COUNT) {
      return res.status(400).json({
        success: false,
        error: 'TOO_MANY_CLIPS',
        message: `Maximum of ${MAX_CLIPS_COUNT} clips allowed per request`
      });
    }
    
    console.log(`Starting clips merging with ${clips.length} clips`);
    
    // Create temporary directory paths
    jobId = uuidv4(); // Still use a unique ID for file naming
    jobDir = path.join(TMP_DIR, jobId);
    const outputFileName = `merged_${jobId}.mp4`;
    outputPath = path.join(OUTPUT_DIR, outputFileName);
    
    // Ensure directories exist
    await ensureDirs();
    
    // Create a job directory
    try {
      if (!fs.existsSync(jobDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
      }
    } catch (error) {
      throw new ProcessingError(`Failed to create job directory: ${error.message}`);
    }
    
    console.log('Validating video IDs...');
    
    // Calculate total duration to validate against maximum allowed
    let totalDuration = 0;
    
    // Step 1: Validate all video IDs
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const { videoId, startTime, endTime } = clip;
      
      if (!videoId) {
        throw new ValidationError(`Missing videoId for clip at index ${i}`);
      }
      
      if (typeof startTime !== 'number') {
        throw new ValidationError(`Invalid or missing startTime for clip ${i}: must be a number`);
      }
      
      if (typeof endTime !== 'number') {
        throw new ValidationError(`Invalid or missing endTime for clip ${i}: must be a number`);
      }
      
      if (startTime < 0) {
        throw new ValidationError(`Invalid startTime for clip ${i}: must be non-negative`);
      }
      
      if (startTime >= endTime) {
        throw new ValidationError(`Invalid time range for clip ${i}: startTime (${startTime}) must be less than endTime (${endTime})`);
      }
      
      // Calculate clip duration and add to total
      const clipDuration = endTime - startTime;
      totalDuration += clipDuration;
      
      // Validate clip duration
      if (clipDuration > 600) { // 10 minutes max per clip
        throw new ValidationError(`Clip ${i} is too long: maximum duration per clip is 10 minutes`);
      }
      
      try {
        const validation = await validateYoutubeVideoId(videoId);
        if (!validation.valid) {
          throw new ValidationError(`Invalid YouTube video ID ${videoId}: ${validation.error}`);
        }
        
        // Additional validation against YouTube video length
        if (validation.info && validation.info.lengthSeconds) {
          if (endTime > validation.info.lengthSeconds) {
            throw new ValidationError(
              `Invalid endTime for clip ${i}: endTime (${endTime}) exceeds video duration (${validation.info.lengthSeconds}s)`
            );
          }
        }
      } catch (error) {
        if (error instanceof ValidationError) {
          throw error;
        }
        throw new ValidationError(`Error validating video ID ${videoId}: ${error.message}`);
      }
    }
    
    // Validate total merged duration
    if (totalDuration > MAX_MERGED_DURATION) {
      throw new ValidationError(
        `Total merged video duration (${Math.round(totalDuration / 60)} minutes) exceeds maximum allowed (${MAX_MERGED_DURATION / 60} minutes)`
      );
    }
    
    console.log('Downloading and trimming videos...');
    // Step 2: Download and trim each video
    const trimmedVideoPaths = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const { videoId, startTime, endTime } = clip;
      
      console.log(`Processing clip ${i + 1}/${clips.length}: ${videoId} from ${startTime}s to ${endTime}s`);
      
      try {
        // Download the video
        const downloadPath = path.join(jobDir, `${videoId}_full.mp4`);
        await downloadYoutubeVideo(videoId, downloadPath);
        
        // Verify the downloaded file exists and has content
        if (!fs.existsSync(downloadPath) || fs.statSync(downloadPath).size === 0) {
          throw new ProcessingError(`Downloaded file is missing or empty: ${downloadPath}`);
        }
        
        // Trim the video
        const trimmedPath = path.join(jobDir, `${videoId}_${startTime}_${endTime}.mp4`);
        await trimVideo(downloadPath, trimmedPath, startTime, endTime);
        
        // Verify the trimmed file exists and has content
        if (!fs.existsSync(trimmedPath) || fs.statSync(trimmedPath).size === 0) {
          throw new ProcessingError(`Trimmed file is missing or empty: ${trimmedPath}`);
        }
        
        trimmedVideoPaths.push(trimmedPath);
        
        // Remove the full video to save space
        try {
          fs.unlinkSync(downloadPath);
        } catch (error) {
          console.warn(`Warning: Could not delete full video file: ${error.message}`);
        }
      } catch (error) {
        // Clean up and rethrow
        await cleanupResources(jobDir);
        if (error instanceof DownloadError || error instanceof ProcessingError) {
          throw error;
        }
        throw new ProcessingError(`Error processing clip ${i} (${videoId}): ${error.message}`);
      }
    }
    
    if (trimmedVideoPaths.length === 0) {
      throw new ProcessingError('No valid clips were processed');
    }
    
    // Step 3: Merge all trimmed videos
    console.log(`Merging ${trimmedVideoPaths.length} trimmed clips into a single video...`);
    try {
      await mergeVideos(trimmedVideoPaths, outputPath);
      
      // Verify the merged file exists and has content
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new ProcessingError('Merged output file is missing or empty');
      }
    } catch (error) {
      await cleanupResources(jobDir, outputPath);
      throw new ProcessingError(`Error merging videos: ${error.message}`);
    }
    
    // Step 4: Upload to S3
    let s3Url;
    console.log('Uploading merged video to S3...');
    try {
      const s3Key = `merged-clips/${outputFileName}`;
      s3Url = await uploadToS3(outputPath, s3Key);
    } catch (error) {
      await cleanupResources(jobDir, outputPath);
      if (error instanceof UploadError) {
        throw error;
      }
      throw new UploadError(`Error uploading to S3: ${error.message}`);
    }
    
    // Step 5: Clean up the job directory
    try {
      if (fs.existsSync(jobDir)) {
        await rimraf(jobDir);
      }
    } catch (cleanupError) {
      console.warn(`Warning: Could not clean up job directory: ${cleanupError.message}`);
      // Don't throw error here, as the main job was completed successfully
    }
    
    // Return success response with S3 URL
    return res.status(200).json({
      success: true,
      message: 'Clips successfully merged',
      s3Url: s3Url,
      status: true
    });
    
  } catch (error) {
    console.error(`Error in mergingClips:`, error);
    
    // Ensure cleanup happens in case of error
    if (jobDir || outputPath) {
      await cleanupResources(jobDir, outputPath);
    }
    
    // Return appropriate error response based on error type
    if (error instanceof ValidationError) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: error.message
      });
    } else if (error instanceof DownloadError) {
      return res.status(500).json({
        success: false,
        error: 'DOWNLOAD_ERROR',
        message: error.message
      });
    } else if (error instanceof ProcessingError) {
      return res.status(500).json({
        success: false,
        error: 'PROCESSING_ERROR',
        message: error.message
      });
    } else if (error instanceof UploadError) {
      return res.status(500).json({
        success: false,
        error: 'UPLOAD_ERROR',
        message: error.message
      });
    }
    
    // Generic error
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: `Error processing clips: ${error.message}`
    });
  }
};
