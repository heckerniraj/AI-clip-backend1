const express = require('express');
const router = express.Router();
const { getUserProjects, deleteProject, createProject, getProjectById } = require('../controllers/projectController');
const { protect } = require('../middleware/authMiddleware');

// Test route that doesn't require authentication
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Project routes are working',
    timestamp: new Date().toISOString()
  });
});

// Direct project creation endpoint for testing
router.post('/direct', (req, res) => {
  console.log('Direct project route hit with body:', req.body);
  res.status(200).json({
    success: true,
    message: 'Direct project route is working',
    receivedData: req.body,
    timestamp: new Date().toISOString()
  });
});

// GET all projects for the authenticated user
router.get('/', protect, getUserProjects);

// GET a project by ID
router.get('/:projectId', protect, getProjectById);

router.post('/', createProject);

// DELETE a project - requires authentication
router.delete('/:projectId', protect, deleteProject);

module.exports = router; 