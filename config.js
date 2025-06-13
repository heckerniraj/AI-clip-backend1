// Configuration settings based on environment
const config = {
  // Server settings
  port: process.env.PORT || 4001,
  env: process.env.NODE_ENV || 'development',
  
  // Processing limits and timeouts
  maxConcurrentJobs: process.env.MAX_CONCURRENT_JOBS || 5,
  jobTimeout: process.env.JOB_TIMEOUT || 3600000, // 1 hour in milliseconds
  
  // AWS configuration
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.AWS_S3_BUCKET || 'your-default-bucket-name',
  },
  
  // Paths
  paths: {
    tempDir: process.env.TEMP_DIR || './tmp',
    outputDir: process.env.OUTPUT_DIR || './output',
  },
  
  // CORS settings
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  },
  
  // Get config based on current environment
  get: function() {
    // Add environment-specific overrides
    if (this.env === 'production') {
      // Use the environment variable or default to allowing all origins
      this.cors.origin = process.env.CORS_ORIGIN || '*';
      
      // If using specific origins from env variable, parse them
      if (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS !== '*') {
        const origins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
        if (origins.length > 0) {
          this.cors.origin = origins;
        }
      }
      
      // Add other production-specific settings
    } else if (this.env === 'development') {
      this.cors.origin = process.env.CORS_ORIGIN || '*';
      // Add other development-specific settings
    }
    
    return this;
  }
};

module.exports = config.get(); 