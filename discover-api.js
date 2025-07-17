const axios = require('axios');

// Test different URL patterns to find the correct API structure
const BASE_URL = 'https://web-production-618c0.up.railway.app';

async function discoverAPIStructure() {
  console.log('🔍 DISCOVERING API STRUCTURE');
  console.log('============================');
  console.log('Testing base URL:', BASE_URL);
  
  // Test different possible endpoints
  const testEndpoints = [
    '/',
    '/api',
    '/api/auth',
    '/auth/login',
    '/api/auth/login',
    '/quizzes',
    '/api/quizzes',
    '/health',
    '/api/health'
  ];
  
  for (const endpoint of testEndpoints) {
    const fullUrl = `${BASE_URL}${endpoint}`;
    console.log(`\nTesting: ${fullUrl}`);
    
    try {
      const response = await axios.get(fullUrl, { timeout: 5000 });
      console.log(`✅ ${endpoint} - Status: ${response.status}`);
      if (response.data && typeof response.data === 'object') {
        console.log('Response sample:', JSON.stringify(response.data).substring(0, 200));
      } else if (response.data && typeof response.data === 'string') {
        console.log('Response sample:', response.data.substring(0, 200));
      }
    } catch (error) {
      const status = error.response?.status || 'NO_RESPONSE';
      const message = error.response?.data || error.message;
      console.log(`❌ ${endpoint} - Status: ${status} - ${error.code || 'UNKNOWN'}`);
      
      if (status === 404) {
        console.log('   (Endpoint not found)');
      } else if (status === 500) {
        console.log('   (Server error - endpoint exists but failing)');
      } else if (error.code === 'ECONNREFUSED') {
        console.log('   (Connection refused - server not running)');
      } else if (error.code === 'ETIMEDOUT') {
        console.log('   (Request timeout)');
      }
    }
  }
  
  // Test POST login endpoint specifically
  console.log('\n🔐 Testing login endpoint with actual data...');
  try {
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'test@test.com',
      password: 'test123'
    }, { 
      timeout: 10000,
      validateStatus: () => true // Accept any status code
    });
    
    console.log(`Login test - Status: ${loginResponse.status}`);
    if (loginResponse.data) {
      console.log('Login response:', JSON.stringify(loginResponse.data, null, 2));
    }
  } catch (loginError) {
    console.log('Login test failed:', loginError.message);
  }
  
  console.log('\n✅ DISCOVERY COMPLETE');
}

discoverAPIStructure().catch(console.error);
