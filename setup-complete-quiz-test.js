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

async function setupCompleteQuizTest() {
  try {
    console.log('🔧 Complete Quiz Setup and Test...\n');

    // 1. Login as admin
    console.log('1. Logging in as admin...');
    const adminLogin = await makeRequest('POST', '/api/auth/login/staff', {
      email: 'admin@harmony.edu',
      password: 'admin123'
    });
    
    if (adminLogin.status !== 200) {
      console.log('❌ Admin login failed:', adminLogin.data);
      return;
    }
    
    const adminToken = adminLogin.data.token;
    console.log('✅ Admin logged in successfully');

    // 2. Ensure we have grades and classes
    console.log('\n2. Checking grades and classes...');
    const grades = await makeRequest('GET', '/api/admin/grades', null, adminToken);
    const classes = await makeRequest('GET', '/api/admin/classes', null, adminToken);

    let gradeId = 1, classId = 1;
    
    if (grades.status === 200 && grades.data.grades.length > 0) {
      gradeId = grades.data.grades[0].id;
      console.log(`✅ Found grade: ${grades.data.grades[0].name} (ID: ${gradeId})`);
    } else {
      console.log('⚠️  No grades found, using default ID 1');
    }

    if (classes.status === 200 && classes.data.classes.length > 0) {
      classId = classes.data.classes[0].id;
      console.log(`✅ Found class: ${classes.data.classes[0].name} (ID: ${classId})`);
    } else {
      console.log('⚠️  No classes found, using default ID 1');
    }

    // 3. Create or update a test student
    console.log('\n3. Creating/updating test student...');
    const studentData = {
      student_number: 'TEST001',
      first_name: 'Test',
      last_name: 'Student',
      email: 'test.student@harmony.edu',
      password: 'student123',
      grade_id: gradeId,
      class_id: classId
    };

    const createStudent = await makeRequest('POST', '/api/admin/students', studentData, adminToken);
    console.log(`Student creation/update status: ${createStudent.status}`);

    // 4. Create a test teacher and assign to grade/class
    console.log('\n4. Setting up test teacher...');
    const teacherData = {
      first_name: 'Test',
      last_name: 'Teacher',
      email: 'test.teacher@harmony.edu',
      password: 'teacher123',
      assignments: [{ grade_id: gradeId, class_id: classId }]
    };

    const createTeacher = await makeRequest('POST', '/api/admin/teachers', teacherData, adminToken);
    console.log(`Teacher creation/update status: ${createTeacher.status}`);

    // 5. Login as teacher and create a quiz
    console.log('\n5. Creating a test quiz as teacher...');
    const teacherLogin = await makeRequest('POST', '/api/auth/login/staff', {
      email: 'test.teacher@harmony.edu',
      password: 'teacher123'
    });

    if (teacherLogin.status === 200) {
      console.log('✅ Teacher logged in');
      
      const quizData = {
        title: 'Test Quiz for Student Access',
        description: 'A simple test quiz to verify student access',
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        grade_id: gradeId,
        class_id: classId,
        time_limit: 30,
        attempts_allowed: 3,
        show_results: true,
        randomize_questions: false,
        questions: [
          {
            question: 'What is 2 + 2?',
            type: 'multiple_choice',
            options: ['3', '4', '5', '6'],
            correct_answer: '4',
            points: 1,
            explanation: 'Basic addition'
          },
          {
            question: 'Is the sky blue?',
            type: 'true_false',
            correct_answer: 'true',
            points: 1,
            explanation: 'Generally yes, on clear days'
          }
        ]
      };

      const createQuiz = await makeRequest('POST', '/api/quizzes', quizData, teacherLogin.data.token);
      console.log(`Quiz creation status: ${createQuiz.status}`);
      
      if (createQuiz.status === 201) {
        console.log('✅ Quiz created successfully');
        console.log(`   Quiz ID: ${createQuiz.data.task.id}`);
        console.log(`   Title: ${createQuiz.data.task.title}`);
      } else {
        console.log('❌ Quiz creation failed:', createQuiz.data);
      }
    }

    // 6. Test student access
    console.log('\n6. Testing student access to quiz...');
    const studentLogin = await makeRequest('POST', '/api/auth/login/student', {
      student_number: 'TEST001',
      password: 'student123'
    });

    if (studentLogin.status === 200) {
      console.log('✅ Student logged in successfully');
      
      // Get available quizzes
      const studentQuizzes = await makeRequest('GET', '/api/quizzes', null, studentLogin.data.token);
      console.log(`Student quiz list status: ${studentQuizzes.status}`);
      
      if (studentQuizzes.status === 200) {
        const quizzes = studentQuizzes.data.quizzes;
        console.log(`✅ Student can see ${quizzes.length} quizzes`);
        
        if (quizzes.length > 0) {
          const testQuiz = quizzes[0];
          console.log(`   Testing quiz: "${testQuiz.title}"`);
          
          // Try to access quiz details
          const quizDetails = await makeRequest('GET', `/api/quizzes/${testQuiz.task_id}`, null, studentLogin.data.token);
          console.log(`   Quiz details status: ${quizDetails.status}`);
          
          if (quizDetails.status === 200) {
            console.log('✅ SUCCESS! Student can access quiz details');
            console.log('   🎯 The "Take Quiz" button should now work!');
          } else {
            console.log('❌ Quiz details failed:', quizDetails.data);
          }
        }
      } else {
        console.log('❌ Student quiz list failed:', studentQuizzes.data);
      }
    } else {
      console.log('❌ Student login failed:', studentLogin.data);
    }

    console.log('\n📊 SETUP COMPLETE');
    console.log('🌐 Test at: https://web-production-618c0.up.railway.app/quizzes');
    console.log('👨‍🎓 Student login: TEST001 / student123');
    console.log('👨‍🏫 Teacher login: test.teacher@harmony.edu / teacher123');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

setupCompleteQuizTest();
