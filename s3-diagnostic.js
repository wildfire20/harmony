// S3 Diagnostic and Fix Tool
const { S3Client, ListBucketsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const diagnoseS3Issues = async () => {
    console.log('🔍 S3 DIAGNOSTIC TOOL');
    console.log('===================\n');

    // Step 1: Check environment variables
    console.log('1. Environment Variables Check:');
    const envVars = {
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME,
        AWS_REGION: process.env.AWS_REGION
    };

    for (const [key, value] of Object.entries(envVars)) {
        if (!value) {
            console.log(`❌ ${key}: NOT SET`);
        } else if (key.includes('SECRET')) {
            console.log(`✅ ${key}: [HIDDEN - LENGTH: ${value.length}]`);
        } else {
            console.log(`✅ ${key}: ${value}`);
        }
    }

    const missingVars = Object.entries(envVars).filter(([key, value]) => !value).map(([key]) => key);
    if (missingVars.length > 0) {
        console.log(`\n❌ Missing environment variables: ${missingVars.join(', ')}`);
        console.log('\n🔧 Fix: Set these in Railway dashboard under Variables tab');
        return false;
    }

    console.log('\n✅ All environment variables are set');

    // Step 2: Test S3 credentials
    console.log('\n2. Testing S3 Credentials:');
    
    try {
        const s3Client = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });

        console.log('✅ S3 Client created successfully');

        // Test with ListBuckets (basic AWS API call)
        console.log('📋 Testing basic AWS API access...');
        const listCommand = new ListBucketsCommand({});
        const result = await s3Client.send(listCommand);
        
        console.log('✅ AWS API access successful');
        console.log(`📦 Found ${result.Buckets.length} buckets in your account`);
        
        // Check if our bucket exists
        const bucketExists = result.Buckets.some(bucket => bucket.Name === process.env.AWS_S3_BUCKET_NAME);
        if (bucketExists) {
            console.log(`✅ Target bucket "${process.env.AWS_S3_BUCKET_NAME}" exists`);
        } else {
            console.log(`❌ Target bucket "${process.env.AWS_S3_BUCKET_NAME}" not found`);
            console.log('Available buckets:', result.Buckets.map(b => b.Name));
            console.log('\n🔧 Fix: Create the bucket or update AWS_S3_BUCKET_NAME variable');
            return false;
        }

        // Step 3: Test file upload
        console.log('\n3. Testing File Upload:');
        const testContent = Buffer.from('Test file upload from Harmony Learning Institute');
        const testKey = `test/diagnostic-${Date.now()}.txt`;
        
        const uploadCommand = new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: testKey,
            Body: testContent,
            ContentType: 'text/plain'
        });

        await s3Client.send(uploadCommand);
        console.log('✅ Test file upload successful');
        console.log(`📁 Test file uploaded: ${testKey}`);
        
        console.log('\n🎉 S3 DIAGNOSTIC COMPLETE - ALL TESTS PASSED');
        console.log('Your S3 configuration is working correctly!');
        return true;

    } catch (error) {
        console.log(`❌ S3 Test failed: ${error.message}`);
        console.log('\n🔧 Common Fixes:');
        
        if (error.code === 'InvalidAccessKeyId') {
            console.log('- Check AWS_ACCESS_KEY_ID is correct');
            console.log('- Make sure the IAM user exists');
        } else if (error.code === 'SignatureDoesNotMatch') {
            console.log('- Check AWS_SECRET_ACCESS_KEY is correct');
            console.log('- Make sure there are no trailing spaces in the key');
            console.log('- Regenerate the secret access key if needed');
        } else if (error.code === 'AccessDenied') {
            console.log('- Check IAM user has S3 permissions');
            console.log('- Verify bucket policy allows your IAM user');
        } else if (error.code === 'NoSuchBucket') {
            console.log('- Create the S3 bucket or check bucket name');
        } else {
            console.log(`- Error code: ${error.code}`);
            console.log(`- Error details: ${error.message}`);
        }
        
        return false;
    }
};

// Export for use in other files or run directly
if (require.main === module) {
    // Load environment variables if running directly
    require('dotenv').config();
    diagnoseS3Issues();
}

module.exports = { diagnoseS3Issues };
