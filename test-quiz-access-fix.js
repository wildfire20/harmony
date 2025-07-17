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

async function testQuizAccess() {
  try {
    console.log('🧪 Testing Quiz Access Fix...\n');

    // 1. Login as student
    console.log('1. Logging in as student...');
    const studentLogin = await makeRequest('POST', '/api/auth/login/student', {
      student_number: 'S001',
      password: 'student123'
    });
    
    if (studentLogin.status !== 200) {
      console.log('❌ Student login failed:', studentLogin.data);
      return;
    }
    
    const studentToken = studentLogin.data.token;
    console.log('✅ Student logged in successfully');

    // 2. Get available quizzes
    console.log('\n2. Fetching available quizzes...');
    const quizzesResponse = await makeRequest('GET', '/api/quizzes', null, studentToken);
    
    if (quizzesResponse.status !== 200) {
      console.log('❌ Failed to fetch quizzes:', quizzesResponse.data);
      return;
    }

    const quizzes = quizzesResponse.data.quizzes;
    console.log(`✅ Found ${quizzes.length} quizzes`);

    if (quizzes.length === 0) {
      console.log('⚠️  No quizzes available for testing');
      console.log('   Solution: Create a quiz first using the admin/teacher interface');
      return;
    }

    // 3. Test accessing the first quiz
    const testQuiz = quizzes[0];
    console.log(`\n3. Testing access to quiz: "${testQuiz.title}"`);
    console.log(`   Task ID: ${testQuiz.task_id}`);
    
    const quizDetailsResponse = await makeRequest('GET', `/api/quizzes/${testQuiz.task_id}`, null, studentToken);
    
    if (quizDetailsResponse.status === 200) {
      console.log('✅ Quiz access successful!');
      console.log('   Quiz details retrieved successfully');
      console.log(`   Questions: ${quizDetailsResponse.data.quiz.questions.length}`);
      console.log(`   Time limit: ${quizDetailsResponse.data.quiz.time_limit || 'No limit'} minutes`);
      console.log(`   Attempts remaining: ${quizDetailsResponse.data.quiz.attempts_remaining || 'N/A'}`);
    } else if (quizDetailsResponse.status === 404) {
      console.log('❌ Quiz not found (404)');
      console.log('   This could indicate an issue with the quiz data or routing');
    } else if (quizDetailsResponse.status === 403) {
      console.log('❌ Access denied (403)');
      console.log('   Check if student is in the correct grade/class for this quiz');
    } else {
      console.log(`❌ Unexpected error (${quizDetailsResponse.status}):`, quizDetailsResponse.data);
    }

    // 4. Summary
    console.log('\n📊 TEST SUMMARY:');
    if (quizDetailsResponse.status === 200) {
      console.log('✅ Quiz access is working correctly!');
      console.log('✅ "Take Quiz" button should now work');
      console.log('🎯 Try clicking "Take Quiz" in the web interface');
    } else {
      console.log('❌ Quiz access still has issues');
      console.log('   Check server logs for more details');
    }

    console.log(`\n🌐 Test your quiz at: ${baseUrl}/quizzes`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Wait for deployment, then test
setTimeout(() => {
  console.log('⏳ Waiting for deployment to complete...\n');
  testQuizAccess();
}, 30000); // Wait 30 seconds for deployment
