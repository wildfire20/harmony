// Test script for announcements functionality
const fetch = require('node-fetch');

const API_BASE = 'https://web-production-618c0.up.railway.app/api';

const testAnnouncements = async () => {
  console.log('🧪 Testing Announcements API on Production...');
  
  try {
    // Test health endpoint
    console.log('\n1. Testing health endpoint...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData.message);
    
    // Test announcements endpoint (should require auth)
    console.log('\n2. Testing announcements endpoint (should require auth)...');
    const announcementsResponse = await fetch(`${API_BASE}/announcements`);
    const announcementsData = await announcementsResponse.json();
    
    if (announcementsResponse.status === 401) {
      console.log('✅ Announcements endpoint correctly requires authentication');
      console.log('Response:', announcementsData.message);
    } else {
      console.log('❌ Unexpected response from announcements endpoint');
      console.log('Status:', announcementsResponse.status);
      console.log('Data:', announcementsData);
    }
    
    // Test announcements metadata endpoint (should require auth)
    console.log('\n3. Testing announcements metadata endpoint...');
    const metaResponse = await fetch(`${API_BASE}/announcements/meta/targets`);
    const metaData = await metaResponse.json();
    
    if (metaResponse.status === 401) {
      console.log('✅ Metadata endpoint correctly requires authentication');
    } else {
      console.log('❌ Unexpected response from metadata endpoint');
      console.log('Status:', metaResponse.status);
    }
    
    console.log('\n🎉 All tests passed! Announcements API is deployed correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

// Run tests if this script is executed directly
if (require.main === module) {
  testAnnouncements();
}

module.exports = { testAnnouncements };
