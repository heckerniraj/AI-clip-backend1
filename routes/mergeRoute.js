const router = require("express").Router();
const { mergeClips, processClip, serveVideoFile, checkVideoStatus } = require("../controllers/clipsMergeController/apifyMergeClips");
const { videoMergeClips } = require("../controllers/clipsMergeController/videoMergeClips");
const simpleMergeClips = require("../controllers/clipsMergeController/mergingClips");
const fs = require('fs');
const path = require('path');
const { getSignedDownloadUrl } = require('../utils/s3');
const { protect } = require('../middleware/authMiddleware');
// Route for merging clips (using the original complex implementation)
router.post("/clips", mergeClips);


// Route for processing a single clip
router.get("/process", processClip);

// Route for getting a public S3 URL for a video
router.get("/video/:jobId/public-url", async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDir = path.join(__dirname, '../temp', jobId);
    
    // Check if the job directory exists
    if (!fs.existsSync(jobDir)) {
      return res.status(404).json({
        success: false,
        message: `Job ID ${jobId} not found`
      });
    }
    
    // Check if S3 info file exists
    const s3InfoFile = path.join(jobDir, 's3_info.json');
    if (fs.existsSync(s3InfoFile)) {
      // Read the S3 info file
      const s3Info = JSON.parse(fs.readFileSync(s3InfoFile, 'utf8'));
      
      // Check if we have an S3 URL
      if (s3Info && s3Info.url) {
        // Return the existing S3 URL
        return res.status(200).json({
          success: true,
          s3Url: s3Info.url
        });
      }
      
      // If we have an S3 key but no URL, generate a new signed URL
      if (s3Info && s3Info.key) {
        const signedUrl = await getSignedDownloadUrl(s3Info.key, undefined, 3600); // 1 hour expiry
        
        // Update the S3 info file with the new URL
        s3Info.url = signedUrl;
        s3Info.timestamp = Date.now();
        fs.writeFileSync(s3InfoFile, JSON.stringify(s3Info, null, 2));
        
        return res.status(200).json({
          success: true,
          s3Url: signedUrl
        });
      }
    }
    
    // Look for merged video files in the job directory
    const files = fs.readdirSync(jobDir);
    const mergedVideoFile = files.find(file => file.startsWith('merged_') && file.endsWith('.mp4'));
    
    if (mergedVideoFile) {
      // We found a merged video file, but it's not uploaded to S3 yet
      // Instead of returning an error, let's upload it to S3 now
      try {
        console.log(`On-demand S3 upload requested for job ${jobId}, file: ${mergedVideoFile}`);
        
        // Import the S3 upload function
        const { uploadToS3 } = require('../utils/s3');
        
        // Generate an S3 key for this video
        const s3Key = `merged-videos/${jobId}/${mergedVideoFile}`;
        const mergedVideoPath = path.join(jobDir, mergedVideoFile);
        
        // Upload the file to S3
        const s3Url = await uploadToS3(mergedVideoPath, s3Key);
        console.log(`Successfully uploaded video to S3 on-demand: ${s3Url}`);
        
        // Save the S3 info to a file so we can retrieve it later
        const s3Info = {
          url: s3Url,
          key: s3Key,
          timestamp: Date.now()
        };
        
        fs.writeFileSync(s3InfoFile, JSON.stringify(s3Info, null, 2));
        
        // Return the new S3 URL
        return res.status(200).json({
          success: true,
          s3Url: s3Url,
          message: "Video was automatically uploaded to S3 for sharing"
        });
      } catch (uploadError) {
        console.error('Error uploading video to S3:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Error uploading video to S3 for sharing',
          error: uploadError.message
        });
      }
    }
    
    // No video file found
    return res.status(404).json({
      success: false,
      message: 'No video file found for this job ID'
    });
  } catch (error) {
    console.error('Error getting public URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting public URL for video',
      error: error.message
    });
  }
});

// Route for serving a video file by job ID and filename
router.get("/video/:jobId/:fileName", (req, res) => {
  const { jobId, fileName } = req.params;
  
  // Combine jobId and fileName to form the complete path
  const filePath = `${jobId}/${fileName}`;
  
  // Add filePath to req.params so serveVideoFile can access it
  req.params.filePath = filePath;
  
  // Call the existing serveVideoFile function
  serveVideoFile(req, res);
});

// Original route for serving video files
router.get("/video/:filePath", serveVideoFile);

router.post('/videoMerge', protect, async (req, res) => {
  try {
    const { clips, title, description } = req.body;
    const user = req.user;

    if (!clips || !Array.isArray(clips)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid clips data'
      });
    }

    const result = await videoMergeClips(clips, user, { title, description });
    
    res.status(200).json({
      success: true,
      data: {
        videoUrl: result.videoUrl,
        videoId: result.videoId,
        thumbnailUrl: result.thumbnailUrl,
        duration: result.duration
      }
    });
  } catch (error) {
    console.error('Merge route error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to merge clips'
    });
  }
});


module.exports = router;