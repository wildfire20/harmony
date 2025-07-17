// Test script to verify what's happening with Railway
const axios = require('axios');

async function testRailwayStatus() {
  console.log('🔍 TESTING RAILWAY DEPLOYMENT STATUS');
  console.log('===================================');
  
  const baseUrl = 'https://web-production-618c0.up.railway.app';
  
  try {
    // Test if main page loads
    console.log('1. Testing main page...');
    const mainResponse = await axios.get(baseUrl, { timeout: 10000 });
    console.log('✅ Main page loads (React app working)');
    
    // Test health endpoint
    console.log('2. Testing health endpoint...');
    try {
      const healthResponse = await axios.get(`${baseUrl}/health`, { timeout: 5000 });
      console.log('✅ Health endpoint responds:', healthResponse.status);
      if (healthResponse.data) {
        console.log('Health data:', healthResponse.data);
      }
    } catch (healthError) {
      console.log('❌ Health endpoint failed:', healthError.response?.status || healthError.message);
    }
    
    // Test API endpoints
    console.log('3. Testing API endpoints...');
    const apiTests = [
      '/api/health',
      '/api/auth/status',
      '/api/quizzes'
    ];
    
    for (const endpoint of apiTests) {
      try {
        const response = await axios.get(`${baseUrl}${endpoint}`, { 
          timeout: 5000,
          validateStatus: () => true // Accept any status code
        });
        console.log(`   ${endpoint}: Status ${response.status}`);
        
        if (response.status === 404 && response.data.includes('Cannot GET')) {
          console.log('     → Route not found (server routing issue)');
        } else if (response.status === 500) {
          console.log('     → Server error (likely database connection)');
        } else if (response.status === 200) {
          console.log('     → Working properly');
        }
      } catch (error) {
        console.log(`   ${endpoint}: Error - ${error.message}`);
      }
    }
    
    // Try to make a login request
    console.log('4. Testing authentication endpoint...');
    try {
      const loginResponse = await axios.post(`${baseUrl}/api/auth/login`, {
        email: 'test@test.com',
        password: 'test123'
      }, { 
        timeout: 10000,
        validateStatus: () => true
      });
      
      console.log(`   Login test: Status ${loginResponse.status}`);
      if (loginResponse.status === 404) {
        console.log('   → Auth routes not mounted (server startup issue)');
      } else if (loginResponse.status === 401 || loginResponse.status === 400) {
        console.log('   → Auth endpoint working (expected auth failure)');
      } else if (loginResponse.status === 500) {
        console.log('   → Server error in auth (database issue)');
      }
    } catch (loginError) {
      console.log(`   Login test failed: ${loginError.message}`);
    }
    
  } catch (error) {
    console.error('❌ Main site not accessible:', error.message);
  }
  
  console.log('\n📋 SUMMARY:');
  console.log('- If main page loads but API returns 404: Server started but API routes not mounted');
  console.log('- If API returns 500: Server started but database connection failing');
  console.log('- If nothing loads: Server not starting at all');
}

testRailwayStatus().catch(console.error);
