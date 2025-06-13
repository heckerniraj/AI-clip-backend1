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
        const model = "gpt-4o"

        let Details = req.body.gotDetails;
        const customization = req.body.customization;
        const customPrompt = req.body.customPrompt;
        

        console.log("Details-PC> ", Details);

        Details = Object.entries(Details).slice(0, 5).map(([key, value]) => ({ [key]: value }));

        const basePrompt = `
USER CONTEXT: ${customPrompt}

TASK: Create a cohesive video script by selecting and combining the most relevant segments from multiple video transcripts. The segments must have precise, non-overlapping timestamps and maintain a logical flow. Get the segments where the all the videos are relavent to each other and can able to create a single video which are cohesive narrative.

OUTPUT FORMAT - Respond with a JSON array using this exact structure without any other text or explanation:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript",
    "startTime": (original_start_time - 2).toFixed(2),
    "endTime": (original_end_time + 2).toFixed(2)
  }
]

CRITICAL TIMESTAMP RULES:
1. PRECISION REQUIREMENTS:
   - All timestamps must use toFixed(2) for exactly 2 decimal places
   - startTime and endTime must be exact numbers, not approximations
   - endTime must precisely match when the spoken content ends
   - No rounding of timestamps - use exact values

2. ENDTIME CALCULATION:
   - endTime must be the exact end of the spoken phrase
   - Add exactly 2.00 seconds to the original end timestamp
   - Verify the endTime matches the actual content end
   - Do not extend beyond the natural pause in speech
   - Must capture complete sentences/phrases

3. NO OVERLAPS:
   - Strict gap of minimum 0.50 seconds between segments
   - endTime of segment A + 0.50 < startTime of segment B
   - No exceptions to overlap prevention
   - Verify gaps between all adjacent segments

4. BUFFER ZONES:
   - Start buffer: Exactly -2.00 seconds (if start > 2.00)
   - End buffer: Exactly +2.00 seconds
   - All buffers must be precise to 2 decimal places
   - Buffers must not create overlaps

5. DURATION VALIDATION:
   - Minimum duration: 3.00 seconds
   - Maximum duration: 60.00 seconds
   - Calculate duration as (endTime - startTime).toFixed(2)
   - Verify each segment's duration is within limits

TIMESTAMP VALIDATION CHECKLIST:
1. Start Time Rules:
   - Must be >= 0.00
   - Must be at least 0.50s after previous segment's endTime
   - Must use .toFixed(2) for 2 decimal places
   - Must account for -2.00s buffer when > 2.00

2. End Time Rules:
   - Must precisely match content end
   - Must use .toFixed(2) for 2 decimal places
   - Must include exact +2.00s buffer
   - Must end at natural speech breaks
   - Must be > startTime by at least 3.00 seconds
   - Must leave 0.50s gap before next segment

3. Duration Verification:
   - Calculate: (endTime - startTime).toFixed(2)
   - Verify: 3.00 <= duration <= 60.00
   - Check natural speech boundaries
   - Ensure complete phrases are captured

CONTENT REQUIREMENTS:
1. EXACT QUOTES: Only use verbatim quotes from source transcripts
2. COMPLETE SEGMENTS: Include full sentences/thoughts, don't cut mid-sentence
3. LOGICAL FLOW: Ensure narrative continuity between segments
4. CONTEXT PRESERVATION: Don't combine unrelated segments
5. RELEVANCE: Select segments that best match the user's request: "${customPrompt}"

SEGMENT SELECTION CRITERIA:
1. Prioritize segments that directly address the user's topic
2. For gaming/kills clips: Focus on excited commentary and action moments
3. For educational content: Prioritize clear explanations and key points
4. For narrative content: Maintain story continuity
5. Remove filler content and repetitive segments

QUALITY CHECKS:
1. TIMESTAMP VERIFICATION:
   - Check each timestamp is properly formatted (XX.XX)
   - Verify buffers are correctly applied (-2s start, +2s end)
   - Confirm no timing overlaps or gaps < 0.5s
2. CONTENT VERIFICATION:
   - Validate complete sentences
   - Check context continuity
   - Verify proper videoId references

Source Transcripts:
${JSON.stringify(Details, null, 2)}

FINAL VALIDATION:
Before returning the response:
1. Verify each endTime matches actual content end
2. Confirm all timestamps use .toFixed(2)
3. Validate all gaps are >= 0.50 seconds
4. Check all buffers are exactly ±2.00 seconds
5. Ensure all durations are within limits
6. Verify complete phrases are captured
7. Test JSON parsing of the response

Remember:
- Use .toFixed(2) for all timestamps
- endTime must match exact content end
- Maintain precise 0.50s minimum gaps
- Apply exact ±2.00s buffers
- Follow user's specific requirements: "${customPrompt}"
- Return valid JSON array only`;

const enhancedPrompt = customization ? 
    `${basePrompt}

Style this selection according to:
- Tone: ${customization.tone}
- Length: ${customization.length}
- Style: ${customization.style}

Maintain the same JSON structure while incorporating these style preferences.`
    : basePrompt;
        
            console.log("Prompt-->" )

        const result =  await openai.chat.completions.create({
            messages: [{ role: "developer", content: enhancedPrompt }],
            model: "gpt-4o-mini-2024-07-18",
            store: true,
          });

        console.log("------")


        const scriptContent = result.choices[0].message.content;

        console.log(scriptContent);

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