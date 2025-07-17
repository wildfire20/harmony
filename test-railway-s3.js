// Quick S3 Test for Railway Environment using AWS SDK v2
const AWS = require('aws-sdk');

const testRailwayS3Config = async () => {
    console.log('🔍 TESTING RAILWAY S3 CONFIGURATION');
    console.log('=====================================\n');

    // Get exact environment variables from Railway
    const config = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
        bucketName: process.env.AWS_S3_BUCKET_NAME
    };

    console.log('Environment Variables:');
    console.log(`AWS_ACCESS_KEY_ID: ${config.accessKeyId ? config.accessKeyId.substring(0, 8) + '...' : 'NOT SET'}`);
    console.log(`AWS_SECRET_ACCESS_KEY: ${config.secretAccessKey ? '[HIDDEN - LENGTH: ' + config.secretAccessKey.length + ']' : 'NOT SET'}`);
    console.log(`AWS_REGION: ${config.region || 'NOT SET'}`);
    console.log(`AWS_S3_BUCKET_NAME: ${config.bucketName || 'NOT SET'}`);
    console.log('');

    if (!config.accessKeyId || !config.secretAccessKey || !config.region || !config.bucketName) {
        console.error('❌ Missing required environment variables');
        return false;
    }

    try {
        // Configure AWS SDK v2 with exact Railway config
        AWS.config.update({
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: config.region,
            signatureVersion: 'v4'  // Required for Stockholm region
        });

        const s3 = new AWS.S3();
        console.log('✅ S3 Client created');

        // Test 1: List buckets (basic auth test)
        console.log('🧪 Test 1: Testing AWS authentication...');
        const listResult = await s3.listBuckets().promise();
        console.log(`✅ Authentication successful - Found ${listResult.Buckets.length} buckets`);

        // Test 2: Check if target bucket exists and is accessible
        console.log(`🧪 Test 2: Testing bucket access for "${config.bucketName}"...`);
        await s3.headBucket({ Bucket: config.bucketName }).promise();
        console.log(`✅ Bucket "${config.bucketName}" exists and is accessible`);

        // Test 3: Test a simple upload to verify write permissions
        console.log(`🧪 Test 3: Testing upload permissions...`);
        const testKey = `test-uploads/railway-test-${Date.now()}.txt`;
        await s3.putObject({
            Bucket: config.bucketName,
            Key: testKey,
            Body: 'Railway S3 test successful!',
            ContentType: 'text/plain'
        }).promise();
        console.log(`✅ Upload test successful - File uploaded as "${testKey}"`);

        // Clean up test file
        await s3.deleteObject({
            Bucket: config.bucketName,
            Key: testKey
        }).promise();
        console.log(`✅ Test file cleaned up`);

        console.log('\n🎉 ALL TESTS PASSED!');
        console.log('Your S3 configuration is working correctly for Railway deployment.');
        return true;

    } catch (error) {
        console.error(`❌ S3 Test failed: ${error.message}`);
        console.error(`Error code: ${error.code || 'Unknown'}`);
        console.error(`Error name: ${error.name || 'Unknown'}`);
        
        // Specific error handling
        if (error.code === 'InvalidAccessKeyId') {
            console.error('\n🔧 Fix: AWS_ACCESS_KEY_ID is invalid or missing');
        } else if (error.code === 'SignatureDoesNotMatch') {
            console.error('\n🔧 Fix: AWS_SECRET_ACCESS_KEY is invalid');
            console.error('- Check for trailing spaces or special characters');
            console.error('- Regenerate the secret key in AWS Console');
        } else if (error.code === 'NoSuchBucket') {
            console.error(`\n🔧 Fix: Bucket "${config.bucketName}" does not exist`);
            console.error('- Create the bucket in AWS Console');
            console.error('- Or update AWS_S3_BUCKET_NAME variable');
        } else if (error.code === 'AccessDenied') {
            console.error('\n🔧 Fix: IAM user lacks permissions');
            console.error('- Add S3 permissions to your IAM user');
        } else if (error.message.includes('Region')) {
            console.error('\n🔧 Fix: Region mismatch');
            console.error(`- Your bucket might be in a different region than ${config.region}`);
        }
        
        return false;
    }
};

// Run if this file is executed directly
if (require.main === module) {
    require('dotenv').config();
    testRailwayS3Config().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = { testRailwayS3Config };
