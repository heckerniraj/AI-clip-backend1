const commentVideo = require("../controllers/engagementController/commentVideo");
const likeVideo = require("../controllers/engagementController/likeVideo");
const saveVideo = require("../controllers/engagementController/saveVideo");
const router = require("express").Router();

router.post("/commentVideo", commentVideo);
router.post("/likeVideo", likeVideo);
router.post("/saveVideo", saveVideo);

module.exports = router;
