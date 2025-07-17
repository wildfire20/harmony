const { Upload } = require('@aws-sdk/lib-storage');
const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucketConfig, isS3ConfigValid } = require('../config/s3');
const path = require('path');

class S3Service {
  constructor() {
    this.bucketName = bucketConfig.bucketName;
    this.s3Client = s3Client;
    this.isConfigValid = isS3ConfigValid;
  }

  /**
   * Validate S3 service is ready
   */
  validateService() {
    if (!this.isConfigValid) {
      throw new Error('S3 configuration is invalid. Please check environment variables.');
    }
    if (!this.s3Client) {
      throw new Error('S3 client is not initialized.');
    }
    if (!this.bucketName) {
      throw new Error('S3 bucket name is not configured.');
    }
  }

  /**
   * Upload file to S3
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} fileName - Original filename
   * @param {string} mimeType - File MIME type
   * @param {string} folder - S3 folder (e.g., 'documents')
   * @returns {Promise<Object>} Upload result with S3 key and URL
   */
  async uploadFile(fileBuffer, fileName, mimeType, folder = 'documents') {
    try {
      // Validate service before upload
      this.validateService();

      // Generate unique filename to prevent conflicts
      const timestamp = Date.now();
      const randomId = Math.round(Math.random() * 1E9);
      const extension = path.extname(fileName);
      const baseName = path.basename(fileName, extension);
      const uniqueFileName = `${baseName}-${timestamp}-${randomId}${extension}`;
      
      // S3 key (file path in bucket)
      const s3Key = `${folder}/${uniqueFileName}`;
      
      console.log('📤 Uploading to S3:', { 
        fileName, 
        s3Key, 
        mimeType, 
        bucket: this.bucketName,
        region: bucketConfig.region,
        fileSize: fileBuffer.length 
      });

      // First try with PutObjectCommand for better error handling
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimeType,
        // Don't set ACL - let bucket defaults handle it
      });

      console.log('🔐 S3 Command created, attempting upload...');
      const result = await this.s3Client.send(command);
      
      console.log('✅ S3 upload successful:', result);

      // Construct the S3 URL manually since PutObjectCommand doesn't return Location
      const s3Url = `https://${this.bucketName}.s3.${bucketConfig.region}.amazonaws.com/${s3Key}`;

      return {
        success: true,
        s3Key: s3Key,
        s3Url: s3Url,
        bucketName: this.bucketName,
        originalFileName: fileName,
        uniqueFileName: uniqueFileName,
        etag: result.ETag
      };

    } catch (error) {
      console.error('❌ S3 upload failed:', {
        message: error.message,
        code: error.Code || error.code,
        statusCode: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
        stack: error.stack
      });
      
      // Provide more specific error messages
      if (error.Code === 'SignatureDoesNotMatch' || error.message.includes('signature')) {
        throw new Error(`S3 signature error: Check AWS credentials and region. Ensure AWS_REGION=${bucketConfig.region} matches your bucket region.`);
      }
      
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }

  /**
   * Delete file from S3
   * @param {string} s3Key - S3 key of the file to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(s3Key) {
    try {
      console.log('🗑️ Deleting from S3:', s3Key);

      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await this.s3Client.send(deleteCommand);
      
      console.log('✅ S3 delete successful:', s3Key);
      return true;

    } catch (error) {
      console.error('❌ S3 delete failed:', error);
      return false;
    }
  }

  /**
   * Generate a signed URL for secure file access
   * @param {string} s3Key - S3 key of the file
   * @param {number} expiresIn - URL expiration time in seconds (default: 1 hour)
   * @param {Object} responseParams - Additional response parameters
   * @returns {Promise<string>} Signed URL
   */
  async getSignedUrl(s3Key, expiresIn = 3600, responseParams = {}) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ...responseParams
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;

    } catch (error) {
      console.error('❌ Failed to generate signed URL:', error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  /**
   * Generate signed URL specifically for downloads (forces download behavior)
   * @param {string} s3Key - S3 key of the file
   * @param {string} fileName - Original filename for download
   * @param {number} expiresIn - URL expiration time in seconds (default: 5 minutes)
   * @returns {Promise<string>} Signed URL with download headers
   */
  async getDownloadUrl(s3Key, fileName, expiresIn = 300) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;

    } catch (error) {
      console.error('❌ Failed to generate download URL:', error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  /**
   * Get file stream from S3
   * @param {string} s3Key - S3 key of the file
   * @returns {Promise<Stream>} File stream
   */
  async getFileStream(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.s3Client.send(command);
      return response.Body;

    } catch (error) {
      console.error('❌ Failed to get file stream:', error);
      throw new Error(`Failed to get file stream: ${error.message}`);
    }
  }

  /**
   * Check if file exists in S3
   * @param {string} s3Key - S3 key of the file
   * @returns {Promise<boolean>} Whether file exists
   */
  async fileExists(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await this.s3Client.send(command);
      return true;

    } catch (error) {
      if (error.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Generate presigned URL for file download
   * @param {string} s3Key - S3 key of the file
   * @param {number} expiresIn - Expiration time in seconds (default: 300 = 5 minutes)
   * @returns {Promise<string>} Presigned URL
   */
  async getPresignedUrl(s3Key, expiresIn = 300) {
    try {
      this.validateService();

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const presignedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      
      console.log('✅ Generated presigned URL for:', s3Key);
      return presignedUrl;

    } catch (error) {
      console.error('❌ Failed to generate presigned URL:', error);
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }
}

module.exports = new S3Service();
