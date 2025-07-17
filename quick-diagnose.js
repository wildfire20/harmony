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

async function quickDiagnose() {
  console.log('🔍 Quick Quiz Diagnosis...\n');

  // Test the exact scenario: student trying to take a quiz
  try {
    // Login as student
    const studentLogin = await makeRequest('POST', '/api/auth/login/student', {
      student_number: 'S001',
      password: 'student123'
    });
    
    if (studentLogin.status === 200) {
      console.log('✅ Student login successful');
      console.log('Student data:', JSON.stringify({
        id: studentLogin.data.user.id,
        role: studentLogin.data.user.role,
        grade_id: studentLogin.data.user.grade_id,
        class_id: studentLogin.data.user.class_id,
        grade_name: studentLogin.data.user.grade_name,
        class_name: studentLogin.data.user.class_name
      }, null, 2));
      
      // Get quiz list
      const quizzes = await makeRequest('GET', '/api/quizzes', null, studentLogin.data.token);
      console.log(`\nQuiz list status: ${quizzes.status}`);
      
      if (quizzes.status === 200) {
        console.log(`Found ${quizzes.data.quizzes.length} quizzes:`);
        quizzes.data.quizzes.forEach((quiz, i) => {
          console.log(`  ${i+1}. "${quiz.title}" (task_id: ${quiz.task_id}, grade: ${quiz.grade_name}, class: ${quiz.class_name})`);
        });
        
        if (quizzes.data.quizzes.length > 0) {
          const firstQuiz = quizzes.data.quizzes[0];
          console.log(`\nTesting access to quiz: "${firstQuiz.title}"`);
          
          const quizDetails = await makeRequest('GET', `/api/quizzes/${firstQuiz.task_id}`, null, studentLogin.data.token);
          console.log(`Quiz details status: ${quizDetails.status}`);
          console.log('Response:', JSON.stringify(quizDetails.data, null, 2));
        }
      } else {
        console.log('Quiz list error:', quizzes.data);
      }
    } else {
      console.log('❌ Student login failed:', studentLogin.data);
    }
  } catch (error) {
    console.log('Error:', error.message);
  }
}

quickDiagnose();
