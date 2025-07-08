// Quick diagnostic test for student document access
// Run this in browser console when logged in as student

console.log('=== STUDENT DIAGNOSTIC TEST ===');

// Check if user data exists
const userStr = localStorage.getItem('user');
const tokenStr = localStorage.getItem('token');

console.log('User data from localStorage:', userStr);
console.log('Token from localStorage:', tokenStr);

if (userStr) {
  const user = JSON.parse(userStr);
  console.log('Parsed user:', user);
  console.log('User role:', user.role);
  console.log('User grade_id:', user.grade_id);
  console.log('User class_id:', user.class_id);
  
  // Test document endpoint
  if (user.role === 'student') {
    let url = '/api/documents/all';
    
    if (user.grade_id) {
      if (user.class_id) {
        url = `/api/documents/grade/${user.grade_id}/class/${user.class_id}`;
      } else {
        url = `/api/documents/grade/${user.grade_id}`;
      }
    }
    
    console.log('Test URL:', url);
    
    // Test the fetch
    fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokenStr}`
      }
    })
    .then(response => {
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
      return response.text();
    })
    .then(data => {
      console.log('Response data:', data);
    })
    .catch(error => {
      console.error('Fetch error:', error);
    });
  }
}

console.log('=== END DIAGNOSTIC TEST ===');
