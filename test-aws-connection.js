const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

// Test AWS connection
async function testAWSConnection() {
  console.log('🧪 Testing AWS S3 Connection...');
  
  try {
    // Check if environment variables are set
    const requiredVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.log('❌ Missing environment variables:', missingVars);
      console.log('Please set these in Railway dashboard');
      return false;
    }
    
    console.log('✅ Environment variables are set');
    
    // Test S3 connection
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    
    const listCommand = new ListBucketsCommand({});
    const response = await s3Client.send(listCommand);
    
    console.log('✅ AWS S3 connection successful!');
    console.log('Available buckets:', response.Buckets.map(b => b.Name));
    
    // Check if our specific bucket exists
    const ourBucket = process.env.AWS_S3_BUCKET_NAME;
    const bucketExists = response.Buckets.some(b => b.Name === ourBucket);
    
    if (bucketExists) {
      console.log(`✅ Target bucket "${ourBucket}" found`);
    } else {
      console.log(`❌ Target bucket "${ourBucket}" not found`);
      console.log('Please create this bucket in AWS S3 console');
    }
    
    return bucketExists;
    
  } catch (error) {
    console.log('❌ AWS S3 connection failed:', error.message);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testAWSConnection()
    .then(success => {
      if (success) {
        console.log('🎉 AWS setup is complete and working!');
      } else {
        console.log('🔧 Please fix the issues above and try again');
      }
    })
    .catch(error => {
      console.error('Test failed:', error);
    });
}

module.exports = { testAWSConnection };
