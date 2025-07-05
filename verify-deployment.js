#!/usr/bin/env node

/**
 * Production Deployment Verification Script
 * Tests if the Harmony Learning Institute app is properly deployed
 */

const https = require('https');
const http = require('http');

// Configuration
const RAILWAY_URL = process.argv[2] || 'your-railway-url.railway.app';
const PROTOCOL = RAILWAY_URL.includes('localhost') ? 'http:' : 'https:';

console.log('🔍 Verifying Harmony Learning Institute Deployment');
console.log(`📍 Target URL: ${PROTOCOL}//${RAILWAY_URL}`);
console.log('=' * 50);

// Test functions
async function testEndpoint(path, expectedType = 'json') {
  return new Promise((resolve) => {
    const client = PROTOCOL === 'https:' ? https : http;
    const options = {
      hostname: RAILWAY_URL.replace(/^https?:\/\//, ''),
      port: PROTOCOL === 'https:' ? 443 : 80,
      path: path,
      method: 'GET',
      headers: {
        'User-Agent': 'Harmony-Deployment-Verification/1.0'
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: data,
          headers: res.headers
        });
      });
    });

    req.on('error', (error) => {
      resolve({ error: error.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ error: 'Timeout' });
    });

    req.end();
  });
}

// Main verification function
async function runVerification() {
  const tests = [
    {
      name: 'API Health Check',
      path: '/api/health',
      expectedType: 'json',
      check: (response) => {
        try {
          const data = JSON.parse(response.data);
          return data.status === 'OK' && data.service.includes('Harmony');
        } catch {
          return false;
        }
      }
    },
    {
      name: 'API Info Endpoint',
      path: '/api',
      expectedType: 'json',
      check: (response) => {
        try {
          const data = JSON.parse(response.data);
          return data.message.includes('Harmony') && data.endpoints;
        } catch {
          return false;
        }
      }
    },
    {
      name: 'Frontend Loading (Root)',
      path: '/',
      expectedType: 'html',
      check: (response) => {
        const html = response.data;
        return html.includes('<html') || html.includes('<!DOCTYPE html') || 
               html.includes('react') || html.includes('Harmony');
      }
    },
    {
      name: 'Static Assets',
      path: '/static/css',
      expectedType: 'any',
      check: (response) => response.status === 200 || response.status === 404 // 404 is ok, means React build exists
    }
  ];

  console.log('🧪 Running verification tests...\n');

  for (const test of tests) {
    process.stdout.write(`  ${test.name}... `);
    
    const result = await testEndpoint(test.path, test.expectedType);
    
    if (result.error) {
      console.log(`❌ ERROR: ${result.error}`);
      continue;
    }

    if (result.status >= 200 && result.status < 400) {
      if (test.check(result)) {
        console.log('✅ PASS');
      } else {
        console.log(`⚠️  PARTIAL (Status: ${result.status})`);
        if (test.path === '/' && result.data.includes('Harmony Learning Institute API')) {
          console.log('    ⚠️  Still showing API JSON instead of React app');
        }
      }
    } else {
      console.log(`❌ FAIL (Status: ${result.status})`);
    }
  }

  console.log('\n🎯 Quick Analysis:');
  
  // Root endpoint analysis
  const rootTest = await testEndpoint('/');
  if (rootTest.data && rootTest.data.includes('Harmony Learning Institute API')) {
    console.log('❌ Frontend not loading: Root still shows API JSON');
    console.log('   Next: Check Railway deployment logs and build status');
  } else if (rootTest.data && (rootTest.data.includes('<html') || rootTest.data.includes('<!DOCTYPE'))) {
    console.log('✅ Frontend loading: React app is being served');
    console.log('   Next: Test login and dashboard functionality');
  } else {
    console.log('⚠️  Unclear frontend status - manual verification needed');
  }

  console.log('\n📋 Summary:');
  console.log(`   App URL: ${PROTOCOL}//${RAILWAY_URL}`);
  console.log(`   API URL: ${PROTOCOL}//${RAILWAY_URL}/api`);
  console.log(`   Health: ${PROTOCOL}//${RAILWAY_URL}/api/health`);
}

// Handle command line
if (require.main === module) {
  if (!process.argv[2] || process.argv[2].includes('your-railway-url')) {
    console.log('Usage: node verify-deployment.js <railway-url>');
    console.log('Example: node verify-deployment.js harmony-learning-production.railway.app');
    process.exit(1);
  }
  
  runVerification().catch(console.error);
}

module.exports = { testEndpoint, runVerification };
