// Test the document types endpoint
const testDocumentTypes = async () => {
  try {
    const response = await fetch('/api/documents/types', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Document types response:', data);
    } else {
      console.error('Failed to fetch document types:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error testing document types:', error);
  }
};

// Test the grades endpoint
const testGrades = async () => {
  try {
    const response = await fetch('/api/admin/grades', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Grades response:', data);
    } else {
      console.error('Failed to fetch grades:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error testing grades:', error);
  }
};

// Test the classes endpoint
const testClasses = async () => {
  try {
    const response = await fetch('/api/admin/classes', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Classes response:', data);
    } else {
      console.error('Failed to fetch classes:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error testing classes:', error);
  }
};

// Run all tests
console.log('Testing API endpoints...');
testDocumentTypes();
testGrades();
testClasses();
