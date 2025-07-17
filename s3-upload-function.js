const AWS = require('aws-sdk');
const path = require('path');

/**
 * Upload files to AWS S3 using AWS SDK v2
 * Configured specifically for eu-north-1 (Stockholm) region
 */
class S3Uploader {
  constructor() {
    // Configure AWS with environment variables
    this.region = process.env.AWS_REGION || 'eu-north-1';
    this.bucketName = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    
    // Validate required environment variables
    this.validateEnvironment();
    
    // Configure AWS SDK v2
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: this.region,
      signatureVersion: 'v4', // Required for eu-north-1 (Stockholm)
    });
    
    // Create S3 instance
    this.s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      signatureVersion: 'v4',
      region: this.region,
    });
    
    console.log(`✅ S3 Uploader initialized for region: ${this.region}`);
  }
  
  /**
   * Validate that all required environment variables are set
   */
  validateEnvironment() {
    const required = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'AWS_S3_BUCKET_NAME'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    if (!this.bucketName) {
      throw new Error('S3_BUCKET_NAME or AWS_S3_BUCKET_NAME environment variable is required');
    }
    
    // Validate region is eu-north-1 for Stockholm
    if (this.region !== 'eu-north-1') {
      console.warn(`⚠️  Warning: Region is ${this.region}, but Stockholm buckets should use eu-north-1`);
    }
  }
  
  /**
   * Generate a unique filename to prevent conflicts
   * @param {string} originalFilename - Original filename
   * @returns {string} - Unique filename
   */
  generateUniqueFilename(originalFilename) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const extension = path.extname(originalFilename);
    const nameWithoutExt = path.basename(originalFilename, extension);
    
    return `${nameWithoutExt}_${timestamp}_${random}${extension}`;
  }
  
  /**
   * Upload file to S3
   * @param {Buffer} fileBuffer - File buffer data
   * @param {string} filename - Original filename
   * @param {string} mimetype - File MIME type
   * @param {string} folder - Folder in bucket (default: 'uploads')
   * @returns {Promise<string>} - Public URL of uploaded file
   */
  async uploadFile(fileBuffer, filename, mimetype, folder = 'uploads') {
    try {
      console.log(`📤 Starting S3 upload for file: ${filename}`);
      
      // Generate unique filename to prevent conflicts
      const uniqueFilename = this.generateUniqueFilename(filename);
      const key = `${folder}/${uniqueFilename}`;
      
      // Prepare upload parameters
      const uploadParams = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: mimetype,
        ACL: 'public-read', // Make file publicly accessible
        Metadata: {
          'original-filename': filename,
          'upload-timestamp': new Date().toISOString()
        }
      };
      
      console.log(`🔧 Upload params:`, {
        bucket: this.bucketName,
        key: key,
        contentType: mimetype,
        size: fileBuffer.length,
        region: this.region
      });
      
      // Upload to S3
      const result = await this.s3.upload(uploadParams).promise();
      
      console.log(`✅ Upload successful: ${result.Location}`);
      
      return result.Location;
      
    } catch (error) {
      console.error(`❌ S3 upload failed:`, error);
      
      // Provide specific error messages for common issues
      if (error.code === 'SignatureDoesNotMatch') {
        throw new Error(`S3 Signature Error: Check AWS credentials and ensure region matches bucket region (${this.region})`);
      } else if (error.code === 'NoSuchBucket') {
        throw new Error(`S3 Bucket Error: Bucket '${this.bucketName}' does not exist`);
      } else if (error.code === 'AccessDenied') {
        throw new Error(`S3 Access Error: Insufficient permissions for bucket '${this.bucketName}'`);
      } else if (error.code === 'InvalidAccessKeyId') {
        throw new Error(`S3 Auth Error: Invalid AWS Access Key ID`);
      } else {
        throw new Error(`S3 Upload Error: ${error.message}`);
      }
    }
  }
  
  /**
   * Test S3 connection and permissions
   * @returns {Promise<boolean>} - True if connection successful
   */
  async testConnection() {
    try {
      console.log(`🧪 Testing S3 connection to bucket: ${this.bucketName}`);
      
      // Test bucket access
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      
      console.log(`✅ S3 connection test successful`);
      return true;
      
    } catch (error) {
      console.error(`❌ S3 connection test failed:`, error.message);
      return false;
    }
  }
  
  /**
   * Get bucket region (for debugging)
   * @returns {Promise<string>} - Bucket region
   */
  async getBucketRegion() {
    try {
      const result = await this.s3.getBucketLocation({ Bucket: this.bucketName }).promise();
      const region = result.LocationConstraint || 'us-east-1';
      console.log(`📍 Bucket region: ${region}`);
      return region;
    } catch (error) {
      console.error(`❌ Failed to get bucket region:`, error.message);
      throw error;
    }
  }
}

/**
 * Convenience function for single file upload
 * @param {Buffer} fileBuffer - File buffer data
 * @param {string} filename - Original filename
 * @param {string} mimetype - File MIME type
 * @param {string} folder - Folder in bucket (default: 'uploads')
 * @returns {Promise<string>} - Public URL of uploaded file
 */
async function uploadToS3(fileBuffer, filename, mimetype, folder = 'uploads') {
  const uploader = new S3Uploader();
  return await uploader.uploadFile(fileBuffer, filename, mimetype, folder);
}

/**
 * Test function to verify S3 configuration
 */
async function testS3Configuration() {
  try {
    console.log('🔍 Testing S3 Configuration...');
    
    const uploader = new S3Uploader();
    
    // Test connection
    const connectionOk = await uploader.testConnection();
    if (!connectionOk) {
      return false;
    }
    
    // Check bucket region
    const region = await uploader.getBucketRegion();
    if (region !== uploader.region) {
      console.warn(`⚠️  Region mismatch: configured=${uploader.region}, actual=${region}`);
    }
    
    // Test upload with small file
    const testBuffer = Buffer.from('Test file content for S3 upload validation');
    const testUrl = await uploader.uploadFile(testBuffer, 'test-file.txt', 'text/plain', 'test');
    
    console.log(`✅ Test upload successful: ${testUrl}`);
    console.log('🎉 S3 configuration is working correctly!');
    
    return true;
    
  } catch (error) {
    console.error('❌ S3 configuration test failed:', error.message);
    return false;
  }
}

// Export functions
module.exports = {
  S3Uploader,
  uploadToS3,
  testS3Configuration
};

// If running directly, run configuration test
if (require.main === module) {
  testS3Configuration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}
