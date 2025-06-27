const OpenAI = require("openai");
const dotenv = require('dotenv');
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('OpenAI API key is missing. Please check your .env file.');
    throw new Error('OpenAI API key is missing');
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY
});

// Token counting function
const countTokens = (text) => {
    return Math.ceil(text.length / 4);
};

// Create token-aware chunks
const createTokenAwareChunks = (transcripts, maxTokensPerChunk = 40000) => {
    const reservedTokens = 5000;
    const effectiveMaxTokens = maxTokensPerChunk - reservedTokens;
    const chunks = [];
    let currentChunk = [];
    let currentChunkTokens = 0;

    for (let i = 0; i < transcripts.length; i++) {
        const transcript = transcripts[i];
        const transcriptJson = JSON.stringify(transcript, null, 2);
        const transcriptTokens = countTokens(transcriptJson);

        if (transcriptTokens > effectiveMaxTokens) {
            console.warn(`Transcript at index ${i} exceeds token limit (${transcriptTokens} tokens). Including it as a single chunk.`);
            if (currentChunk.length > 0) {
                chunks.push([...currentChunk]);
                currentChunk = [];
                currentChunkTokens = 0;
            }
            chunks.push([transcript]);
            continue;
        }

        if (currentChunkTokens + transcriptTokens > effectiveMaxTokens && currentChunk.length > 0) {
            chunks.push([...currentChunk]);
            currentChunk = [];
            currentChunkTokens = 0;
        }

        currentChunk.push(transcript);
        currentChunkTokens += transcriptTokens;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
};

// Sleep function for rate limit handling
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// OpenAI API call with retry logic
const callOpenAIWithRetry = async (messages, model, temperature, maxRetries = 3) => {
    let retries = 0;
    while (retries <= maxRetries) {
        try {
            const result = await openai.chat.completions.create({
                messages,
                model,
                temperature,
            });
            return result;
        } catch (error) {
            if (error.code === 'rate_limit_exceeded' && retries < maxRetries) {
                const retryAfterMs = error.headers?.['retry-after-ms'] 
                    ? parseInt(error.headers['retry-after-ms'])
                    : Math.pow(2, retries) * 1000;
                console.log(`Rate limit reached. Retrying in ${retryAfterMs/1000} seconds...`);
                await sleep(retryAfterMs);
                retries++;
            } else {
                throw error;
            }
        }
    }
};

// Validation function
const validateClips = (clips, videoDuration, explicitDuration, isEndPart) => {
    if (!Array.isArray(clips) || clips.length === 0) {
        throw new Error('Empty or invalid JSON returned by the model.');
    }

    if (explicitDuration) {
        const bad = clips.find(
            (c) => Math.abs((parseFloat(c.endTime) - parseFloat(c.startTime)) - explicitDuration) > 0.05
        );
        if (bad) {
            throw new Error(
                `Clip duration mismatch (id: ${bad.videoId}). Expected ≈${explicitDuration}s, got ${
                    parseFloat(bad.endTime) - parseFloat(bad.startTime)
                }s`
            );
        }
    }

    if (isEndPart) {
        const last20Percent = videoDuration * 0.8;
        const bad = clips.find((c) => parseFloat(c.startTime) < last20Percent);
        if (bad) {
            throw new Error(
                `Clip not from end part (id: ${bad.videoId}). Expected start time >= ${last20Percent.toFixed(2)}s, got ${
                    parseFloat(bad.startTime).toFixed(2)
                }s`
            );
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

        console.log("Generating clips from transcripts:", transcripts.length);

        // Calculate video duration (assume single video for simplicity)
        const videoDuration = transcripts[transcripts.length - 1]?.end || 600; // Fallback to 600s
        console.log(`Estimated video duration: ${videoDuration}s`);

        // Extract explicit duration and end-part requirement
        let explicitDuration = null;
        const durationMatch = customPrompt.match(/(\d+(?:\.\d+)?)\s*second(?:s)?/i);
        if (durationMatch) {
            explicitDuration = parseFloat(durationMatch[1]);
        }
        const isEndPart = /end/i.test(customPrompt);

        // Log transcript segments in last 20% for debugging
        const last20Percent = videoDuration * 0.8;
        const endSegments = transcripts.filter(segment => segment.start >= last20Percent);
        console.log('Transcript segments in last 20%:', endSegments.map(s => ({
            text: s.text,
            start: s.start,
            end: s.end,
            duration: s.end - s.start
        })));

        // Split transcripts into token-aware chunks
        const transcriptChunks = createTokenAwareChunks(transcripts, 40000);
        console.log(`Split transcripts into ${transcriptChunks.length} token-aware chunks`);

        // Process chunks
        let potentialSegments = [];
        let finalClips = null;

        for (let i = 0; i < transcriptChunks.length; i++) {
            const chunk = transcriptChunks[i];
            const isLastChunk = i === transcriptChunks.length - 1;

            const messages = [
                {
                    role: "system",
                    content: "You are a precise clip-extractor. You MUST obey all timing rules exactly (±0.05 s) and output PURE JSON—no prose, no markdown. Prioritize exact duration and specified video section over narrative flow if required by the user prompt."
                }
            ];

            if (potentialSegments.length > 0 && !isLastChunk) {
                messages.push({
                    role: "user",
                    content: `Important segments from previous chunks:\n${JSON.stringify(potentialSegments, null, 2)}`
                });
                messages.push({
                    role: "assistant",
                    content: "Noted. I will consider these segments for the final output."
                });
            }

            const chunkPrompt = isLastChunk
                ? `
USER REQUEST: ${customPrompt}

TASK: This is the final chunk (${i+1} of ${transcriptChunks.length}) of transcript data.

Generate a clip that satisfies the user's request using segments from all chunks, including this one and previously identified important segments.

OUTPUT FORMAT:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript",
    "startTime": number,
    "endTime": number
  }
]

RULES:
1. TIMESTAMPS:
   - Use exact numbers with 2 decimal places.
   - Video duration is ${videoDuration.toFixed(2)} seconds.
   - ${
       explicitDuration
           ? `The clip MUST be EXACTLY ${explicitDuration.toFixed(2)} seconds (±0.05 seconds).`
           : 'Duration between 3.00 and 60.00 seconds.'
   }
   - ${
       isEndPart
           ? `The clip MUST start in the final 20% of the video (after ${last20Percent.toFixed(2)} seconds).`
           : ''
   }
   - If no suitable segment exists, use the last ${explicitDuration || 11}.00 seconds of the video.
   - Add 2.00-second buffer at start (if start > 2.00) and end, if possible, while maintaining exact duration.
   - No overlapping segments.

2. CONTENT ACCURACY:
   - Use EXACT quotes from transcripts without modification.
   - Combine multiple segments if needed to achieve the exact duration.
   - Retain all verbal nuances from the original.

3. SELECTION CRITERIA:
   - Prioritize user-specified duration and section (e.g., end part) over narrative flow.
   - Select segments with clear speech and minimal background noise.
   - Include complete sentences where possible, but ensure exact duration.

Important segments from previous chunks:
${JSON.stringify(potentialSegments, null, 2)}

Current chunk data:
${JSON.stringify(chunk, null, 2)}`
                : `
USER REQUEST: ${customPrompt}

TASK: This is chunk ${i+1} of ${transcriptChunks.length}.

Identify 5-10 important segments for a cohesive narrative. Provide:
1. The videoId
2. The exact transcript text
3. The start and end times
4. Brief notes on why the segment is important

Output format:
[
  {
    "videoId": "string",
    "transcriptText": "exact quote from transcript",
    "startTime": number,
    "endTime": number,
    "notes": "brief explanation"
  }
]

Current chunk data:
${JSON.stringify(chunk, null, 2)}`;

            messages.push({ role: "user", content: chunkPrompt });

            console.log(`Processing chunk ${i+1}/${transcriptChunks.length}...`);
            const result = await callOpenAIWithRetry(messages, "gpt-4o-mini-2024-07-18", 0.2);

            const responseContent = result.choices[0].message.content;

            if (isLastChunk) {
                // Try multiple attempts for the final chunk
                let clips = null;
                const maxAttempts = 3;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    try {
                        const jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                        clips = JSON.parse(jsonMatch ? jsonMatch[0] : responseContent);
                        validateClips(clips, videoDuration, explicitDuration, isEndPart);
                        break;
                    } catch (error) {
                        console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
                        if (attempt < maxAttempts - 1) {
                            console.log(`Retrying chunk ${i+1} with temperature 0...`);
                            const retryResult = await callOpenAIWithRetry(messages, "gpt-4o-mini-2024-07-18", 0);
                            responseContent = retryResult.choices[0].message.content;
                        } else {
                            console.warn('Max attempts reached. Falling back to last 11 seconds.');
                            clips = [{
                                videoId: transcripts[0].videoId,
                                transcriptText: endSegments[endSegments.length - 1]?.text || 'No transcript available',
                                startTime: (videoDuration - 11).toFixed(2),
                                endTime: videoDuration.toFixed(2)
                            }];
                        }
                    }
                }

                finalClips = clips;
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

        return res.status(200).json({
            success: true,
            data: { script: JSON.stringify(finalClips) },
            message: finalClips.length === 1 && finalClips[0].transcriptText.includes('No transcript available')
                ? 'No suitable 11-second segment found. Returning fallback clip from end of video.'
                : 'Video script generated successfully'
        });
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