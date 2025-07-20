// Simple test to check if server is responding
const testServerHealth = async () => {
  console.log('🏥 Testing Server Health');
  console.log('='.repeat(40));
  
  const baseUrl = 'https://content-compassion-production.up.railway.app';
  
  try {
    // Test if server is up
    console.log('Testing basic server response...');
    const healthResponse = await fetch(`${baseUrl}/health`);
    
    if (healthResponse.ok) {
      console.log('✅ Server is responding');
    } else {
      console.log(`⚠️  Server response: ${healthResponse.status}`);
    }
    
    // Test if API endpoints are reachable
    console.log('\nTesting API endpoint accessibility...');
    const apiResponse = await fetch(`${baseUrl}/api`);
    console.log(`API base endpoint: ${apiResponse.status}`);
    
    // Check for auth endpoints specifically
    console.log('\nTesting auth endpoint...');
    const authResponse = await fetch(`${baseUrl}/api/auth/verify`);
    console.log(`Auth endpoint: ${authResponse.status} (expected 401 without token)`);
    
  } catch (error) {
    console.error('❌ Server health check failed:', error.message);
  }
};

testServerHealth();
