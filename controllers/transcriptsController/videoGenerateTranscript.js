const { AssemblyAI } = require('assemblyai');
const path = require('path');
const fs = require('fs');

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY
});

const generateTranscript = async (videoUrl) => {
  try {
    console.log(`Starting transcription for: ${videoUrl}`);
    
    // Handle local file paths
    const isLocalFile = videoUrl.startsWith('/uploads/');
    let audioUrl = videoUrl;
    
    if (isLocalFile) {
      const filePath = path.join(__dirname, '../..', videoUrl);
      if (!fs.existsSync(filePath)) {
        throw new Error('Video file not found');
      }
      
      console.log('Uploading file to AssemblyAI...');
      const fileStream = fs.createReadStream(filePath);
      audioUrl = await client.files.upload(fileStream);
    }

    console.log('Submitting for transcription...');
     const transcript = await client.transcripts.create({
      audio_url: audioUrl,
      speaker_labels: true,
      auto_highlights: true,
      disfluencies: true,
      format_text: true
    });

    // Poll for completion with timeout
    const startTime = Date.now();
    const timeout = 600000; // 10 minutes
    
    while (transcript.status !== 'completed' && transcript.status !== 'error') {
      if (Date.now() - startTime > timeout) {
        throw new Error('Transcription timeout');
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      transcript = await client.transcripts.get(transcript.id);
      console.log(`Transcription status: ${transcript.status}`);
    }

    if (transcript.status === 'error') {
      throw new Error(transcript.error);
    }

    return {
      text: transcript.text,
      duration: transcript.audio_duration,
      segments: transcript.utterances?.map(u => ({
        start: u.start,
        end: u.end,
        text: u.text,
        speaker: u.speaker
      })) || [],
      words: transcript.words,
      confidence: transcript.confidence
    };

  } catch (error) {
    console.error('Transcription failed:', error);
    throw new Error(`Transcription error: ${error.message}`);
  }
};

module.exports = { generateTranscript };