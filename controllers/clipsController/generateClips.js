/* controllers/generateClips.js */
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

    // Assume video duration from last transcript or default to 600s
    const videoDuration = req.body.videoDuration || details[details.length - 1]?.end || 600;
    console.log('videoDuration:', videoDuration);

    const basePrompt = `
USER REQUEST: ${customPrompt}

TASK: Create engaging clip(s) that satisfy the user's request.

REQUIREMENTS:
1. Choose segments that directly match the request.
2. Keep full sentences and logical flow.
3. Remove filler words.
4. Timing rules:
   - ${
     explicitDuration
       ? `The clip MUST be exactly ${explicitDuration.toFixed(2)} s (±0.05).`
       : 'Minimum 3 s, maximum 60 s.'
   }
   - Add ~2 s buffer before & after, if possible.
   - All timestamps precise to 2 decimals.
${explicitDuration && /end/i.test(customPrompt)
  ? '- Take the clip from the FINAL part of the video.'
  : ''}

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
      if (explicitDuration) {
        const badDuration = clips.find(
          (c) =>
            Math.abs(
              (parseFloat(c.endTime) - parseFloat(c.startTime)) - explicitDuration
            ) > 0.05
        );
        if (badDuration)
          throw new Error(
            `Clip duration mismatch (id: ${badDuration.videoId}). Expected ≈${explicitDuration}s, got ${(parseFloat(badDuration.endTime) - parseFloat(badDuration.startTime)).toFixed(2)}s`
          );
      }
      const outOfBounds = clips.find(
        (c) => c.startTime < 0 || c.endTime > videoDuration
      );
      if (outOfBounds)
        throw new Error(
          `Clip timestamps out of bounds (id: ${outOfBounds.videoId}). Video duration is ${videoDuration}s`
        );
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
      try {
        clips = tryParse(script);
        validate(clips);
      } catch (retryErr) {
        console.warn('Retry failed:', retryErr.message);
        // Fallback: Generate a clip from the end if "end" is requested
        if (explicitDuration && /end/i.test(customPrompt)) {
          const fallbackStart = Math.max(0, videoDuration - explicitDuration);
          clips = [{
            videoId: details[0].videoId,
            transcriptText: 'Fallback clip from end',
            startTime: fallbackStart.toFixed(2),
            endTime: videoDuration.toFixed(2)
          }];
          console.log('Generated fallback clip:', clips);
        } else {
          throw retryErr; // If no fallback applies, throw the error
        }
      }
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