const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

/**
 * Check if required tools are installed
 * @returns {Object} Object with properties indicating if each tool is installed
 */
const checkToolsInstalled = async () => {
    const tools = {
        ytdlp: false,
        ffmpeg: false
    };
    
    // Check for yt-dlp
    try {
        // Use a promise with timeout to prevent hanging
        await new Promise((resolve, reject) => {
            const ytdlpProcess = spawn('yt-dlp', ['--version']);
            
            // Set a timeout in case the process hangs
            const timeout = setTimeout(() => {
                ytdlpProcess.kill();
                resolve(false);
            }, 3000);
            
            ytdlpProcess.on('error', (error) => {
                // This will catch ENOENT errors when the command is not found
                clearTimeout(timeout);
                console.log('yt-dlp check error:', error.message);
                resolve(false);
            });
            
            ytdlpProcess.on('close', (code) => {
                clearTimeout(timeout);
                tools.ytdlp = code === 0;
                resolve(true);
            });
        });
    } catch (error) {
        console.log('yt-dlp check exception:', error.message);
        tools.ytdlp = false;
    }
    
    try {
        await new Promise((resolve, reject) => {
            const ffmpegProcess = spawn('ffmpeg', ['-version']);
            
            const timeout = setTimeout(() => {
                ffmpegProcess.kill();
                resolve(false);
            }, 3000);
            
            ffmpegProcess.on('error', (error) => {
                // This will catch ENOENT errors when the command is not found
                clearTimeout(timeout);
                console.log('ffmpeg check error:', error.message);
                resolve(false);
            });
            
            ffmpegProcess.on('close', (code) => {
                clearTimeout(timeout);
                tools.ffmpeg = code === 0;
                resolve(true);
            });
        });
    } catch (error) {
        console.log('ffmpeg check exception:', error.message);
        tools.ffmpeg = false;
    }
    
    console.log('Tool check results:', tools);
    return tools;
};


const mergeClips = async (req, res) => {
    try {
        const { clips, videoId } = req.body;

        if (!clips || !Array.isArray(clips) || clips.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No clips provided for merging"
            });
        }

        if (!videoId) {
            return res.status(400).json({
                success: false,
                message: "No video ID provided"
            });
        }
        
        // Check if required tools are installed
        const tools = await checkToolsInstalled();
        
        if (!tools.ytdlp) {
            return res.status(500).json({
                success: false,
                message: "yt-dlp is not installed on the server",
                error: "missing_tools",
                details: {
                    missingTools: ["yt-dlp"],
                    installInstructions: {
                        windows: [
                            "1. Download yt-dlp.exe from the link below",
                            "2. Move the downloaded file to C:\\Windows or another folder in your PATH",
                            "3. Open a new Command Prompt or PowerShell to recognize the new command"
                        ],
                        linux: [
                            "Run: sudo apt install python3-pip && pip3 install yt-dlp",
                            "OR Run: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp"
                        ],
                        mac: [
                            "Run: brew install yt-dlp",
                            "OR Run: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp"
                        ]
                    },
                    alternativeMethod: "If you cannot install yt-dlp, you can manually download each clip section from YouTube and place them in the merged folder."
                }
            });
        }
        
        if (!tools.ffmpeg) {
            return res.status(500).json({
                success: false,
                message: "FFmpeg is not installed on the server",
                error: "missing_tools",
                details: {
                    missingTools: ["ffmpeg"],
                    installInstructions: {
                        windows: [
                            "1. Open PowerShell as Administrator",
                            "2. Run: winget install Gyan.FFmpeg",
                            "   OR download from https://ffmpeg.org/download.html and add to your PATH"
                        ],
                        linux: [
                            "Run: sudo apt install ffmpeg"
                        ],
                        mac: [
                            "Run: brew install ffmpeg"
                        ]
                    },
                    alternativeMethod: "FFmpeg is essential for this process and cannot be bypassed. Please install FFmpeg to continue."
                }
            });
        }

        // Create a temp directory for processing if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create a unique output directory for this job
        const jobId = uuidv4();
        const jobDir = path.join(tempDir, jobId);
        fs.mkdirSync(jobDir, { recursive: true });

        // Generate a concatfile for FFmpeg
        const concatFilePath = path.join(jobDir, 'concat.txt');
        
        // Track promises for all clip downloads and trims
        const clipProcessingPromises = [];
        
        // Process each clip: download video segment, trim it
        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const clipId = `clip_${i}`;
            const clipPath = path.join(jobDir, `${clipId}.mp4`);
            
            // Push promise to download and trim the clip
            clipProcessingPromises.push(
                new Promise((resolve, reject) => {
                    // Download YouTube video segment using yt-dlp
                    const downloadProcess = spawn('yt-dlp', [
                        `https://www.youtube.com/watch?v=${videoId}`,
                        '-f', 'mp4',  // Format
                        '--external-downloader', 'ffmpeg',
                        '--external-downloader-args', `ffmpeg_i:-ss ${clip.startTime} -to ${clip.endTime}`,
                        '-o', clipPath
                    ]);
                    
                    let errorOutput = '';
                    
                    downloadProcess.stderr.on('data', (data) => {
                        const dataStr = data.toString();
                        errorOutput += dataStr;
                        console.log(`Download stderr: ${dataStr}`);
                    });
                    
                    downloadProcess.on('error', (error) => {
                        if (error.code === 'ENOENT') {
                            reject(new Error('yt-dlp command not found. Please make sure yt-dlp is installed and in your PATH.'));
                        } else {
                            reject(error);
                        }
                    });
                    
                    downloadProcess.on('close', (code) => {
                        if (code === 0) {
                            fs.appendFileSync(concatFilePath, `file '${clipPath}'\n`);
                            resolve();
                        } else {
                            console.log(`Failed to process clip:`, clip);
                            reject(new Error(`Download process exited with code ${code}: ${errorOutput}`));
                        }
                      });
                      
                })
            );
        }
        
        // Wait for all clips to be processed
        try {
            await Promise.all(clipProcessingPromises);
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: "Failed to process clips",
                error: error.message
            });
        }
        
        // Output merged file path
        const outputFilePath = path.join(jobDir, 'merged.mp4');
        
        // Merge all clips using FFmpeg concat
        const mergeProcess = spawn('ffmpeg', [
            '-f', 'concat',
            '-safe', '0',
            '-i', concatFilePath,
            '-c', 'copy',
            outputFilePath
        ]);
        
        let mergeErrorOutput = '';
        
        mergeProcess.stderr.on('data', (data) => {
            const dataStr = data.toString();
            mergeErrorOutput += dataStr;
            console.log(`Merge stderr: ${dataStr}`);
        });
        
        mergeProcess.on('error', (error) => {
            if (error.code === 'ENOENT') {
                return res.status(500).json({
                    success: false,
                    message: "FFmpeg command not found. Please make sure FFmpeg is installed and in your PATH."
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });
        
        // Handle merge completion
        mergeProcess.on('close', (code) => {
            if (code === 0) {
                // Return the file path relative to the server
                const relativePath = path.relative(path.join(__dirname, '../..'), outputFilePath);
                
                return res.status(200).json({
                    success: true,
                    data: {
                        filePath: relativePath.replace(/\\/g, '/'),
                        jobId: jobId
                    },
                    message: "Clips merged successfully"
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: `Merge process exited with code ${code}`,
                    error: mergeErrorOutput
                });
            }
        });
        
    } catch (error) {
        console.error("Error merging clips:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to merge clips",
            error: error.message
        });
    }
};

module.exports = mergeClips; 