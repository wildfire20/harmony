// Test with exact Railway configuration
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Use exact values from Railway
const testExactConfig = async () => {
    console.log('Testing with exact Railway configuration...\n');
    
    const config = {
        region: 'eu-north-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AKIATCKSMCDYLQPRKPMJ',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        maxAttempts: 3,
        retryMode: 'adaptive'
    };
    
    const bucketName = 'harmony-learning-documents-harmony2025';
    
    console.log('Configuration:');
    console.log(`Region: ${config.region}`);
    console.log(`Bucket: ${bucketName}`);
    console.log(`Access Key: ${config.credentials.accessKeyId.substring(0, 8)}...`);
    console.log('');
    
    try {
        const s3Client = new S3Client(config);
        
        // Try a simple upload test
        const testKey = `test/railway-test-${Date.now()}.txt`;
        const testContent = Buffer.from('Test upload from Railway deployment');
        
        console.log(`Attempting upload to: ${bucketName}/${testKey}`);
        
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: testKey,
            Body: testContent,
            ContentType: 'text/plain'
        });
        
        const result = await s3Client.send(command);
        console.log('✅ Upload successful!');
        console.log('Result:', result);
        
    } catch (error) {
        console.error('❌ Upload failed:');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error name:', error.name);
        
        // Check for specific signature errors
        if (error.message.includes('signature')) {
            console.error('\n🔧 SIGNATURE ERROR DIAGNOSIS:');
            console.error('1. Check AWS_SECRET_ACCESS_KEY has no trailing spaces');
            console.error('2. Verify the secret key is correct in Railway variables');
            console.error('3. Try regenerating the AWS access key pair');
            console.error('4. Ensure the region matches your bucket region');
        }
    }
};

// Export for server use
const validateRailwayS3 = () => {
    console.log('🔍 Railway S3 Validation');
    console.log('========================');
    
    const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME', 'AWS_REGION'];
    const missing = required.filter(env => !process.env[env]);
    
    if (missing.length > 0) {
        console.error('❌ Missing environment variables:', missing);
        return false;
    }
    
    console.log('✅ All environment variables present');
    
    // Validate format
    if (!process.env.AWS_ACCESS_KEY_ID.startsWith('AKIA')) {
        console.error('❌ AWS_ACCESS_KEY_ID should start with AKIA');
        return false;
    }
    
    if (process.env.AWS_SECRET_ACCESS_KEY.length < 20) {
        console.error('❌ AWS_SECRET_ACCESS_KEY seems too short');
        return false;
    }
    
    console.log('✅ Environment variables format looks correct');
    return true;
};

if (require.main === module) {
    require('dotenv').config();
    testExactConfig();
}

module.exports = { validateRailwayS3, testExactConfig };
