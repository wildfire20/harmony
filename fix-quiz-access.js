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

async function fixQuizAccess() {
  try {
    console.log('🔧 Fixing Quiz Access Issue...\n');

    // Step 1: Login as admin
    console.log('1. Logging in as admin...');
    const adminLogin = await makeRequest('POST', '/api/auth/login/staff', {
      email: 'admin@harmony.edu',
      password: 'admin123'
    });
    
    if (adminLogin.status !== 200) {
      console.log('❌ Admin login failed. Please check admin credentials.');
      return;
    }
    
    const adminToken = adminLogin.data.token;
    console.log('✅ Admin logged in successfully');

    // Step 2: Create student if doesn't exist
    console.log('\n2. Setting up test student...');
    const studentData = {
      student_number: 'QUIZ001',
      first_name: 'Quiz',
      last_name: 'Tester',
      email: 'quiz.tester@harmony.edu',
      password: 'student123',
      grade_id: 1,
      class_id: 1
    };

    const createStudentResult = await makeRequest('POST', '/api/admin/students', studentData, adminToken);
    console.log(`Student setup status: ${createStudentResult.status}`);
    if (createStudentResult.status === 400 && createStudentResult.data.message?.includes('already exists')) {
      console.log('✅ Student already exists - good');
    } else if (createStudentResult.status === 201) {
      console.log('✅ Student created successfully');
    }

    // Step 3: Test student login and data
    console.log('\n3. Testing student login...');
    const studentLogin = await makeRequest('POST', '/api/auth/login/student', {
      student_number: 'QUIZ001',
      password: 'student123'
    });

    if (studentLogin.status === 200) {
      console.log('✅ Student login successful');
      const student = studentLogin.data.user;
      console.log('Student info:', {
        id: student.id,
        grade_id: student.grade_id,
        class_id: student.class_id,
        grade_name: student.grade_name,
        class_name: student.class_name
      });

      // Step 4: Create a quiz in the same grade/class
      console.log('\n4. Creating a test quiz...');
      
      // First login as teacher
      const teacherLogin = await makeRequest('POST', '/api/auth/login/staff', {
        email: 'teacher@harmony.edu', 
        password: 'teacher123'
      });

      if (teacherLogin.status === 200) {
        console.log('✅ Teacher logged in');
        
        const quizData = {
          title: 'Student Access Test Quiz',
          description: 'Testing quiz access for students',
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          grade_id: student.grade_id,
          class_id: student.class_id,
          time_limit: 15,
          attempts_allowed: 2,
          show_results: true,
          randomize_questions: false,
          questions: [
            {
              question: 'What is the capital of France?',
              type: 'multiple_choice',
              options: ['London', 'Berlin', 'Paris', 'Madrid'],
              correct_answer: 'Paris',
              points: 1,
              explanation: 'Paris is the capital and largest city of France.'
            }
          ]
        };

        const createQuizResult = await makeRequest('POST', '/api/quizzes', quizData, teacherLogin.data.token);
        console.log(`Quiz creation status: ${createQuizResult.status}`);
        
        if (createQuizResult.status === 201) {
          console.log('✅ Quiz created successfully');
          const createdQuiz = createQuizResult.data;
          console.log(`Quiz task ID: ${createdQuiz.task.id}`);

          // Step 5: Test student access to the quiz
          console.log('\n5. Testing student access to quiz...');
          
          const studentQuizList = await makeRequest('GET', '/api/quizzes', null, studentLogin.data.token);
          console.log(`Student quiz list status: ${studentQuizList.status}`);
          
          if (studentQuizList.status === 200) {
            const quizzes = studentQuizList.data.quizzes;
            console.log(`✅ Student can see ${quizzes.length} quizzes`);
            
            if (quizzes.length > 0) {
              const testQuiz = quizzes.find(q => q.task_id == createdQuiz.task.id);
              if (testQuiz) {
                console.log(`✅ Found our test quiz: "${testQuiz.title}"`);
                
                // Test quiz details access
                const quizDetails = await makeRequest('GET', `/api/quizzes/${testQuiz.task_id}`, null, studentLogin.data.token);
                console.log(`Quiz details status: ${quizDetails.status}`);
                
                if (quizDetails.status === 200) {
                  console.log('🎉 SUCCESS! Quiz access is working!');
                  console.log('✅ The "Take Quiz" button should now work');
                } else {
                  console.log('❌ Quiz details failed:', quizDetails.data);
                }
              } else {
                console.log('⚠️  Test quiz not visible to student - grade/class mismatch');
              }
            } else {
              console.log('⚠️  No quizzes visible to student');
            }
          } else {
            console.log('❌ Student quiz list failed:', studentQuizList.data);
          }
        } else {
          console.log('❌ Quiz creation failed:', createQuizResult.data);
        }
      } else {
        console.log('❌ Teacher login failed:', teacherLogin.data);
      }
    } else {
      console.log('❌ Student login failed:', studentLogin.data);
    }

    console.log('\n📋 NEXT STEPS:');
    console.log('1. Login to your app with student credentials: QUIZ001 / student123');
    console.log('2. Go to Quizzes section');
    console.log('3. Try clicking "Take Quiz" - it should work now!');
    console.log(`\n🌐 Test at: ${baseUrl}/quizzes`);

  } catch (error) {
    console.error('❌ Error fixing quiz access:', error.message);
  }
}

// Wait for deployment to complete
setTimeout(() => {
  console.log('⏳ Waiting for deployment to complete...\n');
  fixQuizAccess();
}, 30000);
