const { YoutubeTranscript } = require('youtube-transcript');
require('dotenv').config();

async function testTranscript(videoId) {
    try {
        console.log(`Attempting to fetch transcript for video ID: ${videoId}`);
        const transcriptList = await YoutubeTranscript.fetchTranscript(videoId);
        console.log(`Success! Found ${transcriptList.length} transcript segments`);
        console.log('First segment:', transcriptList[0]);
    } catch (error) {
        console.error('Error fetching transcript:', error.message);
        console.error('Full error:', error);
    }
}

// Test with a known video that has transcripts
const videoId = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
testTranscript(videoId); 