// Test script to verify target audience functionality
const axios = require('axios');

const BASE_URL = 'https://web-production-618c0.up.railway.app';

async function testTargetAudience() {
  console.log('Testing target audience functionality...');
  
  try {
    // Test 1: Try to create an announcement with target_audience
    console.log('\n1. Testing announcement creation with target_audience...');
    
    const testData = {
      title: 'Test Announcement with Target Audience',
      content: 'This is a test announcement for staff only.',
      priority: 'normal',
      grade_id: 1,
      class_id: 1,
      target_audience: 'staff'
    };
    
    console.log('Test data:', testData);
    console.log('Note: This test requires authentication, so it will likely fail with 401');
    
    const response = await axios.post(`${BASE_URL}/api/announcements`, testData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Response:', response.data);
    
  } catch (error) {
    if (error.response) {
      console.log('❌ Error response:', error.response.status, error.response.data);
      if (error.response.status === 401) {
        console.log('✅ Expected 401 error - authentication required');
      } else if (error.response.status === 500 && error.response.data.message?.includes('target_audience')) {
        console.log('❌ Database schema issue - target_audience column missing');
      } else {
        console.log('❌ Other error:', error.response.data);
      }
    } else {
      console.log('❌ Network error:', error.message);
    }
  }
  
  // Test 2: Check if the server is running
  console.log('\n2. Testing server health...');
  try {
    const healthResponse = await axios.get(`${BASE_URL}/`);
    console.log('✅ Server is running');
  } catch (error) {
    console.log('❌ Server health check failed:', error.message);
  }
}

testTargetAudience();
