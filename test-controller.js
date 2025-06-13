require('dotenv').config();
const { getTranscript } = require('./controllers/initialVersion/getTranscript');

// Mock Express request and response objects
const mockReq = (videoId) => ({
  params: { videoId }
});

const mockRes = {
  status: function(statusCode) {
    console.log(`Status Code: ${statusCode}`);
    return this;
  },
  json: function(data) {
    console.log('Response Data:', JSON.stringify(data, null, 2));
    return this;
  }
};

async function testController() {
  try {
    // Test with a known video that has transcripts
    const videoId = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
    
    console.log(`Testing getTranscript controller with video ID: ${videoId}`);
    
    // Call the controller function
    await getTranscript(mockReq(videoId), mockRes);
    
    console.log('Test completed');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

testController(); 