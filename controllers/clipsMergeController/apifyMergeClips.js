const fs = require('fs');
const path = require('path');
const { axiosWithProxy } = require('../../utils/axiosWithProxy');
const { v4: uuidv4 } = require('uuid');
const { ApifyClient } = require('apify-client');
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');
const { spawn } = require('child_process');
const youtubeDl = require('youtube-dl-exec');
const { uploadToS3, getSignedDownloadUrl } = require('../../utils/s3');
const axios = require('axios');

const videoCache = {
  cache: new Map(), 
  
  // Cache directory path
  cacheDir: path.join(__dirname, '../../cache'),
  init() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      console.log(`Created video cache directory at ${this.cacheDir}`);
    }
    setInterval(() => this.cleanupCache(), 24 * 60 * 60 * 1000);
    
    return this;
  },
  
  hasVideo(videoId) {
    if (this.cache.has(videoId) && fs.existsSync(this.cache.get(videoId).filePath)) {
      return true;
    }
    
    return false;
  },
  
  // Get cached video info
  getVideo(videoId) {
    return this.cache.get(videoId);
  },
  
  // Add video to cache
  addVideo(videoId, filePath, metadata = {}) {
    this.cache.set(videoId, {
      videoId,
      filePath,
      timestamp: Date.now(),
      metadata
    });
    
    // Cache is only maintained in memory now
    // this.saveCacheToDisk();
    
    return filePath;
  },
  
  // Get path for a cached video
  getCachePath(videoId) {
    return path.join(this.cacheDir, `${videoId}.mp4`);
  },
  
  copyToPath(videoId, targetPath) {
    return new Promise((resolve, reject) => {
      if (!this.hasVideo(videoId)) {
        return reject(new Error('Video not in cache'));
      }
      
      const sourcePath = this.cache.get(videoId).filePath;
      
      // Create a read stream from the source file
      const readStream = fs.createReadStream(sourcePath);
      const writeStream = fs.createWriteStream(targetPath);
      
      readStream.on('error', err => {
        reject(err);
      });
      
      writeStream.on('error', err => {
        reject(err);
      });
      
      writeStream.on('finish', () => {
        console.log(`Copied cached video ${videoId} to ${targetPath}`);
        resolve(targetPath);
      });
      
      // Pipe the read stream to the write stream
      readStream.pipe(writeStream);
    });
  },
  
  // Load cache information from disk
  loadCacheFromDisk() {
    try {
      const cacheFilePath = path.join(this.cacheDir, 'cache-index.json');
      
      if (fs.existsSync(cacheFilePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
        
        // Convert array back to Map
        cacheData.forEach(item => {
          // Only add if file still exists
          if (fs.existsSync(item.filePath)) {
            this.cache.set(item.videoId, item);
          }
        });
        
        console.log(`Loaded ${this.cache.size} videos from cache index`);
      }
    } catch (err) {
      console.error('Error loading cache from disk:', err);
    }
  },
  
  // Save cache information to disk
  saveCacheToDisk() {
    // Disabled cache index file
    return;
    
    /* Original code disabled
    try {
      const cacheFilePath = path.join(this.cacheDir, 'cache-index.json');
      
      // Convert Map to array for JSON serialization
      const cacheData = Array.from(this.cache.values());
      
      fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving cache to disk:', err);
    }
    */
  },
  
  // Clean up old cache entries (older than 30 days)
  cleanupCache() {
    try {
      const now = Date.now();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      // Check each cache entry in memory
      for (const [videoId, videoInfo] of this.cache.entries()) {
        const age = now - videoInfo.timestamp;
        
        if (age > maxAge) {
          // Delete the file
          if (fs.existsSync(videoInfo.filePath)) {
            fs.unlinkSync(videoInfo.filePath);
            console.log(`Deleted old cached video: ${videoInfo.filePath}`);
          }
          
          // Remove from memory cache
          this.cache.delete(videoId);
        }
      }
      
      // No need to save updated cache to disk anymore
      // this.saveCacheToDisk();
    } catch (err) {
      console.error('Error cleaning up cache:', err);
    }
  }
}.init(); // Initialize the cache

try {
    ffmpeg.setFfmpegPath('C:\\ffmpeg\\bin\\ffmpeg.exe');
} catch (error) {
    console.error('Error setting ffmpeg path:', error);
    try {
        ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
    } catch (err) {
        console.error('Could not set ffmpeg path:', err);
    }
}


