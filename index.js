const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');
const usersRoute = require('./routes/usersRoute');
const clipsRoute = require('./routes/clipsRoute');
const processRoute = require('./routes/processClip');
const uploadRoute = require('./routes/uploadRoute');
const initialVersionRoute = require('./routes/initialVersion');
const mergeRoute = require('./routes/mergeRoute');
const projectRoutes = require('./routes/projectRoutes');
const healthRoute = require('./routes/healthRoute');
const processRoutes = require('./routes/processRoutes');
const videoRoutes = require('./routes/videoRoutes');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4001;

const payloadLimit = '50mb';

app.set('trust proxy', true); 
// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve static files from uploads directory
// Serve static files from uploads directory
const staticConfig = {
  dotfiles: 'ignore',
  etag: true,
  extensions: ['jpg', 'jpeg', 'png', 'mp4'],
  maxAge: '1d',
  setHeaders: (res, path) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticConfig));

// Add this before your routes
// app.use(express.json({ limit: '500mb' }));
// app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Configure CORS based on environment
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : [
          'https://clip-frontend-niraj1412s-projects.vercel.app',
          'https://clip-frontend-three.vercel.app',
          'http://localhost:3000', 
          'http://127.0.0.1:3000'
        ];

    // Remove any trailing slashes from origins
    const normalizedOrigins = allowedOrigins.map(o => o.replace(/\/$/, ''));
    
    if (normalizedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'X-Access-Token'
  ],
  credentials: true,
  exposedHeaders: [
    'Authorization',
    'Content-Length',
    'X-Request-ID'
  ],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

app.use(express.json({
    limit: payloadLimit,
    extended: true,
    parameterLimit: 50000
}));

app.use(express.urlencoded({
    extended: true,
    limit: payloadLimit,
    parameterLimit: 50000
}));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

app.options('*', cors(corsOptions));

// Serve static files from the temp directory
app.use('/temp', express.static(path.join(__dirname, 'temp'), staticConfig));

// Add a route to check if a file exists
app.head('/temp/:jobId/merged.mp4', (req, res) => {
    const { jobId } = req.params;
    const filePath = path.join(__dirname, 'temp', jobId, 'merged.mp4');

    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
            res.setHeader('Content-Length', stats.size);
            res.setHeader('Content-Type', 'video/mp4');
            res.status(200).end();
        } else {
            res.status(404).end();
        }
    } else {
        res.status(404).end();
    }
});

// Routes
app.use('/api/v1/auth', usersRoute);
app.use('/api/clips', clipsRoute);
app.use('/api/v1/upload', uploadRoute);

// ✅ Ensure these come BEFORE the generic /api/v1
app.use('/api/v1/youtube', initialVersionRoute);
app.use('/api/v1/video', videoRoutes);

app.use('/api/merge', mergeRoute);
app.use('/api/projects', projectRoutes);
app.use('/api/v1/health', healthRoute);
app.use('/api', processRoute);
// ✅ Catch-all /api/v1 AFTER specific routes
app.use('/api/v1', (req, res, next) => {
  console.log(`Incoming API v1 request: ${req.method} ${req.path}`);
  next();
}, processRoutes);


// Add this near the start of the file after other requires
const uploadsDir = path.join(__dirname, 'uploads');
const backendUploadsDir = path.join(__dirname, 'backend/uploads');

// Create all required directories
[uploadsDir, backendUploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    console.log(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
});


// Add this before your routes
const thumbnailsDir = path.join(__dirname, 'backend', 'thumbnails');
if (!fs.existsSync(thumbnailsDir)) {
  fs.mkdirSync(thumbnailsDir, { recursive: true });
}

// Serve thumbnails from the correct directory
app.use('/thumbnails', express.static(thumbnailsDir, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Serve default thumbnail
const publicDir = path.join(__dirname, 'backend', 'public');
app.use('/default-thumbnail.jpg', express.static(path.join(publicDir, 'default-thumbnail.jpg')));

if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res, next) => {
    if (!req.path.startsWith('/api/')) {
      return res.status(404).json({ 
        message: 'Not found - Frontend is served separately',
        hint: 'Your frontend is deployed at a different URL'
      });
    }
    next();
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler caught:', err.stack || err);
  
  // Handle specific error types
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File too large' });
  }

  // Default error response
  res.status(err.status || 500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Connect to MongoDB and start server
connectDB();

// Start the server - no need for .then as we handle connection errors separately
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

console.log('Registered routes:');
app._router.stack.forEach(middleware => {
  if (middleware.route) {
    console.log(`${Object.keys(middleware.route.methods).join(', ').toUpperCase()} ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    middleware.handle.stack.forEach(handler => {
      if (handler.route) {
        console.log(`${Object.keys(handler.route.methods).join(', ').toUpperCase()} /api/v1${handler.route.path}`);
      }
    });
  }
});
