require('dotenv').config();
const { S3Client, PutObjectCommand, ListBucketsCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');

console.log('=== HARMONY S3 DIAGNOSIS ===');

// These should match your Railway environment variables exactly
const config = {
  region: 'eu-north-1', // Your bucket region from screenshots
  bucketName: 'harmony-learning-documents-harmony2025', // Your bucket name from screenshots
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  },
  forcePathStyle: false,
  signatureVersion: 'v4'
};

console.log('Configuration:');
console.log('  Region:', config.region);
console.log('  Bucket:', config.bucketName);
console.log('  Access Key:', config.credentials.accessKeyId ? `${config.credentials.accessKeyId.substring(0, 4)}...` : 'MISSING');
console.log('  Secret Key:', config.credentials.secretAccessKey ? `${config.credentials.secretAccessKey.substring(0, 4)}...` : 'MISSING');

async function diagnoseS3Issue() {
  const s3Client = new S3Client(config);
  
  try {
    console.log('\n1. Testing AWS credentials...');
    const bucketsResult = await s3Client.send(new ListBucketsCommand({}));
    console.log('✅ AWS credentials valid');
    console.log('Available buckets:', bucketsResult.Buckets.map(b => b.Name));
    
    const targetBucket = bucketsResult.Buckets.find(b => b.Name === config.bucketName);
    if (!targetBucket) {
      console.log('❌ Target bucket not found:', config.bucketName);
      return false;
    }
    console.log('✅ Target bucket found');
    
    console.log('\n2. Checking bucket region...');
    const locationResult = await s3Client.send(new GetBucketLocationCommand({ 
      Bucket: config.bucketName 
    }));
    const actualRegion = locationResult.LocationConstraint || 'us-east-1';
    console.log('Bucket actual region:', actualRegion);
    console.log('Configured region:', config.region);
    
    if (actualRegion !== config.region) {
      console.log('⚠️  REGION MISMATCH DETECTED!');
      console.log(`❌ This is causing the signature error!`);
      console.log(`🔧 Solution: Set AWS_REGION to "${actualRegion}" in Railway`);
      return false;
    }
    console.log('✅ Region matches');
    
    console.log('\n3. Testing file upload...');
    const testKey = `test-uploads/diagnostic-${Date.now()}.txt`;
    const testContent = 'Diagnostic test from Harmony Learning Institute';
    
    const uploadCommand = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: testKey,
      Body: Buffer.from(testContent),
      ContentType: 'text/plain'
    });
    
    const uploadResult = await s3Client.send(uploadCommand);
    console.log('✅ Upload successful!');
    console.log('ETag:', uploadResult.ETag);
    
    // Clean up test file
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: testKey
    }));
    console.log('✅ Test file cleaned up');
    
    console.log('\n🎉 ALL TESTS PASSED! S3 is working correctly.');
    return true;
    
  } catch (error) {
    console.log('\n❌ DIAGNOSIS FAILED:');
    console.log('Error code:', error.Code || error.code || 'Unknown');
    console.log('Error message:', error.message);
    
    if ((error.Code === 'SignatureDoesNotMatch') || error.message.includes('signature')) {
      console.log('\n🔍 SIGNATURE ERROR DETECTED:');
      console.log('This error happens when:');
      console.log('1. ❌ Region mismatch (most common)');
      console.log('2. ❌ AWS credentials have whitespace/newlines');
      console.log('3. ❌ System clock is off by more than 15 minutes');
      console.log('4. ❌ Invalid AWS credentials');
      
      console.log('\n📋 IMMEDIATE FIXES TO TRY:');
      console.log('1. Check your bucket region in AWS console');
      console.log('2. Copy/paste AWS credentials again (no extra spaces)');
      console.log('3. Verify credentials with: aws s3 ls s3://your-bucket-name');
    }
    
    return false;
  }
}

// Run the diagnosis
if (require.main === module) {
  diagnoseS3Issue().then(success => {
    if (success) {
      console.log('\n✅ Diagnosis complete: S3 is working!');
    } else {
      console.log('\n❌ Diagnosis complete: Issues found above');
    }
  }).catch(console.error);
}

module.exports = { diagnoseS3Issue };