const downloadYouTubeVideo = async (videoId, outputPath) => {
    return new Promise((resolve, reject) => {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Use a more resilient method with ytdl-core
        ytdl.getInfo(videoUrl, { requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } } })
            .then(info => {
                console.log(`Downloading video: ${info.videoDetails.title}`);

                const writeStream = fs.createWriteStream(outputPath);
                
                // Select 720p or lower resolution formats
                const stream = ytdl(videoUrl, { 
                    quality: 'highestvideo<=720p',
                    filter: format => {
                        return format.height && format.height <= 720 && format.hasAudio;
                    },
                    requestOptions: { 
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
                        } 
                    }
                });
                
                stream.pipe(writeStream);
                
                writeStream.on('finish', () => {
                    console.log(`Download completed: ${outputPath}`);
                    resolve(outputPath);
                });
                
                writeStream.on('error', (err) => {
                    console.error(`Error writing to file: ${err.message}`);
                    reject(err);
                });
                
                stream.on('error', (err) => {
                    console.error(`Error downloading video: ${err.message}`);
                    reject(err);
                });
            })
            .catch(err => {
                console.error(`Error getting video info: ${err.message}`);
                reject(err);
            });
    });
};


const downloadWithYtDlp = (videoId, outputPath) => {
    return new Promise((resolve, reject) => {
        // Updated command arguments for 720p or lower resolution
        const args = [
            `https://www.youtube.com/watch?v=${videoId}`,
            '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]', // Target 720p or lower
            '--no-check-certificate',
            '--extractor-args', 'youtube:player_client=android',
            '--cookies-from-browser', 'chrome',
            '--no-playlist',
            '-o', outputPath
        ];
        
        console.log('Running yt-dlp with args:', args.join(' '));
        const downloadProcess = spawn('yt-dlp', args);
        
        downloadProcess.stdout.on('data', (data) => {
            console.log(`yt-dlp stdout: ${data.toString()}`);
        });
        
        downloadProcess.stderr.on('data', (data) => {
            console.log(`yt-dlp stderr: ${data.toString()}`);
        });
        
        downloadProcess.on('error', (error) => {
            if (error.code === 'ENOENT') {
                reject(new Error('yt-dlp command not found. Please make sure yt-dlp is installed and in your PATH.'));
            } else {
                reject(error);
            }
        });
        
        downloadProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`Download completed: ${outputPath}`);
                resolve(outputPath);
            } else {
                reject(new Error(`yt-dlp process exited with code ${code}`));
            }
        });
    });
};

// Check if yt-dlp is installed
const isYtDlpInstalled = async () => {
    return new Promise((resolve) => {
        try {
            const ytdlpProcess = spawn('yt-dlp', ['--version']);
            
            ytdlpProcess.on('error', () => {
                resolve(false);
            });
            
            ytdlpProcess.on('close', (code) => {
                resolve(code === 0);
            });
        } catch (err) {
            resolve(false);
        }
    });
};

// Download YouTube video using youtube-dl-exec (most reliable method)
const downloadWithYoutubeDlExec = async (videoId, outputPath) => {
    try {
        console.log('Downloading video with youtube-dl-exec...');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Get video info first with updated options
        const info = await youtubeDl(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            forceIpv4: true,
            extractorArgs: 'youtube:player_client=android' // Add this to bypass signature issues
        });
        
        console.log(`Video title: ${info.title}, Duration: ${info.duration}s`);
        
        // Download the video with updated options for 720p or lower
        await youtubeDl(videoUrl, {
            output: outputPath,
            format: 'bestvideo[height<=720]+bestaudio/best[height<=720]', // Target 720p or lower
            noCheckCertificates: true,
            forceIpv4: true,
            extractorArgs: 'youtube:player_client=android'
        });
        
        console.log(`Download completed: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('youtube-dl-exec download error:', error.message);
        throw error;
    }
};

// Modified the downloadWithAPIProxy function to use different API endpoints
const downloadWithAPIProxy = async (videoId, outputPath) => {
    try {
        console.log('Attempting download through API proxy...');

        const writer = fs.createWriteStream(outputPath);

        // Try an alternative API
        const proxyUrl = `https://invidiou.site/api/v1/videos/${videoId}`;
        
        // Use standard axios
        const response = await axios.get(proxyUrl);
        if (!response.data || !response.data.formatStreams || response.data.formatStreams.length === 0) {
            throw new Error('No valid streams found for video');
        }
        
        // Filter for formats that are 720p or lower and sort by quality
        const streams = response.data.formatStreams
            .filter(stream => {
                const height = parseInt(stream.quality) || 0;
                return !isNaN(height) && height <= 720;
            })
            .sort((a, b) => {
                const heightA = parseInt(a.quality) || 0;
                const heightB = parseInt(b.quality) || 0;
                return heightB - heightA; // Sort in descending order (highest quality first)
            });
        
        // If no 720p or lower formats, use any available format
        let selectedStream = streams.length > 0 ? streams[0] : response.data.formatStreams[0];
        
        console.log(`Selected stream quality: ${selectedStream.quality}`);
        
        const videoResponse = await axios({
            method: 'GET',
            url: selectedStream.url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        videoResponse.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`API download completed: ${outputPath}`);
                resolve(outputPath);
            });
            
            writer.on('error', err => {
                console.error('Error writing video file:', err.message);
                reject(err);
            });
        });
    } catch (error) {
        console.error('API proxy download error:', error.message);
        
        // Try an alternative API if the first one fails
        try {
            console.log('Trying alternative API endpoint...');
            const writer = fs.createWriteStream(outputPath);
            
            const altProxyUrl = `https://vid.puffyan.us/api/v1/videos/${videoId}`;
            const response = await axios.get(altProxyUrl);
            
            if (!response.data || !response.data.formatStreams || response.data.formatStreams.length === 0) {
                throw new Error('No valid streams found from alternative API');
            }
            
            // Filter for formats that are 720p or lower and sort by quality
            const streams = response.data.formatStreams
                .filter(stream => {
                    const height = parseInt(stream.quality) || 0;
                    return !isNaN(height) && height <= 720;
                })
                .sort((a, b) => {
                    const heightA = parseInt(a.quality) || 0;
                    const heightB = parseInt(b.quality) || 0;
                    return heightB - heightA; // Sort in descending order
                });
            
            // If no 720p or lower formats, use any available format
            let selectedStream = streams.length > 0 ? streams[0] : response.data.formatStreams[0];
            
            console.log(`Selected stream quality from alternative API: ${selectedStream.quality}`);
            
            const videoResponse = await axios({
                method: 'GET',
                url: selectedStream.url,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            videoResponse.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`Alternative API download completed: ${outputPath}`);
                    resolve(outputPath);
                });
                
                writer.on('error', err => {
                    console.error('Error writing video file:', err.message);
                    reject(err);
                });
            });
        } catch (altError) {
            console.error('Alternative API download error:', altError.message);
            throw error; // Throw the original error
        }
    }
};

