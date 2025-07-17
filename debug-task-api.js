// Quick API test for debugging task loading issue
const testTaskAPI = async () => {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/tasks/69', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('📊 API Response Status:', response.status);
    console.log('📊 API Response Headers:', [...response.headers.entries()]);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      return;
    }
    
    const data = await response.json();
    console.log('✅ API Success Response:', JSON.stringify(data, null, 2));
    
    // Check data structure
    console.log('🔍 Data Analysis:', {
      hasData: !!data,
      hasDataProperty: !!data.data,
      hasTaskProperty: !!data.data?.task,
      taskKeys: data.data?.task ? Object.keys(data.data.task) : 'No task property'
    });
    
  } catch (error) {
    console.error('🚨 Network Error:', error);
  }
};

// Run the test
testTaskAPI();
