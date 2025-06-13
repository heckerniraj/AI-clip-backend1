const router = require("express").Router();
const { getTranscript, getAuthUrl, oauth2Client } = require("../controllers/initialVersion/getTranscript");
const getVideoIDByPlaylist = require("../controllers/initialVersion/getVideoIDByPlaylist");
const generateClips = require("../controllers/initialVersion/generateClips");
const getDetailsByVideoID = require("../controllers/initialVersion/getDetailsByVideoID");
const { processClip } = require("../controllers/clipsMergeController/apifyMergeClips");
const addFinalVideo = require("../controllers/initialVersion/addfinalVideo");
const getPublishedVideosByUserID = require("../controllers/publishedVideoController/getPublishedVideosByUserID");


// Simple test endpoint to verify connectivity
router.get('/ping', (req, res) => {
    res.status(200).json({ 
        success: true, 
        message: 'Backend server is running',
        timestamp: new Date().toISOString()
    });
});

router.get('/auth', (req, res) => {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
});

router.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        res.redirect('https://clip-frontend-three.vercel.app');
    } catch (error) {
        console.error('Error getting OAuth tokens:', error);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
});

router.post("/playlist/:playlistId", getVideoIDByPlaylist);
router.post("/video/:videoId", getTranscript);
router.post("/generateClips", generateClips);
router.post("/details/:videoId", getDetailsByVideoID);
router.get("/download", processClip);
router.post("/addFinalVideo", addFinalVideo);
router.get("/getPublishedVideosByUserID/:userId", getPublishedVideosByUserID);
// router.get("/getPublishedVideos", getPublishedVideos);

module.exports = router;