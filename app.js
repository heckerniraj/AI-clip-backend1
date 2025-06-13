const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Import routes
const clipsRoutes = require('./routes/clipsRoutes');

// Create Express app
const app = express();

// Ensure temp and output directories exist
const ensureDirs = () => {
  try {
    if (!fs.existsSync(config.paths.tempDir)) {
      fs.mkdirSync(config.paths.tempDir, { recursive: true });
    }
    
    if (!fs.existsSync(config.paths.outputDir)) {
      fs.mkdirSync(config.paths.outputDir, { recursive: true });
    }
  } catch (error) {
    console.error('Error creating directories:', error);
  }
};

// Middleware

app.use(cors({
  origin: corsConfig().origin,
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
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (config.env === 'development') {
  app.use(morgan('dev'));
} else {
  // Setup access log file for production
  const accessLogStream = fs.createWriteStream(
    path.join(__dirname, 'access.log'), 
    { flags: 'a' }
  );
  app.use(morgan('combined', { stream: accessLogStream }));
}

app.use('/output', express.static(path.join(__dirname, config.paths.outputDir)));

// API routes
console.log('Setting up API routes...');
app.use('/api/clips', clipsRoutes);

console.log('Routes initialized: /api/clips/*');

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', environment: config.env });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: config.env === 'development' ? err.message : 'Internal server error'
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Initialize the app
const initializeApp = async () => {
  try {
    // Ensure directories exist
    ensureDirs();
    

    // Start the server
    const PORT = config.port;
    app.listen(PORT, () => {
      console.log(`Server running in ${config.env} mode on port ${PORT}`);
      console.log(`Server is up and running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Run the app
initializeApp();

module.exports = app; 