const express = require('express');
const router = express.Router();

// Simple ping endpoint to check server status
router.get('/ping', (req, res) => {
    res.status(200).json({
        status: true,
        message: 'Server is online',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});

// More detailed health check
router.get('/status', (req, res) => {
    // Basic system info
    const health = {
        status: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        nodeVersion: process.version,
        platform: process.platform
    };

    res.status(200).json(health);
});

module.exports = router; 