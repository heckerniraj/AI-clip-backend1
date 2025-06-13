const express = require('express');
const router = express.Router();

// Import controllers
const addUser = require('../controllers/usersController/addUser');
const getUser = require('../controllers/usersController/getUser');
const updateUser = require('../controllers/usersController/updateUser');
const deleteUser = require('../controllers/usersController/deleteUser');
const loginUser = require('../controllers/usersController/loginUser');

// Import auth middleware
const { protect } = require('../middleware/authMiddleware');

// Import auth controllers
const { 
  signinUserWithPassword, 
  signinUserWithGoogle,
  signinUserWithGithub,
  signinUserWithTwitter
} = require('../auth/signinUser');
const signupUser = require('../auth/signupUser');

// Public routes
router.post('/login', loginUser);
router.post('/', addUser); // For registration
router.post('/signup', signupUser);

// Social authentication routes
router.post('/signin/password', signinUserWithPassword);
router.post('/signin/google', signinUserWithGoogle);
router.post('/signin/github', signinUserWithGithub);
router.post('/signin/twitter', signinUserWithTwitter);

// Protected routes - require authentication
router.get('/:id', protect, getUser);
router.put('/:id', protect, updateUser);
router.delete('/:id', protect, deleteUser);

module.exports = router;