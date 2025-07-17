// Local test with your actual AWS credentials
// Run this locally with: node local-s3-test.js

const { S3Client, ListBucketsCommand, PutObjectCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');

// Replace these with your actual AWS credentials (temporarily for testing)
const TEMP_ACCESS_KEY = 'AKIATCK5MCDYLQPNKMJ';  // Your access key from Railway screenshot
const TEMP_SECRET_KEY = 'abkQXjZuhCGEVJ7+rX00cVLRf6/58Gvsfxf91H48';  // Your secret key (hidden in Railway)
const REGION = 'eu-north-1';
const BUCKET = 'harmony-learning-documents-harmony2025';

console.log('🔍 LOCAL S3 TEST');
console.log('================');
console.log('This test uses your actual credentials to verify S3 works locally');
console.log('');

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: TEMP_ACCESS_KEY,
    secretAccessKey: TEMP_SECRET_KEY
  }
});

async function testLocalS3() {
  try {
    console.log('1. Testing bucket list...');
    const buckets = await s3Client.send(new ListBucketsCommand({}));
    console.log('✅ Connected to AWS');
    console.log('   Available buckets:', buckets.Buckets.map(b => b.Name));
    
    const targetExists = buckets.Buckets.find(b => b.Name === BUCKET);
    if (!targetExists) {
      console.log('❌ Target bucket not found');
      return;
    }
    console.log('✅ Target bucket found');
    
    console.log('\n2. Checking bucket region...');
    const location = await s3Client.send(new GetBucketLocationCommand({ Bucket: BUCKET }));
    const actualRegion = location.LocationConstraint || 'us-east-1';
    console.log('   Bucket region:', actualRegion);
    console.log('   Config region:', REGION);
    
    if (actualRegion !== REGION) {
      console.log('❌ REGION MISMATCH FOUND!');
      console.log(`   Your Railway AWS_REGION should be: ${actualRegion}`);
      return;
    }
    console.log('✅ Region matches');
    
    console.log('\n3. Testing upload...');
    const testKey = `test-local-${Date.now()}.txt`;
    const testContent = 'Local test from your computer';
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain'
    }));
    
    console.log('✅ Upload successful!');
    console.log('');
    console.log('🎉 ALL TESTS PASSED!');
    console.log('Your AWS credentials and configuration are correct.');
    console.log('The issue must be with Railway deployment or environment variables.');
    
  } catch (error) {
    console.log('❌ Test failed:');
    console.log('   Error:', error.message);
    console.log('   Code:', error.Code || 'Unknown');
    
    if (error.Code === 'SignatureDoesNotMatch') {
      console.log('\n🔧 This confirms the signature error exists.');
      console.log('   Try these fixes:');
      console.log('   1. Generate new AWS credentials in IAM console');
      console.log('   2. Copy them carefully (no extra spaces)');
      console.log('   3. Update Railway environment variables');
    }
  }
}

console.log('⚠️  SECURITY NOTE: Delete this file after testing!');
console.log('    It contains your actual AWS credentials.');
console.log('');

testLocalS3();
