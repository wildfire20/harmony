// Quick region check script
const { S3Client, GetBucketLocationCommand } = require('@aws-sdk/client-s3');

// Use your NEW credentials
const ACCESS_KEY = 'AKIATCK5WBCDY74SEMNA'; // Your new access key
const SECRET_KEY = ''; // ADD YOUR NEW SECRET KEY HERE
const BUCKET = 'harmony-learning-documents-harmony2025';

async function checkRegion() {
  if (!SECRET_KEY) {
    console.log('❌ Please add your new secret key to this script');
    console.log('   Edit line 5 and add the secret key for AKIATCK5WBCDY74SEMNA');
    return;
  }

  try {
    // Use us-east-1 for the getBucketLocation call (this is standard)
    const s3 = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY
      }
    });

    console.log('🔍 Checking bucket region...');
    const result = await s3.send(new GetBucketLocationCommand({ Bucket: BUCKET }));
    
    const actualRegion = result.LocationConstraint || 'us-east-1';
    console.log('');
    console.log('📍 RESULTS:');
    console.log('   Bucket:', BUCKET);
    console.log('   Actual AWS region:', actualRegion);
    console.log('   Currently configured:', 'eu-north-1');
    console.log('');
    
    if (actualRegion === 'eu-north-1') {
      console.log('✅ Region is correct. Issue might be elsewhere.');
      console.log('   Try regenerating credentials again or check for whitespace.');
    } else {
      console.log('🔧 FOUND THE ISSUE!');
      console.log(`   Change AWS_REGION in Railway to: ${actualRegion}`);
      console.log('   This should fix the signature error!');
    }

  } catch (error) {
    console.log('❌ Error:', error.message);
    if (error.code === 'SignatureDoesNotMatch') {
      console.log('   The new credentials still have signature issues.');
      console.log('   Double-check the secret key was copied correctly.');
    }
  }
}

console.log('⚠️  Remember to delete this file after testing (contains credentials)');
console.log('');
checkRegion();