// Download a YouTube thumbnail as fallback
const downloadThumbnail = async (videoId, outputBasePath) => {
    try {
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        const outputPath = `${outputBasePath}.jpg`;
        
        // Use standard axios instead of axiosWithProxy
        const response = await axios({
            method: 'get',
            url: thumbnailUrl,
            responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(outputPath);
        
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Downloaded thumbnail: ${outputPath}`);
                resolve(outputPath);
            });
            
            writer.on('error', (err) => {
                reject(err);
            });
        });
    } catch (error) {
        console.error(`Error downloading thumbnail: ${error.message}`);
        throw error;
    }
};

// Try a direct download using a custom fetch approach when all else fails
const downloadWithDirectFetch = async (videoId, outputPath) => {
    try {
        console.log('Attempting direct download with fetch approach...');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Use standard axios with a proper user agent
        const response = await axios.get(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = response.data;
        
        // Simple regex extraction of video info - this is a fallback method
        const ytInitialPlayerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (!ytInitialPlayerMatch) {
            throw new Error('Could not find ytInitialPlayerResponse');
        }
        
        // Try to parse the player response JSON
        let playerResponse;
        try {
            playerResponse = JSON.parse(ytInitialPlayerMatch[1]);
        } catch (e) {
            throw new Error('Failed to parse player response');
        }
        
        // Find suitable formats to download - prioritize 720p or lower
        const formats = playerResponse?.streamingData?.formats || [];
        const adaptiveFormats = playerResponse?.streamingData?.adaptiveFormats || [];
        
        if (formats.length === 0 && adaptiveFormats.length === 0) {
            throw new Error('No formats found');
        }
        
        // Look for formats with height <= 720, sorted by quality (highest first)
        const eligibleFormats = [...formats, ...adaptiveFormats]
            .filter(format => 
                format.height && 
                format.height <= 720 && 
                format.url && 
                // Make sure it has both video and audio or just video with highest quality
                (format.audioQuality || formats.includes(format))
            )
            .sort((a, b) => (b.height || 0) - (a.height || 0));
        
        // Fall back to any format with a URL if no eligible formats
        const format = eligibleFormats.length > 0 ? eligibleFormats[0] : 
                      formats.find(f => f.url) || 
                      adaptiveFormats.find(f => f.url);
        
        if (!format || !format.url) {
            throw new Error('No direct URL found in eligible formats');
        }
        
        console.log(`Selected format: ${format.qualityLabel || format.quality || 'unknown'} (height: ${format.height || 'unknown'})`);
        
        // Download the video
        const writer = fs.createWriteStream(outputPath);
        
        const videoResponse = await axios({
            method: 'GET',
            url: format.url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        videoResponse.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Direct fetch download completed: ${outputPath}`);
                resolve(outputPath);
            });
            
            writer.on('error', err => {
                console.error('Error writing video file:', err.message);
                reject(err);
            });
        });
    } catch (error) {
        console.error('Direct fetch download error:', error.message);
        throw error;
    }
};

