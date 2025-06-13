const fs = require('fs');
const AWS = require('aws-sdk');
const path = require('path');
require('dotenv').config();

// Configure AWS SDK with credentials from .env file
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // Add S3 configuration to never use ACLs
  s3DisableBodySigning: true
});

// Default bucket name from .env
const defaultBucket = process.env.AWS_S3_BUCKET;

/**
 * Upload a file to AWS S3
 * @param {string} filePath Local path of file to upload
 * @param {string} s3Key S3 key (path) where file will be stored
 * @returns {Promise<string>} URL of the uploaded file
 */
const uploadToS3 = async (filePath, s3Key) => {
  try {
    console.log(`Attempting to upload file to S3: ${filePath} -> s3://${defaultBucket}/${s3Key}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    
    const fileContent = fs.readFileSync(filePath);
    
    // Create upload parameters WITHOUT ACL settings
    const params = {
      Bucket: defaultBucket,
      Key: s3Key,
      Body: fileContent,
      ContentType: getContentType(filePath)
    };
    
    // Upload to S3 - explicitly passing options to disable ACL
    const uploadOptions = {
      // Ensure no ACL is included in the request
      useAccelerateEndpoint: false
    };
    
    const uploadResult = await s3.upload(params, uploadOptions).promise();
    console.log(`File uploaded successfully to ${uploadResult.Location}`);
    
    return uploadResult.Location;
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    
    // Log additional information for better debugging
    if (error.code === 'AccessControlListNotSupported') {
      console.log('This S3 bucket has Object Ownership set to "Bucket owner enforced" which does not allow ACLs.');
      console.log('Please ensure you have correctly configured your S3 client and bucket settings.');
    }
    
    throw error;
  }
};

/**
 * Get content type based on file extension
 * @param {string} filePath - Path to the file
 * @returns {string} - MIME type for the file
 */
const getContentType = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.avi':
      return 'video/x-msvideo';
    case '.webm':
      return 'video/webm';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.pdf':
      return 'application/pdf';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
};

/**
 * Generate a pre-signed URL for downloading a file from S3
 * @param {string} s3Key - Key (path) of the file in S3
 * @param {string} bucket - Optional bucket name (defaults to env variable)
 * @param {number} expiresInSeconds - Optional expiration time in seconds (default 1 hour)
 * @returns {Promise<string>} - Pre-signed URL for the file
 */
const getSignedDownloadUrl = async (s3Key, bucket = defaultBucket, expiresInSeconds = 3600) => {
  try {
    const params = {
      Bucket: bucket,
      Key: s3Key,
      Expires: expiresInSeconds
    };

    const url = await s3.getSignedUrlPromise('getObject', params);
    return url;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
};

/**
 * Generate a pre-signed URL for uploading a file to S3
 * @param {string} s3Key - Key (path) where the file will be stored in S3
 * @param {string} contentType - Content type of the file
 * @param {string} bucket - Optional bucket name (defaults to env variable)
 * @param {number} expiresInSeconds - Optional expiration time in seconds (default 1 hour)
 * @returns {Promise<string>} - Pre-signed URL for uploading
 */
const getSignedUploadUrl = async (s3Key, contentType, bucket = defaultBucket, expiresInSeconds = 3600) => {
  try {
    const params = {
      Bucket: bucket,
      Key: s3Key,
      Expires: expiresInSeconds,
      ContentType: contentType
      // Removed ACL: 'public-read' as it may not be supported with bucket settings
    };

    const url = await s3.getSignedUrlPromise('putObject', params);
    return url;
  } catch (error) {
    console.error('Error generating signed upload URL:', error);
    throw error;
  }
};

/**
 * Check if an object exists in S3
 * @param {string} s3Key - Key (path) of the object in S3
 * @param {string} bucket - Optional bucket name (defaults to env variable)
 * @returns {Promise<boolean>} - Whether the object exists
 */
const checkObjectExists = async (s3Key, bucket = defaultBucket) => {
  try {
    const params = {
      Bucket: bucket,
      Key: s3Key
    };

    await s3.headObject(params).promise();
    return true;
  } catch (error) {
    if (error.code === 'NotFound') {
      return false;
    }
    throw error;
  }
};

/**
 * Delete an object from S3
 * @param {string} s3Key - Key (path) of the object in S3
 * @param {string} bucket - Optional bucket name (defaults to env variable)
 * @returns {Promise<boolean>} - Whether the deletion was successful
 */
const deleteObject = async (s3Key, bucket = defaultBucket) => {
  try {
    const params = {
      Bucket: bucket,
      Key: s3Key
    };

    await s3.deleteObject(params).promise();
    console.log(`Object deleted successfully: s3://${bucket}/${s3Key}`);
    return true;
  } catch (error) {
    console.error('Error deleting object from S3:', error);
    throw error;
  }
};

module.exports = {
  uploadToS3,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  checkObjectExists,
  deleteObject,
  getContentType
};