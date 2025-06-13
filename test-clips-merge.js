// Test script for clips merge controller
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { mergingClips } = require('./controllers/clipsMergeController/mergingClips');

// Increase the timeout for long-running operations
const TEST_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// Check if FFmpeg is installed
const checkFfmpeg = () => {
  return new Promise((resolve, reject) => {
    exec('ffmpeg -version', (error, stdout, stderr) => {
      if (error) {
        console.error('❌ FFmpeg is not installed or not in PATH');
        console.error('Please install FFmpeg and make sure it is available in your PATH');
        console.error('See README.md for installation instructions');
        resolve(false);
      } else {
        console.log('✅ FFmpeg is installed and available');
        resolve(true);
      }
    });
  });
};

// Create temp dirs if they don't exist
const ensureDirs = () => {
  const tmpDir = path.join(__dirname, 'tmp');
  const outputDir = path.join(__dirname, 'output');
  
  if (!fs.existsSync(tmpDir)) {
    console.log('Creating tmp directory...');
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  if (!fs.existsSync(outputDir)) {
    console.log('Creating output directory...');
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  return { tmpDir, outputDir };
};

// Check AWS config
const checkAwsConfig = () => {
  console.log('Checking AWS configuration...');
  const requiredVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.warn(`Warning: Missing AWS environment variables: ${missingVars.join(', ')}`);
    console.warn('S3 upload functionality may not work correctly.');
  } else {
    console.log('✅ AWS environment variables found');
  }
};

// Run the test
const runTest = async () => {
  try {
    // 0. Check FFmpeg
    const ffmpegAvailable = await checkFfmpeg();
    if (!ffmpegAvailable) {
      console.error('Test cannot continue without FFmpeg');
      return;
    }
    
    // 1. Check directories
    const { tmpDir, outputDir } = ensureDirs();
    console.log(`✅ Directories ready: ${tmpDir}, ${outputDir}`);
    
    // 2. Check AWS config
    checkAwsConfig();
    
    // 3. Setup mock req and res
    const mockReq = {
      body: {
        clips: [
          // Two very short clips for testing
          { videoId: 'jNQXAC9IVRw', startTime: 0, endTime: 5 }, // "Me at the zoo" (first YouTube video)
          { videoId: 'dQw4w9WgXcQ', startTime: 0, endTime: 5 }  // Rick Astley's "Never Gonna Give You Up"
        ]
      }
    };
    
    let responseData = null;
    
    const mockRes = {
      status: (code) => {
        console.log(`Response status code: ${code}`);
        return mockRes;
      },
      json: (data) => {
        console.log('Response data:', data);
        responseData = data;
        return mockRes;
      }
    };
    
    console.log('Processing job with 2 clips (reduced to 5 seconds each for faster testing)...');
    console.log('- Video 1: jNQXAC9IVRw (0-5s)');
    console.log('- Video 2: dQw4w9WgXcQ (0-5s)');
    
    // 4. Call the controller
    console.log('\n== Starting controller execution ==\n');
    await mergingClips(mockReq, mockRes);
    console.log('\n== Controller execution completed ==\n');
    
    // 5. Check the output
    if (responseData && responseData.success) {
      console.log('✅ Test completed successfully!');
      console.log(`Output video URL: ${responseData.s3Url}`);
      console.log(`Local output path: ${responseData.videoPath}`);
    } else {
      console.log('❌ Test failed');
      if (responseData) {
        console.log(`Error: ${responseData.message}`);
      }
    }
    
  } catch (error) {
    console.error('Test error:', error);
  }
};

// Start the test with extended timeout
console.log('=== Starting Clips Merge Controller Test ===');
console.log(`Test timeout set to ${TEST_TIMEOUT/60000} minutes`);

// Set a timeout for the test to prevent it from running too long
const testTimeout = setTimeout(() => {
  console.error('❌ Test timed out after', TEST_TIMEOUT/60000, 'minutes');
  process.exit(1);
}, TEST_TIMEOUT);

// Run the test and clear the timeout when done
runTest()
  .then(() => {
    clearTimeout(testTimeout);
    console.log('=== Test script execution completed ===');
  })
  .catch(err => {
    clearTimeout(testTimeout);
    console.error('Uncaught error in test:', err);
  }); 