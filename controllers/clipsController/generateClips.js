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
    // ────────────────────────────
    // 1.  Gather request payload
    // ────────────────────────────
    let details = req.body.gotDetails;
    const customization = req.body.customization;
    const customPrompt = req.body.customPrompt || '';
    details = Object.entries(details).map(([k, v]) => ({ [k]: v }));

    // Detect explicit duration in user prompt (e.g. “11 seconds”)
    let explicitDuration = null;
    const m = /(?:^|\s)(\d+(?:\.\d+)?)\s*second(?:s)?/i.exec(customPrompt);
    if (m) explicitDuration = parseFloat(m[1]);

    // ────────────────────────────
    // 2. Build USER prompt
    // ────────────────────────────
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
       ? `The clip MUST be exactly ${explicitDuration.toFixed(
           2
         )} s (±0.05).`
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
      ? `${basePrompt}

Apply these style preferences:
- Tone: ${customization.tone}
- Length: ${customization.length}
- Style: ${customization.style}`
      : basePrompt;

    // Helper for retry logic
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

    // ────────────────────────────
    // 3.  First attempt (T=0.2)
    // ────────────────────────────
    let script = await callOpenAI(0.2);

    // Validation / potential retry
    const validate = (clips) => {
      if (!Array.isArray(clips) || clips.length === 0)
        throw new Error('Empty or invalid JSON returned by the model.');

      if (explicitDuration) {
        const bad = clips.find(
          (c) =>
            Math.abs(
              (parseFloat(c.endTime) - parseFloat(c.startTime)) -
                explicitDuration
            ) > 0.05
        );
        if (bad)
          throw new Error(
            `Clip duration mismatch (id: ${bad.videoId}). Expected ≈${explicitDuration}s`
          );
      }
    };

    const tryParse = (content) => {
      try {
        return JSON.parse(content);
      } catch {
        // Strip accidental markdown fences if present
        const cleaned = content.replace(/^```(?:json)?|```$/g, '').trim();
        return JSON.parse(cleaned);
      }
    };

    let clips;
    try {
      clips = tryParse(script);
      validate(clips);
    } catch (err) {
      // ─────────────────────────
      // 4.  Retry once (T=0.0)
      // ─────────────────────────
      console.warn('First attempt failed – retrying once:', err.message);
      script = await callOpenAI(0);
      clips = tryParse(script);
      validate(clips); // if this throws we’ll go to catch below
    }

    // ────────────────────────────
    // 5.  Success response
    // ────────────────────────────
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