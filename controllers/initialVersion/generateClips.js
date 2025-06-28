const OpenAI = require("openai");
const dotenv = require('dotenv');
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('OpenAI API key is missing. Please check your .env file.');
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    dangerouslyAllowBrowser: true
});

// More accurate token counting function for OpenAI models
const countTokens = (text) => {
    return Math.ceil(text.length / 4);
};

// Create chunks based on a maximum token count
const createTokenAwareChunks = (segments, maxTokensPerChunk = 40000) => {
    const reservedTokens = 5000;
    const effectiveMaxTokens = maxTokensPerChunk - reservedTokens;
    const chunks = [];
    let currentChunk = [];
    let currentChunkTokens = 0;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentJson = JSON.stringify(segment, null, 2);
        const segmentTokens = countTokens(segmentJson);

        if (segmentTokens > effectiveMaxTokens) {
            console.warn(`Segment at index ${i} exceeds token limit (${segmentTokens} tokens). Including it as a single chunk.`);
            if (currentChunk.length > 0) {
                chunks.push([...currentChunk]);
                currentChunk = [];
                currentChunkTokens = 0;
            }
            chunks.push([segment]);
            continue;
        }

        if (currentChunkTokens + segmentTokens > effectiveMaxTokens && currentChunk.length > 0) {
            chunks.push([...currentChunk]);
            currentChunk = [];
            currentChunkTokens = 0;
        }

        currentChunk.push(segment);
        currentChunkTokens += segmentTokens;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
};

// Sleep function for rate limit handling
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Make OpenAI API call with retry logic for rate limits
const callOpenAIWithRetry = async (messages, model, temperature, maxRetries = 3) => {
    let retries = 0;
    while (retries <= maxRetries) {
        try {
            const result = await openai.chat.completions.create({
                messages: messages,
                model: model,
                temperature: temperature,
            });
            return result;
        } catch (error) {
            if (error.error?.code === 'rate_limit_exceeded' && retries < maxRetries) {
                const retryAfterMs = error.headers?.['retry-after-ms']
                    ? parseInt(error.headers['retry-after-ms'])
                    : Math.pow(2, retries) * 1000;
                console.log(`Rate limit reached. Retrying in ${retryAfterMs / 1000} seconds...`);
                await sleep(retryAfterMs);
                retries++;
            } else {
                throw error;
            }
        }
    }
};

// Validation function to ensure clips are within bounds and meet prompt requirements
const validateClips = (clips, videoDuration, explicitDuration, isEndPart) => {
    for (const clip of clips) {
        const start = parseFloat(clip.startTime);
        const end = parseFloat(clip.endTime);
        if (start < 0 || end > videoDuration) {
            throw new Error(`Clip times out of bounds: ${start} to ${end}, video duration: ${videoDuration}`);
        }
        if (explicitDuration) {
            const duration = end - start;
            if (Math.abs(duration - explicitDuration) > 0.05) {
                throw new Error(`Clip duration mismatch: expected ${explicitDuration}, got ${duration}`);
            }
        }
        if (isEndPart) {
            const last20Percent = videoDuration * 0.8;
            if (start < last20Percent) {
                throw new Error(`Clip not from end part: starts at ${start}, should be after ${last20Percent}`);
            }
        }
    }
};

