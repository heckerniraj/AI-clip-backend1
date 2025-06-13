const mongoose = require("mongoose");
const FinalVideo = require("../../model/finalVideosSchema");

/**
 * Controller to add final merged video data to the database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Response with status and message
 */
const addFinalVideo = async (req, res) => {
  try {
    // Extract data from the request body
    const { clipsInfo, fileNames3, message, outputPath, s3Url, status, success } = req.body;
    
    // Calculate total duration from clips
    const totalDuration = clipsInfo.reduce((total, clip) => {
      return total + (clip.endTime - clip.startTime);
    }, 0);
    
    // Extract unique video IDs
    const uniqueVideoIds = [...new Set(clipsInfo.map(clip => clip.videoId))];
    
    // Take first videoId for thumbnail if available
    const thumbnailVideoId = clipsInfo.length > 0 ? clipsInfo[0].videoId : null;
    const thumbnailUrl = thumbnailVideoId ? `https://img.youtube.com/vi/${thumbnailVideoId}/maxresdefault.jpg` : null;
    
    // Generate title based on video content
    const defaultTitle = clipsInfo.length > 0 
      ? `Compilation of ${clipsInfo.length} clips` 
      : "Video Compilation";
    
    // Get job ID from filename if available
    const jobId = fileNames3.split('_')[1] || null;
    
    // Format source clips to match schema
    const sourceClips = clipsInfo.map((clip, index) => {
      return {
        videoId: clip.videoId,
        title: `Clip ${index + 1}: ${clip.transcriptText.substring(0, 30)}...`,
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration: clip.endTime - clip.startTime,
        thumbnail: `https://img.youtube.com/vi/${clip.videoId}/maxresdefault.jpg`,
        originalVideoTitle: clip.transcriptText.substring(0, 50)
      };
    });
    
    // Create stats object
    const stats = {
      totalClips: clipsInfo.length,
      totalDuration: totalDuration,
      processingTime: 0,
      mergeDate: new Date()
    };
    
    // Create new final video document
    const finalVideo = new FinalVideo({
      userId: req.body.userId || "user123", // Default value if not provided
      title: req.body.title || defaultTitle,
      description: req.body.description || `A compilation of ${clipsInfo.length} clips from ${uniqueVideoIds.length} videos`,
      jobId: jobId,
      duration: totalDuration,
      s3Url: s3Url,
      thumbnailUrl: req.body.thumbnailUrl || thumbnailUrl,
      userEmail: req.body.userEmail || "user@example.com", 
      userName: req.body.userName || "User", 
      sourceClips: sourceClips,
      contentTags: req.body.contentTags || [],
      highlights: req.body.highlights || [],
      stats: stats,
      publishedVideoId: req.body.publishedVideoId || null,
      createdAt: req.body.createdAt || new Date()
    });

    // Save the document to the database
    const savedVideo = await finalVideo.save();
    
    // Return success response
    return res.status(201).json({
      success: true,
      message: "Final video data saved successfully",
      data: savedVideo
    });
  } catch (error) {
    console.error("Error saving final video data:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save final video data",
      error: error.message
    });
  }
};

module.exports = addFinalVideo;
