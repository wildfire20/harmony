const { Upload } = require('@aws-sdk/lib-storage');
const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, bucketConfig } = require('../config/s3');
const path = require('path');

class S3Service {
  constructor() {
    this.bucketName = bucketConfig.bucketName;
    this.s3Client = s3Client;
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
      // Generate unique filename to prevent conflicts
      const timestamp = Date.now();
      const randomId = Math.round(Math.random() * 1E9);
      const extension = path.extname(fileName);
      const baseName = path.basename(fileName, extension);
      const uniqueFileName = `${baseName}-${timestamp}-${randomId}${extension}`;
      
      // S3 key (file path in bucket)
      const s3Key = `${folder}/${uniqueFileName}`;
      
      console.log('📤 Uploading to S3:', { fileName, s3Key, mimeType });

      // Upload to S3 using the Upload class for better handling of large files
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucketName,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: mimeType,
          // Make files publicly readable (optional - can be restricted)
          ACL: 'private', // Use 'public-read' if you want direct public access
        },
      });

      const result = await upload.done();
      
      console.log('✅ S3 upload successful:', result.Location);

      return {
        success: true,
        s3Key: s3Key,
        s3Url: result.Location,
        bucketName: this.bucketName,
        originalFileName: fileName,
        uniqueFileName: uniqueFileName
      };

    } catch (error) {
      console.error('❌ S3 upload failed:', error);
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
   * @returns {Promise<string>} Signed URL
   */
  async getSignedUrl(s3Key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;

    } catch (error) {
      console.error('❌ Failed to generate signed URL:', error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  /**
   * Get signed URL for download (with content-disposition attachment)
   * @param {string} s3Key - S3 key of the file
   * @param {number} expiresIn - URL expiration in seconds (default 300)
   * @returns {Promise<string>} Signed download URL
   */
  async getSignedDownloadUrl(s3Key, expiresIn = 300) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: 'attachment',
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
      
    } catch (error) {
      console.error('❌ Failed to generate signed download URL:', error);
      throw new Error(`Failed to generate signed download URL: ${error.message}`);
    }
  }

  /**
   * Get signed URL for viewing (inline)
   * @param {string} s3Key - S3 key of the file
   * @param {number} expiresIn - URL expiration in seconds (default 3600)
   * @returns {Promise<string>} Signed view URL
   */
  async getSignedViewUrl(s3Key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ResponseContentDisposition: 'inline',
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
      
    } catch (error) {
      console.error('❌ Failed to generate signed view URL:', error);
      throw new Error(`Failed to generate signed view URL: ${error.message}`);
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
}

module.exports = new S3Service();
