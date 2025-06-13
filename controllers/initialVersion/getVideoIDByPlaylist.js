const { google } = require('googleapis');
const youtube = google.youtube('v3');

const getVideoIDByPlaylist = async (req, res) => {
    try {
        const { playlistId } = req.params;
        console.log("Fetching playlist:", playlistId);

        if (!process.env.YOUTUBE_API_KEY) {
            return res.status(400).json({
                message: "YouTube API key is not configured",
                status: false
            });
        }

        // Using Set to automatically handle duplicates
        const uniqueVideoIds = new Set();
        let nextPageToken = null;
        let pageCount = 0;
        const MAX_PAGES = 5; // Limit to 5 pages (250 videos max)

        do {
            if (pageCount >= MAX_PAGES) {
                console.log(`Reached maximum page limit (${MAX_PAGES})`);
                break;
            }

            const response = await youtube.playlistItems.list({
                key: process.env.YOUTUBE_API_KEY,
                part: 'contentDetails',
                playlistId: playlistId,
                maxResults: 50,
                pageToken: nextPageToken
            });

            if (!response.data.items || response.data.items.length === 0) {
                break;
            }

            response.data.items.forEach(item => {
                uniqueVideoIds.add(item.contentDetails.videoId);
            });
            
            nextPageToken = response.data.nextPageToken;
            pageCount++;
            
            console.log(`Fetched page ${pageCount}, unique videos: ${uniqueVideoIds.size}`);
        } while (nextPageToken);

        // Convert Set back to array
        const videoIds = Array.from(uniqueVideoIds);

        if (videoIds.length === 0) {
            return res.status(404).json({
                message: "No videos found in the playlist or playlist doesn't exist",
                status: false
            });
        }

        // Return just the array of unique video IDs
        res.status(200).json({
            message: `Successfully fetched ${videoIds.length} unique video IDs from playlist`,
            data: {
                totalVideos: videoIds.length,
                videoIds: videoIds
            },
            status: true
        });
    }
    catch (error) {
        console.error("Playlist fetch error:", error);
        
        if (error.code === 403) {
            return res.status(403).json({
                message: "YouTube API quota exceeded. Please try again later.",
                status: false
            });
        }
        
        if (error.message.includes('playlistId')) {
            return res.status(400).json({
                message: "Invalid playlist ID",
                error: error.message,
                status: false
            });
        }

        res.status(500).json({ 
            message: "Failed to fetch playlist videos", 
            error: error.message, 
            status: false 
        });
    }
}

module.exports = getVideoIDByPlaylist;
