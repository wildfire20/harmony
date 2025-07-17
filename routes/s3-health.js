// S3 Health Check Route - AWS SDK v3 version
const express = require('express');
const { S3Client, ListBucketsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

const router = express.Router();

// Simple S3 Health Check endpoint using AWS SDK v3
router.get('/health/s3', async (req, res) => {
    try {
        console.log('🔍 S3 Health Check Started');
        
        // Check environment variables
        const requiredVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET_NAME'];
        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
        }
        
        console.log('✅ Environment variables present');
        
        // Create S3 client with AWS SDK v3
        const s3Client = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
        
        console.log('✅ S3 Client created');
        
        // Test basic S3 connectivity
        const listResult = await s3Client.send(new ListBucketsCommand({}));
        console.log(`✅ S3 Authentication successful - Found ${listResult.Buckets.length} buckets`);
        
        // Test bucket access
        await s3Client.send(new HeadBucketCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME }));
        console.log(`✅ Bucket "${process.env.AWS_S3_BUCKET_NAME}" is accessible`);
        
        res.json({
            status: 'success',
            message: 'S3 is working correctly',
            timestamp: new Date().toISOString(),
            bucket: process.env.AWS_S3_BUCKET_NAME,
            region: process.env.AWS_REGION,
            bucketsFound: listResult.Buckets.length
        });
        
    } catch (error) {
        console.error('❌ S3 Health Check Failed:', error);
        
        res.status(500).json({
            status: 'error',
            message: 'S3 health check failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
