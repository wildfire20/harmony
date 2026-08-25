const { S3Client } = require('@aws-sdk/client-s3');

// Validate AWS environment variables
const validateS3Config = () => {
  const requiredVars = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME,
    AWS_REGION: process.env.AWS_REGION
  };

  console.log('🔍 S3 Configuration Validation:');
  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value) {
      console.error(`❌ Missing: ${key}`);
    } else {
      console.log(`✅ ${key}: [CONFIGURED]`);
    }
  }

  const isValid = Object.values(requiredVars).every(val => val && val.trim());
  console.log(`🎯 S3 Config Valid: ${isValid}`);
  
  return isValid;
};

const configuredRegion = process.env.AWS_REGION?.trim();
const configuredBucket = process.env.AWS_S3_BUCKET_NAME?.trim();

// AWS S3 configuration. No placeholder region or bucket is used.
const s3Config = {
  region: configuredRegion,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  },
  // Force path-style addressing to avoid DNS issues
  forcePathStyle: false,
  // Explicitly set endpoint for better compatibility
  endpoint: configuredRegion === 'us-east-1'
    ? undefined 
    : configuredRegion ? `https://s3.${configuredRegion}.amazonaws.com` : undefined,
  // Disable acceleration and other features that might cause issues
  useAccelerateEndpoint: false,
  useDualstackEndpoint: false,
  // Add retry configuration for better reliability
  maxAttempts: 3,
  retryMode: 'adaptive',
  // Explicitly set signature version
  signatureVersion: 'v4'
};

// Create S3 client only if configuration is valid
let s3Client = null;
const isS3ConfigValid = validateS3Config();

if (isS3ConfigValid) {
  try {
    s3Client = new S3Client(s3Config);
    console.log('✅ S3 Client created successfully');
  } catch (error) {
    console.error('❌ Failed to create S3 client:', error.message);
  }
} else {
  console.error('❌ Invalid S3 configuration - S3 client not created');
}

// S3 bucket configuration
const bucketConfig = {
  bucketName: configuredBucket || null,
  region: configuredRegion || null,
};

module.exports = {
  s3Client,
  bucketConfig,
  s3Config,
  isS3ConfigValid
};