// Just download the YouTube video by ID
const downloadYouTubeVideoById = async (videoId, outputDir) => {
    try {
        // First check if the video is in the in-memory cache
        if (videoCache.hasVideo(videoId)) {
            console.log(`Found ${videoId} in memory cache, using cached version`);
            
            // Generate a unique filename
            const filename = `${videoId}_${Date.now()}.mp4`;
            const outputPath = path.join(outputDir, filename);
            
            // Copy from cache to the output directory
            await videoCache.copyToPath(videoId, outputPath);
            
            return outputPath;
        }
        
        // If not in cache, download normally
        console.log(`Video ${videoId} not found in cache, downloading...`);
        
        // Generate a unique filename
        const filename = `${videoId}_${Date.now()}.mp4`;
        const outputPath = path.join(outputDir, filename);
        
        // Also create a cache path
        const cachePath = videoCache.getCachePath(videoId);
        
        const methods = [
            {
                name: 'youtube-dl-exec',
                fn: async () => await downloadWithYoutubeDlExec(videoId, outputPath)
            },
            {
                name: 'yt-dlp',
                fn: async () => {
                    const ytDlpAvailable = await isYtDlpInstalled();
                    if (!ytDlpAvailable) {
                        throw new Error('yt-dlp not available');
                    }
                    return await downloadWithYtDlp(videoId, outputPath);
                }
            },
            {
                name: 'API proxy',
                fn: async () => await downloadWithAPIProxy(videoId, outputPath)
            },
            {
                name: 'direct fetch',
                fn: async () => await downloadWithDirectFetch(videoId, outputPath)
            },
            {
                name: 'ytdl-core',
                fn: async () => await downloadYouTubeVideo(videoId, outputPath)
            },
            {
                name: 'thumbnail fallback',
                fn: async () => await downloadThumbnail(videoId, outputPath)
            }
        ];

        let lastError = null;
        for (const method of methods) {
            try {
                console.log(`Trying download method: ${method.name}`);
                const result = await method.fn();
                console.log(`Successfully downloaded with ${method.name}`);
                
                // Only cache MP4 files, not images
                if (!result.endsWith('.jpg')) {
                    try {
                        // Copy file to cache
                        fs.copyFileSync(result, cachePath);
                        
                        // Add to in-memory cache only
                        videoCache.addVideo(videoId, cachePath, {
                            downloadMethod: method.name
                        });
                        
                        console.log(`Added ${videoId} to in-memory cache`);
                    } catch (cacheErr) {
                        console.error(`Failed to cache video: ${cacheErr.message}`);
                        // Continue even if caching fails
                    }
                }
                
                return result;
            } catch (error) {
                console.error(`Failed with ${method.name}: ${error.message}`);
                lastError = error;
                // Continue to next method
            }
        }
        
        // If we get here, all methods failed
        throw new Error(`All download methods failed: ${lastError.message}`);
    } catch (error) {
        throw error;
    }
};

