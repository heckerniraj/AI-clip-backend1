const jwt = require('jsonwebtoken');
const User = require('../model/usersSchema');

/**
 * Authentication middleware to protect routes
 * Verifies the JWT token from the request header
 */
const protect = async (req, res, next) => {
  let token;
  console.log('Auth middleware called for:', req.originalUrl);

  // For testing/development: Allow bypass of auth middleware using an env var
  if (process.env.BYPASS_AUTH === 'true') {
    console.log('⚠️ AUTH BYPASS ENABLED - This should only be used for development/testing!');
    req.user = { id: 'bypass_user', email: 'bypass@example.com' };
    return next();
  }

  // Check if authorization header exists and starts with Bearer
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];
      console.log('Token received:', token ? `${token.substring(0, 10)}...${token.substring(token.length - 5)}` : 'None');

      if (!token || token === 'null' || token === 'undefined') {
        console.log('Token is null/undefined but was sent with Bearer prefix');
        return res.status(401).json({ 
          status: false, 
          message: 'Invalid token format - token is null or undefined', 
          errorType: 'INVALID_TOKEN'
        });
      }

      // Verify token
      const decoded = jwt.verify(
        token, 
        process.env.JWT_SECRET || 'your_jwt_secret_key'
      );
      
      // console.log('Token decoded successfully:', {
      //   userId: decoded.userId,
      //   email: decoded.email,
      //   exp: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : 'No expiration'
      // });

      // Check if userId exists in the decoded token
      if (!decoded.userId) {
        console.log('Token missing userId field');
        return res.status(401).json({ 
          status: false, 
          message: 'Invalid token format', 
          errorType: 'MISSING_USER_ID'
        });
      }

      // Get user from the database, excluding password field
      try {
        const user = await User.findById(decoded.userId).select('-password');
        
        if (!user) {
          console.log('User not found in database for id:', decoded.userId);
          return res.status(401).json({ 
            status: false, 
            message: 'User not found or access revoked', 
            errorType: 'USER_NOT_FOUND'
          });
        }

        console.log('User authenticated:', user._id.toString());
        
        // Attach user to request
        req.user = user;
        next();
      } catch (dbError) {
        console.error('Database error when finding user:', dbError);
        return res.status(500).json({ 
          status: false, 
          message: 'Server error while authenticating user', 
          errorType: 'DB_ERROR'
        });
      }
    } catch (error) {
      console.error('Auth error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      // Provide more specific error messages based on the error type
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          status: false, 
          message: 'Token expired, please login again',
          errorType: 'TOKEN_EXPIRED'
        });
      } else if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          status: false, 
          message: 'Invalid token',
          errorType: 'INVALID_TOKEN'
        });
      }
      
      res.status(401).json({ 
        status: false, 
        message: 'Authentication failed', 
        errorType: 'AUTH_FAILED'
      });
    }
  } else {
    console.log('No Authorization header or Bearer token found');
    res.status(401).json({ 
      status: false, 
      message: 'No token provided',
      errorType: 'NO_TOKEN'
    });
  }
};

/**
 * Admin middleware to protect admin-only routes
 * Must be used after the protect middleware
 */
const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({
      status: false,
      message: 'Not authorized as an admin',
      errorType: 'NOT_ADMIN'
    });
  }
};

module.exports = { protect, admin }; 