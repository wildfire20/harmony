const https = require('https');

function testEndpoint(url, description) {
  return new Promise((resolve) => {
    console.log(`Testing ${description}...`);
    
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`✅ ${description}: Status ${res.statusCode}`);
        if (res.statusCode === 200 && data.includes('"status"')) {
          const parsed = JSON.parse(data);
          console.log(`   Response:`, JSON.stringify(parsed, null, 2));
        }
        resolve({ status: res.statusCode, data });
      });
    });
    
    req.on('error', (error) => {
      console.log(`❌ ${description}: ${error.message}`);
      resolve({ error: error.message });
    });
    
    req.setTimeout(10000, () => {
      console.log(`⏱️ ${description}: Timeout`);
      req.destroy();
      resolve({ error: 'Timeout' });
    });
  });
}

async function quickTest() {
  console.log('🧪 QUICK RAILWAY API TEST');
  console.log('========================');
  
  const baseUrl = 'https://web-production-618c0.up.railway.app';
  
  await testEndpoint(`${baseUrl}/health`, 'Health endpoint');
  await testEndpoint(`${baseUrl}/api/health`, 'API Health endpoint');
  
  console.log('\n✅ Test complete');
}

quickTest();
