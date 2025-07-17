// Test Announcements API endpoints

const testAnnouncementsAPI = async () => {
  console.log('=== Testing Announcements API ===');
  
  // Get the auth token
  const token = localStorage.getItem('token');
  if (!token) {
    console.error('No auth token found. Please login first.');
    return;
  }

  const baseURL = process.env.NODE_ENV === 'production' 
    ? '/api' 
    : 'http://localhost:5000/api';

  try {
    // Test 1: Get grades
    console.log('1. Testing get grades...');
    const gradesResponse = await fetch(`${baseURL}/classes/grades`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const gradesData = await gradesResponse.json();
    console.log('Grades response:', gradesData);

    if (!gradesData.success || !gradesData.data?.grades?.length) {
      console.error('No grades found or error in grades response');
      return;
    }

    const firstGrade = gradesData.data.grades[0];
    
    // Test 2: Get classes for first grade
    console.log(`2. Testing get classes for grade ${firstGrade.id}...`);
    const classesResponse = await fetch(`${baseURL}/classes/grades/${firstGrade.id}/classes`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const classesData = await classesResponse.json();
    console.log('Classes response:', classesData);

    if (!classesData.success || !classesData.data?.classes?.length) {
      console.error('No classes found or error in classes response');
      return;
    }

    const firstClass = classesData.data.classes[0];

    // Test 3: Create announcement
    console.log(`3. Testing create announcement for grade ${firstGrade.id}, class ${firstClass.id}...`);
    const createData = {
      title: 'Test Announcement',
      content: 'This is a test announcement created via API test',
      priority: 'normal',
      grade_id: firstGrade.id,
      class_id: firstClass.id
    };

    const createResponse = await fetch(`${baseURL}/announcements`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createData)
    });

    const createResult = await createResponse.json();
    console.log('Create announcement response:', createResult);

    if (createResult.success) {
      console.log('✅ Announcement created successfully!');
      
      // Test 4: Get announcements
      console.log(`4. Testing get announcements for grade ${firstGrade.id}, class ${firstClass.id}...`);
      const getResponse = await fetch(`${baseURL}/announcements/grade/${firstGrade.id}/class/${firstClass.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const getResult = await getResponse.json();
      console.log('Get announcements response:', getResult);
      
      if (getResult.success) {
        console.log('✅ Announcements retrieved successfully!');
      } else {
        console.error('❌ Failed to get announcements:', getResult.message);
      }
    } else {
      console.error('❌ Failed to create announcement:', createResult.message);
      console.error('Errors:', createResult.errors);
    }

  } catch (error) {
    console.error('Test failed with error:', error);
  }
};

// Run the test
testAnnouncementsAPI();
