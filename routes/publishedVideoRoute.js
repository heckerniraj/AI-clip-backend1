const router = require("express").Router();
const getPublishedVideos = require("../controllers/publishedVideoController/getPublishedVideos");
const publishVideo = require("../controllers/publishedVideoController/publishVideo");
const getPublishedVideoByID = require("../controllers/publishedVideoController/getPublishedVideoByID");


router.get("/getPublishedVideos", getPublishedVideos);
router.post("/publishVideo", publishVideo);
router.get("/getPublishedVideoByID/:id", getPublishedVideoByID);

module.exports = router;