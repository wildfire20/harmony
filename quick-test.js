const https = require('https');

const baseUrl = 'https://web-production-618c0.up.railway.app';

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method: method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsedData });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function quickTest() {
  try {
    console.log('🔍 Quick quiz access test...');
    
    // Login as student
    const login = await makeRequest('POST', '/api/auth/login/student', {
      student_number: 'S001',
      password: 'student123'
    });
    
    if (login.status === 200) {
      console.log('✅ Login successful');
      
      // Test quiz endpoint with a sample task ID
      const testResponse = await makeRequest('GET', '/api/quizzes/1', null, login.data.token);
      console.log(`Quiz access test: ${testResponse.status}`);
      
      if (testResponse.status === 200) {
        console.log('✅ Quiz access fixed! The "Take Quiz" button should work now.');
      } else {
        console.log('Status:', testResponse.status, 'Response:', testResponse.data);
      }
    } else {
      console.log('❌ Login failed');
    }
  } catch (error) {
    console.log('Error:', error.message);
  }
}

quickTest();
