// Test S3 download functionality
const { s3Client, bucketConfig } = require('./config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const testS3Download = async () => {
    console.log('🔍 TESTING S3 DOWNLOAD FUNCTIONALITY');
    console.log('=====================================\n');

    const testS3Key = 'documents/ICE 3 BUIS6122-1752416306811-735087775.docx';
    
    try {
        console.log(`Testing S3 key: ${testS3Key}`);
        console.log(`Bucket: ${bucketConfig.bucketName}`);
        console.log(`Region: ${bucketConfig.region}\n`);

        // Test 1: Check if object exists
        console.log('🧪 Test 1: Checking if file exists in S3...');
        const headCommand = new GetObjectCommand({
            Bucket: bucketConfig.bucketName,
            Key: testS3Key,
        });

        try {
            await s3Client.send(headCommand);
            console.log('✅ File exists in S3');
        } catch (headError) {
            console.log('❌ File does not exist in S3:', headError.message);
            return false;
        }

        // Test 2: Generate signed URL
        console.log('\n🧪 Test 2: Generating signed URL...');
        const getCommand = new GetObjectCommand({
            Bucket: bucketConfig.bucketName,
            Key: testS3Key,
        });

        const signedUrl = await getSignedUrl(s3Client, getCommand, { 
            expiresIn: 300 // 5 minutes
        });

        console.log('✅ Signed URL generated successfully');
        console.log(`URL length: ${signedUrl.length} characters`);
        console.log(`URL starts with: ${signedUrl.substring(0, 100)}...`);

        // Test 3: Validate URL format
        console.log('\n🧪 Test 3: Validating URL format...');
        try {
            const url = new URL(signedUrl);
            console.log(`✅ Valid URL format`);
            console.log(`Host: ${url.host}`);
            console.log(`Path: ${url.pathname}`);
            console.log(`Has signature: ${url.searchParams.has('X-Amz-Signature')}`);
            console.log(`Has credentials: ${url.searchParams.has('X-Amz-Credential')}`);
            console.log(`Expires: ${url.searchParams.get('X-Amz-Expires')} seconds`);
        } catch (urlError) {
            console.log('❌ Invalid URL format:', urlError.message);
            return false;
        }

        console.log('\n🎉 ALL TESTS PASSED!');
        console.log('S3 download functionality appears to be working correctly.');
        console.log('\nGenerated URL for testing:');
        console.log(signedUrl);
        
        return true;

    } catch (error) {
        console.error(`❌ S3 Download test failed: ${error.message}`);
        console.error(`Error code: ${error.code || 'Unknown'}`);
        
        if (error.code === 'NoSuchKey') {
            console.error('\n🔧 Fix: The specified file does not exist in S3');
            console.error('- Check if the file was uploaded correctly');
            console.error('- Verify the S3 key path is correct');
        } else if (error.code === 'AccessDenied') {
            console.error('\n🔧 Fix: Access denied to S3 object');
            console.error('- Check IAM permissions for GetObject');
        }
        
        return false;
    }
};

// Run if this file is executed directly
if (require.main === module) {
    require('dotenv').config();
    testS3Download().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = { testS3Download };
