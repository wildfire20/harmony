const { S3Client } = require('@aws-sdk/client-s3');

// AWS S3 Configuration
const s3Config = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
};

// Create S3 client
const s3Client = new S3Client(s3Config);

// S3 bucket configuration
const bucketConfig = {
  bucketName: process.env.AWS_S3_BUCKET_NAME || 'harmony-learning-documents',
  region: process.env.AWS_REGION || 'us-east-1',
};

module.exports = {
  s3Client,
  bucketConfig,
  s3Config
};
