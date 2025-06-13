const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');


const downloadClip = async (req, res) => {
    const { videoId, startTime, endTime } = req.query;
    let clipPath;
    
    try {
        if (!videoId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing videoId parameter' 
            }); ``
        }

        if (!startTime || !endTime) {
            return res.status(400).json({ 
                success: false, 
                message: 'Both startTime and endTime are required for trimming' 
            });
        }

        const start = parseFloat(startTime);
        const end = parseFloat(endTime);
        if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid time parameters' 
            });
        }

        // Create a temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Generate a unique file name
        const uniqueId = uuidv4();
        clipPath = path.join(tempDir, `${uniqueId}.mp4`);

        // Download YouTube video segment using yt-dlp
        const downloadProcess = spawn('yt-dlp', [
            `https://www.youtube.com/watch?v=${videoId}`,
            '-f', 'mp4',  // Format
            '--external-downloader', 'ffmpeg',
            '--external-downloader-args', `ffmpeg_i:-ss ${start} -to ${end}`,
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
                return res.status(500).json({
                    success: false,
                    message: 'yt-dlp command not found. Please make sure yt-dlp is installed and in your PATH.'
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });
                    
        downloadProcess.on('close', (code) => {
            if (code === 0) {
                // Check if file exists and has content
                if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 0) {
                    // Send the file
                    res.download(clipPath, `clip-${videoId}-${start}-${end}.mp4`, (err) => {
                        // Delete the file after sending
                        if (fs.existsSync(clipPath)) {
                            fs.unlinkSync(clipPath);
                        }
                        
                        if (err) {
                            console.error('Error sending file:', err);
                        }
                    });
                } else {
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to generate clip file'
                    });
                }
            } else {
                return res.status(500).json({
                    success: false,
                    message: `Download process exited with code ${code}: ${errorOutput}`
                });
            }
        });
    } catch (error) {
        console.error('Error in downloadClip:', error);
        
        // Cleanup in case of error
        if (clipPath && fs.existsSync(clipPath)) {
            fs.unlinkSync(clipPath);
        }
        
        return res.status(500).json({
            success: false,
            message: error.message || 'An unknown error occurred'
        });
    }
};

module.exports = downloadClip; 