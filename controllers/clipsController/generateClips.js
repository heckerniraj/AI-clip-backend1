const OpenAI = require("openai");
const dotenv = require('dotenv');
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    dangerouslyAllowBrowser: true
});


const generateClips = async (req, res) => {
    try {
        let Details = req.body.gotDetails;
        const customization = req.body.customization;
        const customPrompt = req.body.customPrompt;
        

        console.log("Details-PC> ", Details);

        Details = Object.entries(Details).map(([key, value]) => ({ [key]: value }));

        // Detect explicit duration request in the custom prompt (e.g., "11 second", "11 seconds")
        let explicitDuration = null;
        const durationMatch = /(?:^|\s)(\d+(?:\.\d+)?)\s*second(?:s)?/i.exec(customPrompt || '');
        if (durationMatch) {
            explicitDuration = parseFloat(durationMatch[1]);
        }

        const basePrompt = `
USER REQUEST: ${customPrompt}

TASK: Create engaging video clips by selecting the most relevant segments from the provided transcripts. Focus on segments that directly address the user's request while maintaining coherent narrative flow.

REQUIREMENTS:
1. Content Selection:
   - Choose segments that directly match the user's request: "${customPrompt}"
   - Ensure complete thoughts/sentences (no mid-sentence cuts)
   - Maintain logical flow between segments
   - Focus on high-impact, relevant content
   - Remove filler words and repetitive content

2. Timing Rules:
   - ${explicitDuration ? `The clip MUST have a duration of exactly ${explicitDuration.toFixed(2)} seconds (±0.05).` : 'Minimum clip duration: 3 seconds\n   - Maximum clip duration: 60 seconds'}
   - Add 2-second buffer before and after each clip (if possible)
   - Ensure 0.5-second gap between clips
   - All timestamps must be precise to 2 decimal places
   ${explicitDuration && /end/i.test(customPrompt) ? '- Clip should be taken from the FINAL part of the video (use the last available timestamps).' : ''}

OUTPUT FORMAT:
Return a JSON array with this structure:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript",
    "startTime": number.toFixed(2),
    "endTime": number.toFixed(2)
  }
]

Source Transcripts:
${JSON.stringify(Details, null, 2)}

Remember to:
1. Only use exact quotes from the transcripts
2. Ensure clips are cohesive and maintain context
3. Focus on the most relevant content for: "${customPrompt}"${explicitDuration ? `\n4. Clip duration must be exactly ${explicitDuration.toFixed(2)} seconds (±0.05).` : ''}`;

const enhancedPrompt = customization ? 
    `${basePrompt}

Style this selection according to:
- Tone: ${customization.tone}
- Length: ${customization.length}
- Style: ${customization.style}

Maintain the same JSON structure while incorporating these style preferences.`
    : basePrompt;
        
            console.log("Prompt-->" )

        const result = await openai.chat.completions.create({
            messages: [{ role: "user", content: enhancedPrompt }],
            model: "gpt-4-turbo-preview",
            temperature: 0.7,
            max_tokens: 4000,
        });

        let scriptContent;
        try {
            scriptContent = result.choices[0].message.content;
            JSON.parse(scriptContent);
        } catch (error) {
            throw new Error('Invalid response format from AI model');
        }

        return res.status(200).json({
            success: true,
            data: {
                script: scriptContent
            },
            message: "Video script generated successfully"
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to generate video script",
            error: error.message
        });
    }
};

module.exports = generateClips;