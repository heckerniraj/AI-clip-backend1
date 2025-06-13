const fs = require('fs');
const path = require('path');

// In-memory job tracking (in a production environment, use Redis or a database)
const jobTracker = new Map();

// Function to update job status
exports.updateJobStatus = (jobId, status, currentStep, message, result = null) => {
  console.log(`Updating job status: ${jobId}, status: ${status}, step: ${currentStep}`);
  jobTracker.set(jobId, {
    jobId,
    status, // 'pending', 'downloading', 'trimming', 'merging', 'uploading', 'completed', 'failed'
    currentStep,
    message,
    result,
    updatedAt: new Date().toISOString()
  });

  // Log the current jobs we're tracking for debugging
  console.log(`Currently tracking ${jobTracker.size} jobs`);
};

// Function to get job status
exports.getJobStatus = (req, res) => {
  const { jobId } = req.params;
  console.log(`Checking job status for ID: ${jobId}`);
  
  if (!jobId) {
    console.log('Job ID is missing in request');
    return res.status(400).json({
      success: false,
      message: 'Job ID is required'
    });
  }
  
  // Check if job exists in memory tracking
  if (jobTracker.has(jobId)) {
    console.log(`Found job ${jobId} in memory tracker`);
    const jobStatus = jobTracker.get(jobId);
    
    // Check if this is a completed job with s3Url in the result
    const response = {
      success: true,
      ...jobStatus
    };
    
    // If it's a completed job with s3Url, add it directly to the top level for easier frontend access
    if (jobStatus.status === 'completed' && jobStatus.result && jobStatus.result.s3Url) {
      response.s3Url = jobStatus.result.s3Url;
      response.status = true;
    }
    
    return res.status(200).json(response);
  }
  
  console.log(`Job ${jobId} not found in memory, checking output files...`);
  
  // If not in memory, check if there's an output file (job may have completed)
  // Check in both the configured output directory and a fallback path
  const outputFileName = `merged_${jobId}.mp4`;
  const paths = [
    path.join(__dirname, '../../../output', outputFileName),
    path.join(__dirname, '../../../../output', outputFileName), // Fallback path
    path.resolve(process.env.OUTPUT_DIR || './output', outputFileName) // Path from env var
  ];
  
  // Try each possible path
  let outputPath = null;
  for (const possiblePath of paths) {
    console.log(`Checking for output file at: ${possiblePath}`);
    if (fs.existsSync(possiblePath)) {
      console.log(`Found output file at: ${possiblePath}`);
      outputPath = possiblePath;
      break;
    }
  }
  
  if (outputPath) {
    // Guess the S3 URL based on file name
    const s3Url = `https://${process.env.AWS_S3_BUCKET || 'clipsmart'}.s3.amazonaws.com/merged-clips/${outputFileName}`;
    console.log(`Output file exists, using S3 URL: ${s3Url}`);
    
    // Job completed but not in memory tracker
    const completedStatus = {
      success: true,
      jobId,
      status: 'completed',
      message: 'Processing completed',
      currentStep: 'completed',
      result: {
        jobId: jobId,
        videoPath: outputPath,
        s3Url: s3Url,
        status: true
      }
    };
    
    // Store this status in memory for future requests
    jobTracker.set(jobId, completedStatus);
    
    return res.status(200).json(completedStatus);
  }
  
  // Check for jobs with similar patterns (fuzzy match for debugging)
  if (jobTracker.size > 0) {
    console.log('Available jobs in tracker:');
    for (const [trackedJobId, status] of jobTracker.entries()) {
      console.log(`- ${trackedJobId}: ${status.status} (${status.currentStep})`);
    }
  }
  
  // Create a dummy "processing" response in development mode to help with debugging
  if (process.env.NODE_ENV === 'development') {
    console.log('Development mode: Creating a dummy processing response');
    const dummyStatus = {
      success: true,
      jobId,
      status: 'processing',
      message: 'Job is being processed',
      currentStep: 'downloading',
      updatedAt: new Date().toISOString()
    };
    
    // Store this status for future requests
    jobTracker.set(jobId, dummyStatus);
    
    // For testing purposes in development, return this dummy response
    return res.status(200).json(dummyStatus);
  }
  
  // Job not found
  console.log(`Job ${jobId} not found in any storage`);
  return res.status(404).json({
    success: false,
    message: 'Job not found. It may have been cleaned up or never existed.'
  });
}; 