const fs = require('fs');
const path = require('path');
const { uploadToS3, checkObjectExists, getSignedDownloadUrl } = require('../../utils/s3');

/**
 * A cache for videos stored in S3
 * This extends the local video cache to also check and store videos in S3
 */
class S3VideoCache {
  constructor() {
    this.cacheDir = path.join(__dirname, '../../temp/video_cache');
    this.cacheFile = path.join(this.cacheDir, 's3_cache_index.json');
    this.videos = new Map(); // In-memory cache mapping videoId -> { s3Key, url, metadata }
    this.maxCacheSize = 100;
    this.s3KeyPrefix = 'video-cache';
    
    this.init();
  }

  init() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    this.loadCacheFromDisk();
  }

  hasVideo(videoId) {
    return this.videos.has(videoId);
  }

  async getVideo(videoId) {
    if (!this.hasVideo(videoId)) {
      return null;
    }
    
    const cacheEntry = this.videos.get(videoId);
    
    // Create a signed URL for accessing the S3 object
    try {
      const signedUrl = await getSignedDownloadUrl(cacheEntry.s3Key);
      return {
        videoId,
        url: signedUrl,
        ...cacheEntry.metadata
      };
    } catch (error) {
      console.error(`Error getting signed URL for video ${videoId}:`, error);
      return null;
    }
  }

  async addVideo(videoId, filePath, metadata = {}) {
    if (!fs.existsSync(filePath)) {
      console.error(`Cannot add video to S3 cache: File does not exist: ${filePath}`);
      return false;
    }

    try {
      // Upload the video to S3
      const s3Key = `${this.s3KeyPrefix}/${videoId}_${Date.now()}${path.extname(filePath)}`;
      const s3Url = await uploadToS3(filePath, s3Key);
      
      // Add to the in-memory cache
      this.videos.set(videoId, {
        s3Key,
        url: s3Url,
        metadata,
        addedAt: Date.now()
      });
      
      // Save the updated cache to disk
      this.saveCacheToDisk();
      
      console.log(`Added video ${videoId} to S3 cache: ${s3Url}`);
      return true;
    } catch (error) {
      console.error(`Error adding video ${videoId} to S3 cache:`, error);
      return false;
    }
  }

  async checkS3ForVideo(videoId) {
    try {
      const s3Key = `${this.s3KeyPrefix}/${videoId}`;
      return await checkObjectExists(s3Key);
    } catch (error) {
      console.error(`Error checking S3 for video ${videoId}:`, error);
      return false;
    }
  }

  loadCacheFromDisk() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const cacheData = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        
        if (Array.isArray(cacheData)) {
          // Clear existing cache
          this.videos.clear();
          
          // Load each entry into the Map
          for (const entry of cacheData) {
            if (entry && entry.videoId) {
              this.videos.set(entry.videoId, {
                s3Key: entry.s3Key,
                url: entry.url,
                metadata: entry.metadata || {},
                addedAt: entry.addedAt || Date.now()
              });
            }
          }
          
          console.log(`Loaded ${this.videos.size} videos from S3 cache index`);
        }
      }
    } catch (error) {
      console.error('Error loading S3 video cache from disk:', error);
    }
  }

  saveCacheToDisk() {
    try {
      // Convert the Map to an array of objects
      const cacheData = Array.from(this.videos.entries()).map(([videoId, entry]) => ({
        videoId,
        s3Key: entry.s3Key,
        url: entry.url,
        metadata: entry.metadata,
        addedAt: entry.addedAt
      }));
      
      fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
      console.log(`Saved ${cacheData.length} videos to S3 cache index`);
    } catch (error) {
      console.error('Error saving S3 video cache to disk:', error);
    }
  }

  cleanupCache() {
    if (this.videos.size <= this.maxCacheSize) {
      return;
    }
    
    // Convert to array and sort by age (oldest first)
    const entries = Array.from(this.videos.entries())
      .sort((a, b) => a[1].addedAt - b[1].addedAt);
    
    // Keep only the most recent maxCacheSize entries
    const entriesToRemove = entries.slice(0, entries.length - this.maxCacheSize);
    
    for (const [videoId] of entriesToRemove) {
      this.videos.delete(videoId);
    }
    
    console.log(`Cleaned up S3 video cache, removed ${entriesToRemove.length} entries`);
    this.saveCacheToDisk();
  }
}

module.exports = {
  S3VideoCache
}; 