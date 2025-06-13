require('dotenv').config();

const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

// Manually verify environment
console.log('Environment Verification:', {
  AWS_REGION: process.env.AWS_REGION,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? '***' : 'MISSING',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? '***' : 'MISSING',
  DotenvLoaded: Object.keys(process.env).includes('AWS_REGION')
});

// Force all values
const client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'TEST',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'TEST'
  }
});

client.send(new ListBucketsCommand({}))
  .then(data => console.log('Success! Buckets:', data.Buckets))
  .catch(err => console.error('Final Error:', err.message));