const { uploadToS3, testS3Configuration, S3Uploader } = require('./s3-upload-function');
const fs = require('fs');

/**
 * Example usage of the S3 upload function
 */
async function exampleUsage() {
  console.log('📝 S3 Upload Function Usage Examples');
  console.log('===================================\n');

  try {
    // Method 1: Using the convenience function
    console.log('1️⃣  Using convenience function uploadToS3()');
    
    // Create a test file buffer
    const testContent = 'This is a test file for S3 upload demonstration.';
    const fileBuffer = Buffer.from(testContent, 'utf8');
    
    const publicUrl = await uploadToS3(
      fileBuffer,           // File buffer
      'test-document.txt',  // Original filename
      'text/plain',         // MIME type
      'uploads'             // Folder (optional, defaults to 'uploads')
    );
    
    console.log(`✅ File uploaded successfully: ${publicUrl}\n`);

    // Method 2: Using the S3Uploader class directly
    console.log('2️⃣  Using S3Uploader class directly');
    
    const uploader = new S3Uploader();
    
    // Test connection first
    const isConnected = await uploader.testConnection();
    if (!isConnected) {
      console.log('❌ Connection test failed');
      return;
    }
    
    // Upload another file
    const anotherBuffer = Buffer.from('Another test file with different content.');
    const anotherUrl = await uploader.uploadFile(
      anotherBuffer,
      'another-test.txt',
      'text/plain',
      'documents'
    );
    
    console.log(`✅ Second file uploaded: ${anotherUrl}\n`);

    // Method 3: Uploading an actual file from disk (if it exists)
    console.log('3️⃣  Uploading actual file from disk (if exists)');
    
    try {
      // Try to upload package.json as an example
      if (fs.existsSync('./package.json')) {
        const fileBuffer = fs.readFileSync('./package.json');
        const jsonUrl = await uploadToS3(
          fileBuffer,
          'package.json',
          'application/json',
          'configs'
        );
        console.log(`✅ Package.json uploaded: ${jsonUrl}\n`);
      } else {
        console.log('📄 No package.json found, skipping file upload example\n');
      }
    } catch (error) {
      console.log(`⚠️  File upload example failed: ${error.message}\n`);
    }

    console.log('🎉 All examples completed successfully!');

  } catch (error) {
    console.error('❌ Example failed:', error.message);
    
    // Provide troubleshooting tips
    console.log('\n🔧 Troubleshooting Tips:');
    console.log('1. Ensure all environment variables are set:');
    console.log('   - AWS_ACCESS_KEY_ID');
    console.log('   - AWS_SECRET_ACCESS_KEY');
    console.log('   - AWS_REGION (should be eu-north-1)');
    console.log('   - AWS_S3_BUCKET_NAME');
    console.log('2. Verify your S3 bucket exists and is accessible');
    console.log('3. Check that your AWS credentials have S3 permissions');
    console.log('4. Ensure the bucket region matches AWS_REGION setting');
  }
}

/**
 * Integration example with Express.js multer
 */
function expressIntegrationExample() {
  console.log('\n📚 Express.js Integration Example:');
  console.log('=================================');
  
  const exampleCode = `
// In your Express route file
const { uploadToS3 } = require('./s3-upload-function');
const multer = require('multer');

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Route handler
app.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Upload to S3
    const publicUrl = await uploadToS3(
      req.file.buffer,        // File buffer from multer
      req.file.originalname,  // Original filename
      req.file.mimetype,      // MIME type
      'uploads'               // S3 folder
    );
    
    // Save URL to database or return to client
    res.json({ 
      success: true, 
      fileUrl: publicUrl,
      message: 'File uploaded successfully'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      message: error.message 
    });
  }
});
`;

  console.log(exampleCode);
}

// Main execution
async function main() {
  console.log('🚀 Starting S3 Upload Function Demo\n');
  
  // First test the configuration
  const configOk = await testS3Configuration();
  
  if (configOk) {
    console.log('\n✅ Configuration test passed, running examples...\n');
    await exampleUsage();
    expressIntegrationExample();
  } else {
    console.log('\n❌ Configuration test failed. Please fix the issues above before using the upload function.');
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
