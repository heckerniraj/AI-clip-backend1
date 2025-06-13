const express = require('express');
const router = express.Router();
const { sendContactEmail } = require('../controllers/contactController');

// Route to handle contact form submissions
router.post('/send', sendContactEmail);

module.exports = router; 