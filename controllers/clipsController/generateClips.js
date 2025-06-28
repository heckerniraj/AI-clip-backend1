const OpenAI = require('openai');
const dotenv = require('dotenv');
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

const generateClips = async (req, res) => {
  try {
    let details = req.body.gotDetails;
    const customization = req.body.customization;
    const customPrompt = req.body.customPrompt || '';
    details = Object.entries(details).map(([k, v]) => ({ [k]: v }));

    let explicitDuration = null;
    const m = /(?:^|\s)(\d+(?:\.\d+)?)\s*second(?:s)?/i.exec(customPrompt);
    if (m) explicitDuration = parseFloat(m[1]);
    console.log('Received customPrompt:', customPrompt);
    console.log('Extracted explicitDuration:', explicitDuration);

    // Use provided video duration or fetch from transcript data
    const videoDuration = req.body.videoDuration || details[0]?.duration || 600;
    console.log('videoDuration:', videoDuration);

    const basePrompt = `USER REQUEST: ${customPrompt}

TASK: Create engaging clip(s) that satisfy the user's request.

REQUIREMENTS:
- Choose segments that directly match the request.
- Keep full sentences and logical flow.
- Remove filler words.
- Timing rules:
  - The clip MUST be within the video's duration of ${videoDuration.toFixed(2)} seconds.
  ${
    explicitDuration
      ? `- The clip MUST be exactly ${explicitDuration.toFixed(2)} seconds (±0.05).`
      : '- Minimum 3 seconds, maximum 60 seconds.'
  }
- Add ~2 seconds buffer before & after, if possible within ${videoDuration.toFixed(2)} seconds.
- All timestamps precise to 2 decimals.
${
  explicitDuration && /end/i.test(customPrompt)
    ? '- Take the clip from the FINAL part of the video.'
    : ''
}

OUTPUT FORMAT (plain JSON, no markdown):
[
  {
    "videoId": "string",
    "transcriptText": "exact quote",
    "startTime": number,
    "endTime": number
  }
]

Source transcripts:
${JSON.stringify(details, null, 2)}`.trim();

    const enhancedPrompt = customization
      ? `${basePrompt}\n\nApply these style preferences:\n- Tone: ${customization.tone}\n- Length: ${customization.length}\n- Style: ${customization.style}`
      : basePrompt;

    const callOpenAI = async (temperature) => {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        temperature,
        max_tokens: 4000,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise clip-extractor. ' +
              'You MUST obey all timing rules exactly (±0.05 s) and output PURE JSON—no prose, no markdown.'
          },
          { role: 'user', content: enhancedPrompt }
        ]
      });
      return resp.choices[0].message.content.trim();
    };

    const validate = (clips) => {
      if (!Array.isArray(clips) || clips.length === 0)
        throw new Error('Empty or invalid JSON returned by the model.');
      clips.forEach((clip) => {
        let { startTime, endTime } = clip;
        startTime = parseFloat(startTime);
        endTime = parseFloat(endTime);

        // Check bounds and adjust if necessary
        if (startTime < 0 || endTime > videoDuration) {
          console.warn(`Clip out of bounds: startTime=${startTime}, endTime=${endTime}, videoDuration=${videoDuration}`);
          if (startTime < 0) startTime = 0;
          if (endTime > videoDuration) endTime = videoDuration;
          clip.startTime = startTime.toFixed(2);
          clip.endTime = endTime.toFixed(2);
        }

        const duration = endTime - startTime;
        if (explicitDuration && Math.abs(duration - explicitDuration) > 0.05) {
          throw new Error(
            `Clip duration mismatch (id: ${clip.videoId}). Expected ≈${explicitDuration}s, got ${duration.toFixed(2)}s`
          );
        }
      });
    };

    const tryParse = (content) => {
      try {
        return JSON.parse(content);
      } catch {
        const cleaned = content.replace(/^```(?:json)?|```$/g, '').trim();
        return JSON.parse(cleaned);
      }
    };

    let script = await callOpenAI(0.2);
    let clips;
    try {
      clips = tryParse(script);
      validate(clips);
    } catch (err) {
      console.warn('First attempt failed – retrying once:', err.message);
      script = await callOpenAI(0);
      clips = tryParse(script);
      validate(clips);
    }

    return res.status(200).json({
      success: true,
      data: { script: JSON.stringify(clips) },
      message: 'Clips generated successfully'
    });
  } catch (error) {
    console.error('generateClips error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate clips',
      error: error.message
    });
  }
};

module.exports = generateClips;