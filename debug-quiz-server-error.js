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

async function debugQuizIssue() {
  try {
    console.log('🔍 Debugging Quiz Server Error...\n');

    // Test multiple user types to understand the issue
    const testUsers = [
      { type: 'student', endpoint: '/api/auth/login/student', creds: { student_number: 'S001', password: 'student123' } },
      { type: 'teacher', endpoint: '/api/auth/login/staff', creds: { email: 'teacher@harmony.edu', password: 'teacher123' } },
      { type: 'admin', endpoint: '/api/auth/login/staff', creds: { email: 'admin@harmony.edu', password: 'admin123' } }
    ];

    for (const testUser of testUsers) {
      console.log(`\n=== Testing as ${testUser.type.toUpperCase()} ===`);
      
      // 1. Login
      const login = await makeRequest('POST', testUser.endpoint, testUser.creds);
      if (login.status !== 200) {
        console.log(`❌ ${testUser.type} login failed:`, login.data);
        continue;
      }
      console.log(`✅ ${testUser.type} logged in successfully`);

      // 2. Get quiz list
      const quizList = await makeRequest('GET', '/api/quizzes', null, login.data.token);
      console.log(`Quiz list status: ${quizList.status}`);
      
      if (quizList.status === 200) {
        const quizzes = quizList.data.quizzes;
        console.log(`   Found ${quizzes.length} quizzes`);
        
        if (quizzes.length > 0) {
          const firstQuiz = quizzes[0];
          console.log(`   First quiz: "${firstQuiz.title}" (task_id: ${firstQuiz.task_id})`);
          
          // 3. Try to access quiz details
          const quizDetails = await makeRequest('GET', `/api/quizzes/${firstQuiz.task_id}`, null, login.data.token);
          console.log(`   Quiz details status: ${quizDetails.status}`);
          
          if (quizDetails.status !== 200) {
            console.log(`   ❌ Error details:`, quizDetails.data);
          } else {
            console.log(`   ✅ Quiz details fetched successfully`);
            console.log(`      Questions: ${quizDetails.data.quiz.questions.length}`);
          }
        } else {
          console.log('   ⚠️  No quizzes available for this user');
        }
      } else {
        console.log(`   ❌ Quiz list error:`, quizList.data);
      }
    }

    // 4. Test specific scenarios
    console.log('\n=== SPECIFIC SCENARIO TESTS ===');
    
    // Create a quiz as teacher and try to access as student
    console.log('\n1. Testing teacher -> student quiz access...');
    
    const teacherLogin = await makeRequest('POST', '/api/auth/login/staff', {
      email: 'teacher@harmony.edu',
      password: 'teacher123'
    });
    
    if (teacherLogin.status === 200) {
      console.log('✅ Teacher logged in');
      
      // Get teacher's available assignments first
      const assignments = await makeRequest('GET', `/api/admin/teachers/${teacherLogin.data.user.id}/assignments`, null, teacherLogin.data.token);
      console.log(`Teacher assignments status: ${assignments.status}`);
      
      if (assignments.status === 200 && assignments.data.assignments.length > 0) {
        console.log(`Teacher has ${assignments.data.assignments.length} assignments`);
        const assignment = assignments.data.assignments[0];
        console.log(`First assignment: Grade ${assignment.grade_name}, Class ${assignment.class_name}`);
      }
    }

    console.log('\n📋 SUMMARY:');
    console.log('This debug shows us what specific error is occurring.');
    console.log('If you see server errors, the issue is likely:');
    console.log('1. Database connection problem');
    console.log('2. Missing/incorrect user assignments');
    console.log('3. Data type mismatch in queries');
    console.log('4. Missing foreign key relationships');

  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
}

debugQuizIssue();
