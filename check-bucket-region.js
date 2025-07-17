// Verify exact bucket region for debugging
const { S3Client, GetBucketLocationCommand } = require('@aws-sdk/client-s3');

// Use your credentials temporarily to check bucket region
const config = {
  // Don't commit these credentials! Delete this file after testing
  accessKeyId: 'AKIATCK5MCDYLQPNKMJ', // From your Railway screenshot
  secretAccessKey: '', // ADD YOUR SECRET KEY HERE FOR TESTING
  region: 'eu-north-1' // What we think it should be
};

const bucketName = 'harmony-learning-documents-harmony2025';

async function checkBucketRegion() {
  if (!config.secretAccessKey) {
    console.log('❌ Please add your AWS_SECRET_ACCESS_KEY to this script for testing');
    console.log('   Edit this file and add the secret key, then run again');
    console.log('   DELETE this file after testing for security!');
    return;
  }

  try {
    console.log('🔍 Checking exact bucket region...');
    
    // Create S3 client with minimal config
    const s3Client = new S3Client({
      region: 'us-east-1', // Use us-east-1 for getBucketLocation
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });

    const result = await s3Client.send(new GetBucketLocationCommand({
      Bucket: bucketName
    }));

    const actualRegion = result.LocationConstraint || 'us-east-1';
    
    console.log('📍 BUCKET REGION RESULTS:');
    console.log('   Bucket name:', bucketName);
    console.log('   Actual region:', actualRegion);
    console.log('   Railway config:', 'eu-north-1');
    console.log('   Match:', actualRegion === 'eu-north-1' ? '✅ YES' : '❌ NO');
    
    if (actualRegion !== 'eu-north-1') {
      console.log('');
      console.log('🔧 SOLUTION:');
      console.log(`   Update AWS_REGION in Railway to: ${actualRegion}`);
      console.log('   This will fix the signature error!');
    } else {
      console.log('');
      console.log('🤔 Region is correct. Issue might be:');
      console.log('   1. Extra whitespace in credentials');
      console.log('   2. Credentials need to be regenerated');
      console.log('   3. System clock skew');
    }

  } catch (error) {
    console.log('❌ Error checking bucket region:', error.message);
    
    if (error.code === 'SignatureDoesNotMatch') {
      console.log('');
      console.log('🔧 The signature error persists even for basic operations.');
      console.log('   This suggests the AWS credentials themselves are invalid.');
      console.log('   Try generating new credentials in AWS IAM console.');
    }
  }
}

console.log('⚠️  SECURITY WARNING: This file contains AWS credentials!');
console.log('   DELETE this file after testing!');
console.log('');

checkBucketRegion();