// Function to trim video using ffmpeg
const trimVideo = async (inputPath, outputPath, startTime, endTime) => {
    return new Promise((resolve, reject) => {
        console.log(`Trimming video from ${startTime}s to ${endTime}s`);
        
        // Calculate duration
        const duration = endTime - startTime;
        if (duration <= 0) {
            return reject(new Error('Invalid time range: endTime must be greater than startTime'));
        }
        
        ffmpeg(inputPath)
            .setStartTime(startTime)
            .setDuration(duration)
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('FFmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`Trimming progress: ${progress.percent.toFixed(1)}%`);
                }
            })
            .on('end', () => {
                console.log(`Trimming completed: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`Trimming error: ${err.message}`);
                reject(err);
            })
            .run();
    });
};

// Function to merge multiple video clips into one
const mergeVideoClips = async (clipPaths, outputPath) => {
    return new Promise(async (resolve, reject) => {
        if (!clipPaths || clipPaths.length === 0) {
            return reject(new Error('No clips provided for merging'));
        }

        console.log(`Attempting to merge ${clipPaths.length} clips into a single video`);
        
        // Filter out image files and only keep video files
        const videoClips = clipPaths.filter(path => !path.endsWith('.jpg'));
        const imageClips = clipPaths.filter(path => path.endsWith('.jpg'));
        
        console.log(`Found ${videoClips.length} video clips and ${imageClips.length} image clips`);
        
        if (videoClips.length === 0) {
            // If we only have images, try to convert at least one to a video
            if (imageClips.length > 0) {
                try {
                    console.log('Attempting to create a slideshow from thumbnails...');
                    const slideshowPath = path.join(path.dirname(outputPath), 'slideshow.mp4');
                    
                    // Create a simple 5-second video from the first thumbnail
                    await new Promise((resolveSlideshow, rejectSlideshow) => {
                        ffmpeg(imageClips[0])
                            .loop(5) // 5 seconds duration
                            .videoFilters('scale=1280:-1') // Scale to 720p width
                            .outputOptions('-c:v libx264', '-pix_fmt yuv420p', '-r 30')
                            .noAudio()
                            .output(slideshowPath)
                            .on('end', () => {
                                console.log('Created slideshow from thumbnail');
                                resolveSlideshow(slideshowPath);
                            })
                            .on('error', (err) => {
                                console.error('Failed to create slideshow:', err.message);
                                rejectSlideshow(err);
                            })
                            .run();
                    });
                    
                    // Copy the slideshow to the output path
                    fs.copyFileSync(slideshowPath, outputPath);
                    console.log(`Created a video from thumbnail and saved to: ${outputPath}`);
                    return resolve(outputPath);
                } catch (err) {
                    console.error('Failed to create video from thumbnails:', err.message);
                    return reject(new Error('Failed to create video from thumbnails. All download methods only produced images. Please try again with different videos or check your network connection.'));
                }
            } else {
                return reject(new Error('No valid video clips to merge. All download methods failed to produce video files. Please try again with different videos or check your network connection.'));
            }
        }
        
        if (videoClips.length === 1) {
            console.log('Only one video clip to merge. Copying to output path...');
            try {
                fs.copyFileSync(videoClips[0], outputPath);
                return resolve(outputPath);
            } catch (err) {
                return reject(new Error(`Error copying single video: ${err.message}`));
            }
        }

        try {
            const concatFilePath = path.join(path.dirname(outputPath), 'concat_list.txt');
            const concatContent = videoClips.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');

            fs.writeFileSync(concatFilePath, concatContent);

            const ffmpegCmd = ffmpeg()
                .input(concatFilePath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .outputOptions('-c copy')
                .output(outputPath);

            ffmpegCmd.on('start', (commandLine) => {
                console.log('FFmpeg merge command:', commandLine);
            });

            ffmpegCmd.on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`Merging progress: ${progress.percent.toFixed(1)}%`);
                }
            });
            
            ffmpegCmd.on('end', () => {
                console.log(`Merged video saved to: ${outputPath}`);
                
                try {
                    fs.unlinkSync(concatFilePath);
                } catch (err) {
                    console.error(`Failed to delete concat file: ${err.message}`);
                }
                
                resolve(outputPath);
            });
            
            ffmpegCmd.on('error', (err) => {
                console.error(`Error during video merge: ${err.message}`);
                reject(err);
            });
            
            ffmpegCmd.run();
        } catch (error) {
            console.error(`Error setting up video merge: ${error.message}`);
            reject(error);
        }
    });
};

const processClip = async (req, res) => {
    const { videoId, startTime, endTime } = req.query;

    console.log("Processing single clip - videoId:", videoId);
    console.log("Processing single clip - startTime:", startTime);
    console.log("Processing single clip - endTime:", endTime);
    
    if (!videoId) {
        return res.status(400).json({
            success: false,
            message: 'Missing videoId parameter'
        });
    }
    
    try {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create a job directory with a unique ID
        const jobId = uuidv4();
        const jobDir = path.join(tempDir, jobId);
        fs.mkdirSync(jobDir, { recursive: true });

        console.log(`Created job directory for single clip: ${jobDir}`);

        // Step 1: Download the full video
        const downloadedPath = await downloadYouTubeVideoById(videoId, jobDir);
        
        // Step 2: Check if we need to trim the video
        let finalVideoPath = downloadedPath;
        
        // Only trim if both startTime and endTime are valid numbers
        if (startTime !== undefined && endTime !== undefined && 
            !isNaN(parseFloat(startTime)) && !isNaN(parseFloat(endTime))) {
            
            // Check if the file is an image (thumbnail fallback)
            if (downloadedPath.endsWith('.jpg')) {
                console.log('Cannot trim a thumbnail image. Skipping trim operation.');
            } else {
                const parsedStartTime = parseFloat(startTime);
                const parsedEndTime = parseFloat(endTime);

                const trimmedFilename = `${videoId}_${parsedStartTime}_${parsedEndTime}_${Date.now()}.mp4`;
                const trimmedPath = path.join(jobDir, trimmedFilename);

                try {
                    // Trim the video
                    finalVideoPath = await trimVideo(downloadedPath, trimmedPath, parsedStartTime, parsedEndTime);
                    
                    console.log("Final video path after trimming:", finalVideoPath);

                    try {
                        fs.unlinkSync(downloadedPath);
                        console.log(`Deleted original full video: ${downloadedPath}`);
                    } catch (deleteErr) {
                        console.error(`Failed to delete original video: ${deleteErr.message}`);
                    }
                } catch (trimError) {
                    console.error(`Failed to trim video: ${trimError.message}`);
                    console.log('Using the full video instead');
                }
            }
        } else {
            console.log('No valid startTime and endTime provided. Using full video.');
        }
        
        // Check if we should return a binary file or JSON
        const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
        
        if (!wantsJson && fs.existsSync(finalVideoPath)) {
            // Stream the file directly
            const stat = fs.statSync(finalVideoPath);
            const fileSize = stat.size;
            const fileName = path.basename(finalVideoPath);
            
            // Set appropriate headers
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            
            // Stream the file to the client
            const readStream = fs.createReadStream(finalVideoPath);
            readStream.pipe(res);
            
            // Handle errors in the stream
            readStream.on('error', (error) => {
                console.error('Error streaming file:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: 'Error streaming video file',
                        error: error.message
                    });
                }
            });
            
            return; // End execution here since we're streaming
        } else {
            // Return JSON with file information
            return res.status(200).json({
                success: true,
                message: 'Clip processed successfully',
                jobId: jobId,
                videoPath: path.relative(tempDir, finalVideoPath),
                isImage: finalVideoPath.endsWith('.jpg')
            });
        }
    } catch (error) {
        console.error('Error in processClip:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to process video clip',
            error: error.message
        });
    }
};

const mergeClips = async (req, res) => {
    const { clips } = req.body;

    try {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create a job directory with a unique ID
        const jobId = uuidv4();
        const jobDir = path.join(tempDir, jobId);
        fs.mkdirSync(jobDir, { recursive: true });

        console.log(`Created job directory: ${jobDir}`);

        // Array to store downloaded video paths
        const downloadedVideos = [];
        const failedDownloads = [];
        const processedClipPaths = [];
        
        // Early response for cached videos
        let cachedClips = [];
        if (clips.length > 0) {
            cachedClips = clips.filter(clip => videoCache.hasVideo(clip.videoId));
            
            // If we have some cached clips, send an early response
            if (cachedClips.length > 0) {
                // Send an early response that processing has started
                if (!res.headersSent) {
                    res.status(202).json({
                        success: true,
                        message: `Processing started with ${cachedClips.length}/${clips.length} clips from cache`,
                        jobId: jobId,
                        cachedClips: cachedClips.length,
                        totalClips: clips.length,
                        inProgress: true
                    });
                }
            }
        }
        
        // Process clips in parallel with limited concurrency
        const MAX_PARALLEL = 3; // Maximum parallel downloads
        const clipBatches = [];
        
        // Split clips into batches for processing
        for (let i = 0; i < clips.length; i += MAX_PARALLEL) {
            clipBatches.push(clips.slice(i, i + MAX_PARALLEL));
        }
        
        // Process each batch of clips in parallel
        for (const [batchIndex, batch] of clipBatches.entries()) {
            console.log(`Processing batch ${batchIndex + 1}/${clipBatches.length}`);
            
            // Process the current batch in parallel
            const batchPromises = batch.map(async (clip, clipIndex) => {
                const { videoId, startTime, endTime } = clip;
                const overallIndex = batchIndex * MAX_PARALLEL + clipIndex;
                
                console.log(`Processing video ${overallIndex + 1}/${clips.length}`);
                console.log("videoId: ", videoId);
                console.log("startTime: ", startTime);
                console.log("endTime: ", endTime);
                
                try {
                    // Step 1: Download the full video
                    const downloadedPath = await downloadYouTubeVideoById(videoId, jobDir);
                    
                    // Step 2: Check if we need to trim the video
                    let finalVideoPath = downloadedPath;
                    
                    // Only trim if both startTime and endTime are valid numbers
                    if (startTime !== undefined && endTime !== undefined && 
                        !isNaN(parseFloat(startTime)) && !isNaN(parseFloat(endTime))) {
                        
                        // Check if the file is an image (thumbnail fallback)
                        if (downloadedPath.endsWith('.jpg')) {
                            console.log('Cannot trim a thumbnail image. Skipping trim operation.');
                        } else {
                            const parsedStartTime = parseFloat(startTime);
                            const parsedEndTime = parseFloat(endTime);

                            const trimmedFilename = `${videoId}_${parsedStartTime}_${parsedEndTime}_${Date.now()}.mp4`;
                            const trimmedPath = path.join(jobDir, trimmedFilename);

                            try {
                                // Trim the video
                                finalVideoPath = await trimVideo(downloadedPath, trimmedPath, parsedStartTime, parsedEndTime);
                                
                                console.log("finalVideoPath: ", finalVideoPath);

                                try {
                                    fs.unlinkSync(downloadedPath);
                                    console.log(`Deleted original full video: ${downloadedPath}`);
                                } catch (deleteErr) {
                                    console.error(`Failed to delete original video: ${deleteErr.message}`);
                                }
                            } catch (trimError) {
                                console.error(`Failed to trim video: ${trimError.message}`);
                                console.log('Using the full video instead');
                                // Keep using the full video if trimming fails
                            }
                        }
                    } else {
                        console.log('No valid startTime and endTime provided. Using full video.');
                    }
                    
                    return {
                        success: true,
                        index: overallIndex,
                        videoId,
                        startTime: startTime || 0,
                        endTime: endTime || 0,
                        videoPath: finalVideoPath
                    };
                } catch (error) {
                    console.error(`Failed to process video ${overallIndex + 1}:`, error);
                    return {
                        success: false,
                        index: overallIndex,
                        videoId,
                        startTime: startTime || 0,
                        endTime: endTime || 0,
                        error: error.message
                    };
                }
            });
            
            // Wait for all clips in the batch to process
            const batchResults = await Promise.all(batchPromises);
            
            // Sort results into successful and failed downloads
            for (const result of batchResults) {
                if (result.success) {
                    downloadedVideos.push(result);
                    processedClipPaths.push(result.videoPath);
                } else {
                    failedDownloads.push(result);
                }
            }
        }

        if (downloadedVideos.length === 0) {
            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to process any videos',
                    failedDownloads,
                    jobId
                });
            }
            return;
        }

        let mergedVideoPath = null;
        let mergeSuccess = false;
        let s3Url = null;
        
        if (processedClipPaths.length > 0) {
            try {
                const mergedFilename = `merged_${Date.now()}.mp4`;
                mergedVideoPath = path.join(jobDir, mergedFilename);
                
                // Attempt to merge all clips into one video
                await mergeVideoClips(processedClipPaths, mergedVideoPath);
                mergeSuccess = true;
                console.log(`Successfully merged ${processedClipPaths.length} clips into: ${mergedVideoPath}`);
                
                // Upload the merged video to S3
                try {
                    const s3Key = `merged-videos/${jobId}/${mergedFilename}`;
                    s3Url = await uploadToS3(mergedVideoPath, s3Key);
                    console.log(`Successfully uploaded merged video to S3: ${s3Url}`);
                    
                    // Save S3 URL to a file so it can be retrieved later by status checks
                    const s3InfoFile = path.join(jobDir, 's3_info.json');
                    fs.writeFileSync(s3InfoFile, JSON.stringify({
                        url: s3Url,
                        key: s3Key,
                        timestamp: Date.now()
                    }, null, 2));
                } catch (s3Error) {
                    console.error(`Failed to upload to S3: ${s3Error.message}`);
                    // Continue with local file if S3 upload fails
                }
            } catch (mergeError) {
                console.error(`Failed to merge clips: ${mergeError.message}`);
                mergeSuccess = false;
            }
        }

        const requestedFormat = req.query.format || req.headers.accept;
        const wantsJson = requestedFormat === 'json' || (req.headers.accept && req.headers.accept.includes('application/json'));

        if (mergeSuccess && !wantsJson && fs.existsSync(mergedVideoPath) && !res.headersSent && !s3Url) {
            const stat = fs.statSync(mergedVideoPath);
            const fileSize = stat.size;
            const fileName = path.basename(mergedVideoPath);
            
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            const readStream = fs.createReadStream(mergedVideoPath);
            readStream.pipe(res);

            readStream.on('error', (error) => {
                console.error('Error streaming file:', error);

                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: 'Error streaming video file',
                        error: error.message
                    });
                }
            });
            
            return;
        } 

        else if (!mergeSuccess && processedClipPaths.length === 1 && !wantsJson && !res.headersSent && !s3Url) {
            const singleVideoPath = processedClipPaths[0];

            if (singleVideoPath.endsWith('.jpg')) {

                return res.status(200).json({
                    success: true,
                    message: "Processed 1 video successfully, but it's only a thumbnail image",
                    jobId: jobId,
                    videos: downloadedVideos,
                    isImage: true
                });
            }

            if (fs.existsSync(singleVideoPath)) {
                const stat = fs.statSync(singleVideoPath);
                const fileSize = stat.size;
                const fileName = path.basename(singleVideoPath);

                // Set appropriate headers
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Length', fileSize);
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                
                // Stream the file to the client
                const readStream = fs.createReadStream(singleVideoPath);
                readStream.pipe(res);
                
                // Handle errors in the stream
                readStream.on('error', (error) => {
                    console.error('Error streaming file:', error);
                    // Only send error if headers haven't been sent yet
                    if (!res.headersSent) {
                        res.status(500).json({
                            success: false,
                            message: 'Error streaming video file',
                            error: error.message
                        });
                    }
                });
                
                return; // End execution here since we're streaming
            }
        }

        // Fall back to JSON response if streaming isn't possible or JSON is requested
        if (!res.headersSent) {
            return res.status(200).json({
                success: true,
                message: `Processed ${downloadedVideos.length} videos successfully${failedDownloads.length > 0 ? `, ${failedDownloads.length} videos failed` : ''}${mergeSuccess ? ', and merged into a single video' : ''}`,
                jobId: jobId,
                videos: downloadedVideos,
                mergedVideo: mergeSuccess ? mergedVideoPath : undefined,
                s3Url: s3Url, // Add the S3 URL to the response
                failedDownloads: failedDownloads.length > 0 ? failedDownloads : undefined,
                // Add relative paths for frontend use
                videoPath: mergeSuccess ? path.relative(tempDir, mergedVideoPath) : undefined,
                relativePaths: processedClipPaths.map(clipPath => path.relative(tempDir, clipPath))
            });
        }

    } catch (error) {
        console.error('Error in mergeClips:', error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: 'Failed to process videos',
                error: error.message
            });
        }
    }
};

// Add a new controller function to check video processing status
const checkVideoStatus = async (req, res) => {
    try {
        const { jobId } = req.params;
        
        if (!jobId) {
            return res.status(400).json({
                success: false,
                message: 'No job ID provided'
            });
        }
        
        // Check if job directory exists
        const tempDir = path.join(__dirname, '../../temp');
        const jobDir = path.join(tempDir, jobId);
        
        if (!fs.existsSync(jobDir)) {
            return res.status(404).json({
                success: false,
                message: `Job ${jobId} not found`
            });
        }
        
        // Get all files in the job directory
        const files = fs.readdirSync(jobDir);
        
        // Find merged video file if it exists
        const mergedFile = files.find(file => file.startsWith('merged_'));
        
        // Count video files
        const videoFiles = files.filter(file => file.endsWith('.mp4'));
        
        // Check for S3 info file that may have been created during upload
        const s3InfoFile = path.join(jobDir, 's3_info.json');
        let s3Url = null;
        
        if (fs.existsSync(s3InfoFile)) {
            try {
                const s3Data = JSON.parse(fs.readFileSync(s3InfoFile, 'utf8'));
                s3Url = s3Data.url;
            } catch (error) {
                console.error('Error reading S3 info file:', error);
                // Continue without S3 URL
            }
        }
        
        // Check if the file is ready (merged file exists or S3 URL is available)
        const isReady = mergedFile !== undefined || s3Url !== null;
        
        return res.status(200).json({
            success: true,
            jobId,
            fileReady: isReady,
            files: mergedFile ? [mergedFile] : videoFiles,
            totalFiles: files.length,
            videoFiles: videoFiles.length,
            s3Url: s3Url,
            status: isReady
        });
    } catch (error) {
        console.error('Error checking video status:', error);
        return res.status(500).json({
            success: false,
            message: 'Error checking video status',
            error: error.message
        });
    }
};


const serveVideoFile = async (req, res) => {
    try {
        const { filePath } = req.params;
        const download = req.query.download === 'true';
        
        if (!filePath) {
            return res.status(400).json({
                success: false,
                message: 'No file path provided'
            });
        }
        
        // Construct the full path (make sure it's within the temp directory for security)
        const tempDir = path.join(__dirname, '../../temp');
        const fullPath = path.join(tempDir, filePath);
        
        // Validate the path to prevent directory traversal attacks
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedTempDir = path.normalize(tempDir);
        
        if (!normalizedFullPath.startsWith(normalizedTempDir)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        // Check if the file exists
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        
        // Get file stats
        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const fileName = path.basename(fullPath);
        
        // Handle range requests (for video seeking)
        const range = req.headers.range;
        if (range && !download) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            
            const file = fs.createReadStream(fullPath, { start, end });
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4'
            });
            
            file.pipe(res);
        } else {
            const headers = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes'
            };

            if (download) {
                headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
            } else {
                headers['Content-Disposition'] = `inline; filename="${fileName}"`;
            }

            res.writeHead(200, headers);
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch (error) {
        console.error('Error serving video file:', error);
        res.status(500).json({
            success: false,
            message: 'Error serving video file',
            error: error.message
        });
    }
};

module.exports = {
    processClip,
    mergeClips,
    serveVideoFile,
    checkVideoStatus
};