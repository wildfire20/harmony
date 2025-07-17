const https = require('https');

const baseUrl = 'https://web-production-618c0.up.railway.app';

// Test data
const testCredentials = {
  teacher: { email: 'teacher@harmony.edu', password: 'teacher123' },
  admin: { email: 'admin@harmony.edu', password: 'admin123' }
};

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

async function testTeacherAssignments() {
  try {
    console.log('🔐 Testing Teacher Assignments API...\n');

    // 1. Login as teacher
    console.log('1. Logging in as teacher...');
    const teacherLogin = await makeRequest('POST', '/api/auth/login/staff', testCredentials.teacher);
    
    if (teacherLogin.status !== 200) {
      console.log('❌ Teacher login failed:', teacherLogin.data);
      return;
    }
    
    const teacherToken = teacherLogin.data.token;
    const teacherId = teacherLogin.data.user.id;
    console.log('✅ Teacher logged in successfully');
    console.log(`   Teacher ID: ${teacherId}`);

    // 2. Test teacher assignments endpoint
    console.log('\n2. Fetching teacher assignments...');
    const assignments = await makeRequest('GET', `/api/admin/teachers/${teacherId}/assignments`, null, teacherToken);
    
    if (assignments.status !== 200) {
      console.log('❌ Failed to fetch teacher assignments:', assignments.data);
      return;
    }

    console.log('✅ Teacher assignments fetched successfully');
    console.log('   Assignments:', JSON.stringify(assignments.data, null, 2));

    // 3. Test admin endpoints for comparison
    console.log('\n3. Testing admin endpoints...');
    const adminLogin = await makeRequest('POST', '/api/auth/login/staff', testCredentials.admin);
    
    if (adminLogin.status !== 200) {
      console.log('❌ Admin login failed:', adminLogin.data);
      return;
    }
    
    const adminToken = adminLogin.data.token;
    console.log('✅ Admin logged in successfully');

    // Fetch all grades
    const grades = await makeRequest('GET', '/api/admin/grades', null, adminToken);
    console.log('\n   All Grades:', grades.status === 200 ? `Found ${grades.data.grades.length} grades` : 'Failed to fetch');

    // Fetch all classes
    const classes = await makeRequest('GET', '/api/admin/classes', null, adminToken);
    console.log('   All Classes:', classes.status === 200 ? `Found ${classes.data.classes.length} classes` : 'Failed to fetch');

    // 4. Summary
    console.log('\n📊 SUMMARY:');
    if (assignments.data.success && assignments.data.assignments.length > 0) {
      console.log('✅ Teacher has access to assigned grades/classes');
      console.log(`   Total assignments: ${assignments.data.assignments.length}`);
      
      const uniqueGrades = [...new Set(assignments.data.assignments.map(a => a.grade_name))];
      const uniqueClasses = [...new Set(assignments.data.assignments.map(a => a.class_name))];
      
      console.log(`   Grades: ${uniqueGrades.join(', ')}`);
      console.log(`   Classes: ${uniqueClasses.join(', ')}`);
      
      console.log('\n🎯 The grade/class dropdowns should now work for teachers!');
    } else {
      console.log('⚠️  Teacher has no assignments - this might be why dropdowns are empty');
      console.log('   Solution: Admin needs to assign this teacher to grades/classes');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testTeacherAssignments();
