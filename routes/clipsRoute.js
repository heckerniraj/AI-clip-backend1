const deleteClip = require("../controllers/clipsController/deleteClip");
const generateClips = require("../controllers/clipsController/generateClips");
const getClipsByVideoID = require("../controllers/clipsController/getClipsByVideoID");
const updateClip = require("../controllers/clipsController/updateClip");
const mergeClips = require("../controllers/clipsMergeController/mergeClips");
const { mergingClips } = require("../controllers/clipsMergeController/mergingClips");
const router = require("express").Router();

router.post("/generateClip", generateClips);
router.delete("/deleteClip/:id", deleteClip);
router.get("/getClipsByVideoID/:videoID", getClipsByVideoID);
router.put("/updateClip/:id", updateClip);
router.post("/mergeClips", mergeClips);

router.post("/merge-clips", mergingClips);

module.exports = router;
