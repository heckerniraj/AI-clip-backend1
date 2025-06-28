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
    // A rough approximation: 1 token is roughly 4 characters for English text
    // This is still an approximation; for production, consider using a tokenizer library
    return Math.ceil(text.length / 4);
};

// Create chunks based on a maximum token count
const createTokenAwareChunks = (transcripts, maxTokensPerChunk = 40000) => {
    // Reserve tokens for system message and other conversation elements
    const reservedTokens = 5000;
    const effectiveMaxTokens = maxTokensPerChunk - reservedTokens;
    
    const chunks = [];
    let currentChunk = [];
    let currentChunkTokens = 0;
    
    for (let i = 0; i < transcripts.length; i++) {
        const transcript = transcripts[i];
        const transcriptJson = JSON.stringify(transcript, null, 2);
        const transcriptTokens = countTokens(transcriptJson);
        
        // If a single transcript exceeds the effective max tokens,
        // we need to include it alone (can't split JSON objects easily)
        if (transcriptTokens > effectiveMaxTokens) {
            console.warn(`Transcript at index ${i} exceeds token limit (${transcriptTokens} tokens). Including it as a single chunk.`);
            
            // If we have items in the current chunk, finalize it first
            if (currentChunk.length > 0) {
                chunks.push([...currentChunk]);
                currentChunk = [];
                currentChunkTokens = 0;
            }
            
            // Add the large transcript as its own chunk
            chunks.push([transcript]);
            continue;
        }
        
        // If adding this transcript would exceed the token limit, finalize the current chunk
        if (currentChunkTokens + transcriptTokens > effectiveMaxTokens && currentChunk.length > 0) {
            chunks.push([...currentChunk]);
            currentChunk = [];
            currentChunkTokens = 0;
        }
        
        // Add the transcript to the current chunk
        currentChunk.push(transcript);
        currentChunkTokens += transcriptTokens;
    }
    
    // Add any remaining transcripts in the current chunk
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
            // Check if it's a rate limit error
            if (error.error?.code === 'rate_limit_exceeded' && retries < maxRetries) {
                // Get retry time from header or use exponential backoff
                const retryAfterMs = error.headers?.['retry-after-ms'] 
                    ? parseInt(error.headers['retry-after-ms'])
                    : Math.pow(2, retries) * 1000; // Exponential backoff: 1s, 2s, 4s, ...
                
                console.log(`Rate limit reached. Retrying in ${retryAfterMs/1000} seconds...`);
                await sleep(retryAfterMs);
                retries++;
            } else {
                // For other errors or if we've exhausted retries, throw the error
                throw error;
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

        console.log("Generating clips from transcripts:", transcripts.length);
        
        // Calculate total tokens in all transcripts
        const allTranscriptsJson = JSON.stringify(transcripts, null, 2);
        const totalTokens = countTokens(allTranscriptsJson);
        console.log(`Total estimated tokens in all transcripts: ${totalTokens}`);

        // Split transcripts into smaller token-aware chunks (max 40k tokens per chunk)
        const transcriptChunks = createTokenAwareChunks(transcripts, 40000);
        console.log(`Split transcripts into ${transcriptChunks.length} token-aware chunks`);
        
        // Log token counts for each chunk
        transcriptChunks.forEach((chunk, idx) => {
            const chunkJson = JSON.stringify(chunk, null, 2);
            const chunkTokens = countTokens(chunkJson);
            console.log(`Chunk ${idx+1}: ${chunk.length} transcripts, ~${chunkTokens} tokens`);
        });

        // Array to store important segments identified in each chunk
        let potentialSegments = [];
        
        // Process each chunk separately, maintaining a summary of important segments
        for (let i = 0; i < transcriptChunks.length; i++) {
            const chunk = transcriptChunks[i];
            const isFirstChunk = i === 0;
            const isLastChunk = i === transcriptChunks.length - 1;
            
            // Reset messages for each chunk to avoid token limit
            const messages = [
                {
                    role: "system",
                    content: "You are a precise transcript processor and master storyteller with an emphasis on narrative cohesion and accuracy. When generating clips, you must maintain the exact wording from the source material while creating a compelling narrative flow. Never modify, paraphrase, or correct the original transcript text. Your task is to identify the most meaningful segments across transcripts and weave them into a coherent story. Produce only valid JSON arrays with accurate numeric values and exact transcript quotes. Accuracy and fidelity to the original content remain your highest priority while creating an engaging storyline."
                }
            ];
            
            // If we have potential segments from previous chunks, include them
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
                // Processing chunks (first or middle) - identify important segments
                chunkPrompt = `
USER CONTEXT: ${customPrompt || "Generate engaging clips from the transcript with accurate timestamps."}

TASK: This is chunk ${i+1} of ${transcriptChunks.length} of transcript data. 

Please analyze these transcripts and identify the most important 5-10 segments that could be part of a cohesive narrative. For each segment, provide:
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

Transcript Chunk ${i+1}/${transcriptChunks.length}:
${JSON.stringify(chunk, null, 2)}`;
            } else {
                // Last chunk - generate the final output
                chunkPrompt = `
USER CONTEXT: ${customPrompt || "Generate engaging clips from the transcript with accurate timestamps."}

TASK: This is the final chunk (${i+1} of ${transcriptChunks.length}) of transcript data.

Now that you have analyzed all chunks of transcript data, please create a cohesive narrative story by selecting and combining the most meaningful segments from ALL chunks, including those from previous important segments list and this final chunk.

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
   - Duration: 3.00-60.00 seconds
   - No overlapping segments, if a clip has 6.00 to 10.00, the other clip shouldn't starting time 6.00 to 10.00 !important

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

            // Calculate token count for this chunk's prompt
            const promptTokens = countTokens(chunkPrompt);
            console.log(`Chunk ${i+1} prompt: ~${promptTokens} tokens`);

            // Add the current chunk prompt to the conversation
            messages.push({
                role: "user",
                content: chunkPrompt
            });

            console.log(`Processing chunk ${i+1}/${transcriptChunks.length}...`);
            
            try {
                // Call OpenAI with retry logic for rate limits
                const result = await callOpenAIWithRetry(
                    messages, 
                    "gpt-4o-mini-2024-07-18", 
                    0.2
                );

                // Get token usage information if available
                if (result.usage) {
                    console.log(`Chunk ${i+1} token usage:`, {
                        promptTokens: result.usage.prompt_tokens,
                        completionTokens: result.usage.completion_tokens,
                        totalTokens: result.usage.total_tokens
                    });
                }

                const responseContent = result.choices[0].message.content;

                // If this is the last chunk, we have the final result
                if (isLastChunk) {
                    console.log("Final response received from OpenAI");

                    // Extract the JSON portion from the response
                    let jsonMatch;
                    try {
                        // Try to find JSON array in the response
                        jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                        const jsonContent = jsonMatch ? jsonMatch[0] : responseContent;
                        
                        // Validate the JSON
                        JSON.parse(jsonContent);
                        
                        return res.status(200).json({
                            success: true,
                            data: {
                                script: jsonContent
                            },
                            message: "Video script generated successfully"
                        });
                    } catch (jsonError) {
                        console.error("Invalid JSON response from OpenAI:", responseContent);
                        return res.status(500).json({
                            success: false,
                            message: "Failed to generate valid JSON response",
                            error: jsonError.message
                        });
                    }
                } else {
                    // For non-final chunks, extract important segments and add to running list
                    try {
                        // Try to extract JSON from response
                        const jsonMatch = responseContent.match(/\[\s*\{.*\}\s*\]/s);
                        if (jsonMatch) {
                            const segmentsFromChunk = JSON.parse(jsonMatch[0]);
                            // Add to our running list, but limit to keep token count manageable
                            potentialSegments = [...potentialSegments, ...segmentsFromChunk].slice(-30);
                            console.log(`Added ${segmentsFromChunk.length} potential segments from chunk ${i+1}`);
                        } else {
                            console.warn(`No valid JSON segments found in response for chunk ${i+1}`);
                        }
                    } catch (error) {
                        console.warn(`Error parsing segments from chunk ${i+1}: ${error.message}`);
                        // Continue processing even if we can't extract segments
                    }
                    
                    console.log(`Chunk ${i+1} processed successfully`);
                }
                
            } catch (openaiError) {
                console.error(`OpenAI API error on chunk ${i+1}:`, openaiError);
                
                // Handle token limit errors specifically
                if (openaiError.error && openaiError.error.code === 'context_length_exceeded') {
                    console.error(`Token limit exceeded for chunk ${i+1}. Attempting to divide this chunk further.`);
                    
                    // If this is a large chunk that can't be processed, we could try dividing it further
                    // For simplicity in this example, we'll just return an error
                    return res.status(500).json({
                        success: false,
                        message: `Token limit exceeded for chunk ${i+1}. Please reduce the amount of transcript data.`,
                        error: openaiError.message
                    });
                }
                
                // Handle other specific OpenAI errors
                if (openaiError.status === 401) {
                    return res.status(500).json({
                        success: false,
                        message: "OpenAI API authentication failed. Please check your API key.",
                        error: openaiError.message
                    });
                } else if (openaiError.status === 429) {
                    return res.status(500).json({
                        success: false,
                        message: "OpenAI API rate limit exceeded. Please try again later.",
                        error: openaiError.message
                    });
                } else {
                    return res.status(500).json({
                        success: false,
                        message: `OpenAI API error on chunk ${i+1}`,
                        error: openaiError.message
                    });
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