const generateClips = async (req, res) => {
    try {
        const { transcripts, customPrompt } = req.body;

        if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing transcripts data"
            });
        }

        // Extract video duration and segments from the first transcript object
        const videoTranscript = transcripts[0];
        const videoDuration = videoTranscript.duration;
        const segments = videoTranscript.segments;

        console.log(`Video duration: ${videoDuration}s, segments: ${segments.length}`);

        // Parse customPrompt for explicit duration and end-part requirements
        let explicitDuration = null;
        const durationMatch = customPrompt.match(/(\d+(?:\.\d+)?)\s*second(?:s)?/i);
        if (durationMatch) {
            explicitDuration = parseFloat(durationMatch[1]);
        }
        const isEndPart = /end|last/i.test(customPrompt);

        // Split segments into token-aware chunks
        const transcriptChunks = createTokenAwareChunks(segments, 40000);
        console.log(`Split segments into ${transcriptChunks.length} token-aware chunks`);

        let potentialSegments = [];

        for (let i = 0; i < transcriptChunks.length; i++) {
            const chunk = transcriptChunks[i];
            const isFirstChunk = i === 0;
            const isLastChunk = i === transcriptChunks.length - 1;

            const messages = [
                {
                    role: "system",
                    content: "You are a precise transcript processor and master storyteller with an emphasis on narrative cohesion and accuracy. When generating clips, you must maintain the exact wording from the source material while creating a compelling narrative flow. Never modify, paraphrase, or correct the original transcript text. Produce only valid JSON arrays with accurate numeric values and exact transcript quotes. Accuracy and fidelity to the original content remain your highest priority while creating an engaging storyline."
                }
            ];

            if (potentialSegments.length > 0 && !isFirstChunk) {
                messages.push({
                    role: "user",
                    content: `Important segments identified from previous chunks (for reference only):\n${JSON.stringify(potentialSegments, null, 2)}`
                });
                messages.push({
                    role: "assistant",
                    content: "I've noted these important segments from previous chunks and will consider them as I analyze the next chunk."
                });
            }

            let chunkPrompt;

            if (!isLastChunk) {
                chunkPrompt = `
USER CONTEXT: ${customPrompt || "Generate engaging clips from the transcript with accurate timestamps."}

ADDITIONAL CONSTRAINTS:
- The video duration is ${videoDuration.toFixed(2)} seconds.
- All clips must have startTime >= 0 and endTime <= ${videoDuration.toFixed(2)}.
${
    explicitDuration
        ? `- The clip must be exactly ${explicitDuration.toFixed(2)} seconds long (±0.05 seconds).`
        : '- Clip duration should be between 3.00 and 60.00 seconds.'
}
${
    isEndPart
        ? `- The clip must be from the end part of the video, starting after ${(videoDuration * 0.8).toFixed(2)} seconds.`
        : ''
}

TASK: This is chunk ${i+1} of ${transcriptChunks.length} of segment data.

Please analyze these segments and identify the most important 5-10 segments that could be part of a cohesive narrative. For each segment, provide:
1. The videoId
2. The exact transcript text (do not modify it)
3. The start and end times

Return the segments as a JSON array in this format:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript",
    "startTime": number,
    "endTime": number,
    "notes": "brief explanation of why this segment is important to the narrative"
  }
]

Segment Chunk ${i+1}/${transcriptChunks.length}:
${JSON.stringify(chunk, null, 2)}`;
            } else {
                chunkPrompt = `
USER CONTEXT: ${customPrompt || "Generate engaging clips from the transcript with accurate timestamps."}

ADDITIONAL CONSTRAINTS:
- The video duration is ${videoDuration.toFixed(2)} seconds.
- All clips must have startTime >= 0 and endTime <= ${videoDuration.toFixed(2)}.
${
    explicitDuration
        ? `- The clip must be exactly ${explicitDuration.toFixed(2)} seconds long (±0.05 seconds).`
        : '- Clip duration should be between 3.00 and 60.00 seconds.'
}
${
    isEndPart
        ? `- The clip must be from the end part of the video, starting after ${(videoDuration * 0.8).toFixed(2)} seconds.`
        : ''
}

TASK: This is the final chunk (${i+1} of ${transcriptChunks.length}) of segment data.

Now that you have analyzed all chunks of segment data, please create a cohesive narrative story by selecting and combining the most meaningful segments from ALL chunks, including those from previous important segments list and this final chunk.

IMPORTANT: Return ONLY a valid JSON array with the final clip selections. All numbers should be fixed to 2 decimal places. DO NOT use JavaScript expressions or functions.

OUTPUT FORMAT:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript - do not modify or paraphrase",
    "startTime": number (add buffer of -2.00 if start > 2.00),
    "endTime": number (add buffer of +2.00)
  }
]

RULES:
1. TIMESTAMPS:
   - Use exact numbers with 2 decimal places
   - Add 2.00 second buffer at start (if start > 2.00)
   - Add 2.00 second buffer at end
   - Minimum 0.50 second gap between clips
   - Duration: 3.00-60.00 seconds unless specified otherwise
   - No overlapping segments

2. CONTENT ACCURACY:
   - Use EXACT quotes from transcripts without modification
   - Never paraphrase or reword the transcript content
   - Retain all verbal nuances from the original
   - Include complete sentences with their full context
   - Maintain perfect accuracy of the spoken content

3. NARRATIVE STORYTELLING:
   - Build a coherent story with a beginning, middle, and end
   - Select segments that connect logically and thematically
   - Create smooth transitions between different transcript segments
   - Ensure the assembled clips tell a compelling, unified story
   - Identify and highlight key narrative elements across transcripts

4. SELECTION CRITERIA:
   - Maintain narrative flow and story progression
   - Focus on relevant, meaningful content
   - Remove filler content and digressions
   - Prioritize clarity and articulation
   - Select segments with clear speech and minimal background noise
   - Choose segments that contribute meaningfully to the story arc

Here are the important segments from previous chunks:
${JSON.stringify(potentialSegments, null, 2)}

Current (final) chunk data:
${JSON.stringify(chunk, null, 2)}

Remember: Return ONLY a valid JSON array with proper numeric values (no expressions). While creating a compelling narrative is important, transcript accuracy is still the highest priority.`;
            }

            messages.push({ role: "user", content: chunkPrompt });

            console.log(`Processing chunk ${i+1}/${transcriptChunks.length}...`);
            const result = await callOpenAIWithRetry(messages, "gpt-4o-mini-2024-07-18", 0.2);

            const responseContent = result.choices[0].message.content;

            if (isLastChunk) {
                console.log("Final response received from OpenAI");
                let clips;
                try {
                    const jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                    const jsonContent = jsonMatch ? jsonMatch[0] : responseContent;
                    clips = JSON.parse(jsonContent);
                    validateClips(clips, videoDuration, explicitDuration, isEndPart);
                } catch (error) {
                    console.error("Validation failed:", error.message);
                    // Fallback to last explicitDuration seconds
                    const fallbackDuration = explicitDuration || 11;
                    const startTime = Math.max(0, videoDuration - fallbackDuration);
                    const endTime = videoDuration;
                    const fallbackText = segments
                        .filter(s => s.startTime < endTime && s.endTime > startTime)
                        .map(s => s.text)
                        .join(' ');
                    clips = [{
                        videoId: videoTranscript.videoId || segments[0].videoId,
                        transcriptText: fallbackText || "No transcript available",
                        startTime: startTime.toFixed(2),
                        endTime: endTime.toFixed(2)
                    }];
                }

                return res.status(200).json({
                    success: true,
                    data: { script: JSON.stringify(clips) },
                    message: "Video script generated successfully"
                });
            } else {
                try {
                    const jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                    if (jsonMatch) {
                        const segmentsFromChunk = JSON.parse(jsonMatch[0]);
                        potentialSegments = [...potentialSegments, ...segmentsFromChunk].slice(-30);
                        console.log(`Added ${segmentsFromChunk.length} potential segments from chunk ${i+1}`);
                    }
                } catch (error) {
                    console.warn(`Error parsing segments from chunk ${i+1}: ${error.message}`);
                }
            }
        }
    } catch (error) {
        console.error("General error in generateClips:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to generate video script",
            error: error.message
        });
    }
};

module.exports = generateClips;