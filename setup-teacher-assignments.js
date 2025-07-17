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

async function setupTeacherAndTest() {
  try {
    console.log('🔧 Setting up teacher assignments and testing dropdowns...\n');

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

    // 2. Create a test teacher if it doesn't exist
    console.log('\n2. Creating/checking test teacher...');
    const createTeacher = await makeRequest('POST', '/api/admin/teachers', {
      first_name: 'Test',
      last_name: 'Teacher',
      email: 'teacher@harmony.edu',
      password: 'teacher123',
      assignments: [
        { grade_id: 1, class_id: 1 },
        { grade_id: 2, class_id: 2 }
      ]
    }, adminToken);

    if (createTeacher.status === 201) {
      console.log('✅ Test teacher created successfully');
    } else if (createTeacher.status === 400 && createTeacher.data.message?.includes('already exists')) {
      console.log('✅ Test teacher already exists');
    } else {
      console.log('⚠️  Teacher creation result:', createTeacher.status, createTeacher.data);
    }

    // 3. Get all grades and classes
    console.log('\n3. Fetching available grades and classes...');
    const grades = await makeRequest('GET', '/api/admin/grades', null, adminToken);
    const classes = await makeRequest('GET', '/api/admin/classes', null, adminToken);

    if (grades.status === 200 && classes.status === 200) {
      console.log('✅ Grades and classes fetched');
      console.log(`   Grades: ${grades.data.grades.length} found`);
      console.log(`   Classes: ${classes.data.classes.length} found`);
      
      // List available grades and classes
      if (grades.data.grades.length > 0) {
        console.log('   Available grades:');
        grades.data.grades.forEach(g => console.log(`     - ID: ${g.id}, Name: ${g.name}`));
      }
      
      if (classes.data.classes.length > 0) {
        console.log('   Available classes:');
        classes.data.classes.forEach(c => console.log(`     - ID: ${c.id}, Name: ${c.name}, Grade: ${c.grade_name}`));
      }
    }

    // 4. Assign teacher to grades/classes if grades and classes exist
    if (grades.data.grades.length > 0 && classes.data.classes.length > 0) {
      console.log('\n4. Assigning teacher to grades/classes...');
      
      // Get teacher ID first
      const teachers = await makeRequest('GET', '/api/admin/teachers', null, adminToken);
      const testTeacher = teachers.data.teachers?.find(t => t.email === 'teacher@harmony.edu');
      
      if (testTeacher) {
        console.log(`   Found teacher ID: ${testTeacher.id}`);
        
        // Assign to first available grade/class
        const firstGrade = grades.data.grades[0];
        const firstClass = classes.data.classes.find(c => c.grade_id == firstGrade.id) || classes.data.classes[0];
        
        const assignmentData = {
          assignments: [
            { grade_id: firstGrade.id, class_id: firstClass.id }
          ]
        };
        
        const assignResult = await makeRequest('PUT', `/api/admin/teachers/${testTeacher.id}`, assignmentData, adminToken);
        console.log('   Assignment result:', assignResult.status, assignResult.data.message || 'Success');
      }
    }

    // 5. Test teacher login and assignments
    console.log('\n5. Testing teacher login and assignments...');
    const teacherLogin = await makeRequest('POST', '/api/auth/login/staff', {
      email: 'teacher@harmony.edu',
      password: 'teacher123'
    });
    
    if (teacherLogin.status !== 200) {
      console.log('❌ Teacher login failed:', teacherLogin.data);
      return;
    }
    
    const teacherToken = teacherLogin.data.token;
    const teacherId = teacherLogin.data.user.id;
    console.log('✅ Teacher logged in successfully');

    // 6. Test assignments endpoint
    const assignments = await makeRequest('GET', `/api/admin/teachers/${teacherId}/assignments`, null, teacherToken);
    
    if (assignments.status === 200) {
      console.log('✅ Teacher assignments fetched successfully');
      console.log('   Assignments:', JSON.stringify(assignments.data, null, 2));
    } else {
      console.log('❌ Failed to fetch assignments:', assignments.data);
    }

    // 7. Summary
    console.log('\n📊 FINAL SUMMARY:');
    console.log('✅ Teacher account exists and can log in');
    
    if (assignments.data.success && assignments.data.assignments.length > 0) {
      console.log('✅ Teacher has assignments - dropdowns should work!');
      console.log(`   Teacher can create quizzes for ${assignments.data.assignments.length} grade/class combinations`);
    } else {
      console.log('⚠️  Teacher has no assignments - you need to assign them through admin panel');
    }
    
    console.log('\n🎯 Try creating a quiz now - the Grade and Class dropdowns should be populated!');
    console.log(`🌐 Visit: ${baseUrl}/quizzes`);
    console.log('📧 Login as: teacher@harmony.edu / teacher123');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

setupTeacherAndTest();
