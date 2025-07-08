#!/usr/bin/env node

/**
 * Quick API Test Script for Railway Deployment
 * Tests login functionality and API connectivity
 */

const https = require('https');

const RAILWAY_URL = process.argv[2] || 'web-production-618c0.up.railway.app';

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({ status: res.statusCode, data: response, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testAPI() {
  console.log('🧪 Testing Railway API Connection...');
  console.log(`📍 URL: https://${RAILWAY_URL}`);
  console.log('=' * 50);

  try {
    // Test 1: Health Check
    console.log('1. Testing health endpoint...');
    const healthOptions = {
      hostname: RAILWAY_URL,
      port: 443,
      path: '/api/health',
      method: 'GET'
    };
    
    const healthResult = await makeRequest(healthOptions);
    if (healthResult.status === 200) {
      console.log('   ✅ Health check passed');
    } else {
      console.log(`   ❌ Health check failed: ${healthResult.status}`);
    }

    // Test 2: Login Test
    console.log('2. Testing admin login...');
    const loginOptions = {
      hostname: RAILWAY_URL,
      port: 443,
      path: '/api/auth/login/staff',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const loginData = {
      email: 'admin@harmonylearning.edu',
      password: 'admin123'
    };

    const loginResult = await makeRequest(loginOptions, loginData);
    
    if (loginResult.status === 200 && loginResult.data.token) {
      console.log('   ✅ Admin login successful');
      console.log(`   👤 User: ${loginResult.data.user.first_name} ${loginResult.data.user.last_name}`);
      console.log(`   🔑 Role: ${loginResult.data.user.role}`);
    } else {
      console.log(`   ❌ Login failed: ${loginResult.status}`);
      console.log(`   📝 Response: ${JSON.stringify(loginResult.data, null, 2)}`);
    }

    // Test 3: Database connectivity (indirect)
    console.log('3. Testing database connectivity...');
    if (loginResult.status === 200) {
      console.log('   ✅ Database connected (login worked)');
    } else {
      console.log('   ⚠️  Database connection unclear');
    }

    console.log('\n📋 Summary:');
    if (healthResult.status === 200 && loginResult.status === 200) {
      console.log('✅ All tests passed - API is working correctly!');
      console.log('🎉 You can now login with: admin@harmonylearning.edu / admin123');
    } else {
      console.log('❌ Some tests failed - check Railway deployment logs');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

if (require.main === module) {
  testAPI();
}

module.exports = { testAPI };
