// Use axios instead of node-fetch for better compatibility
const axios = require('axios');

const API_BASE = 'https://harmony-learning-institute-production.up.railway.app/api';

async function testStudentDocumentAccess() {
  try {
    console.log('=== TESTING STUDENT DOCUMENT ACCESS ===');
    
    // Step 1: Login as student (Broe Plussies)
    console.log('1. Attempting student login...');
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      identifier: 'broe.plussies@student.hli.com',
      password: 'password123',
      userType: 'student'
    });
    
    console.log('✅ Login successful');
    console.log('User data:', loginResponse.data.user);
    
    const token = loginResponse.data.token;
    const user = loginResponse.data.user;
    
    // Step 2: Verify token
    console.log('\n2. Verifying token...');
    const verifyResponse = await axios.get(`${API_BASE}/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ Token verification successful');
    console.log('Verified user data:', verifyResponse.data.user);
    
    // Step 3: Test document access
    console.log('\n3. Testing document access...');
    console.log('User grade_id:', user.grade_id);
    console.log('User class_id:', user.class_id);
    
    if (!user.grade_id || !user.class_id) {
      console.error('❌ User missing grade_id or class_id!');
      return;
    }
    
    const documentsUrl = `${API_BASE}/documents/grade/${user.grade_id}/class/${user.class_id}`;
    console.log('Fetching from URL:', documentsUrl);
    
    try {
      const documentsResponse = await axios.get(documentsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log('✅ Documents fetch successful');
      console.log('Documents found:', documentsResponse.data.documents?.length || 0);
      console.log('Documents data:', documentsResponse.data);
    } catch (docError) {
      console.error('❌ Documents fetch failed:', docError.response?.status, docError.response?.data);
    }
    
    // Step 4: Test admin create document endpoint
    console.log('\n4. Testing admin login for document creation...');
    const adminLoginResponse = await axios.post(`${API_BASE}/auth/login`, {
      identifier: 'admin@hli.com',
      password: 'admin123',
      userType: 'admin'
    });
    
    const adminToken = adminLoginResponse.data.token;
    console.log('✅ Admin login successful');
    
    // Create test document for the student's grade/class
    console.log('\n5. Creating test document...');
    try {
      const createDocResponse = await axios.post(`${API_BASE}/documents/create-test-document`, {}, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      console.log('✅ Test document created:', createDocResponse.data);
      
      // Step 6: Re-test student document access
      console.log('\n6. Re-testing student document access after creation...');
      try {
        const documentsResponse2 = await axios.get(documentsUrl, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log('✅ Documents fetch successful after creation');
        console.log('Documents found:', documentsResponse2.data.documents?.length || 0);
        console.log('Documents:', documentsResponse2.data.documents);
      } catch (docError2) {
        console.error('❌ Documents fetch failed again:', docError2.response?.status, docError2.response?.data);
      }
    } catch (createError) {
      console.error('❌ Create test document failed:', createError.response?.status, createError.response?.data);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
  }
}

testStudentDocumentAccess();
