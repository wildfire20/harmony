// COMPREHENSIVE TASK DETAILS DEBUGGING SCRIPT
// Copy and paste this into your browser console when the task details page is blank

console.log('🔍 Starting TaskDetails Debug Analysis...');

// 1. Check Current URL and Task ID
const currentUrl = window.location.href;
const taskIdMatch = currentUrl.match(/\/tasks\/(\d+)/);
const taskId = taskIdMatch ? taskIdMatch[1] : null;

console.log('📍 URL Analysis:', {
  currentUrl,
  taskId,
  hasTaskId: !!taskId
});

// 2. Check Authentication
const token = localStorage.getItem('token');
console.log('🔐 Authentication Check:', {
  hasToken: !!token,
  tokenLength: token ? token.length : 0
});

if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    console.log('👤 User Info:', {
      userId: payload.userId,
      role: payload.role,
      exp: new Date(payload.exp * 1000),
      isExpired: payload.exp * 1000 < Date.now()
    });
  } catch (e) {
    console.error('❌ Token decode error:', e);
  }
}

// 3. Check if React is loaded
console.log('⚛️ React Status:', {
  reactExists: typeof React !== 'undefined',
  reactDOMExists: typeof ReactDOM !== 'undefined'
});

// 4. Check for JavaScript errors
let errorCount = 0;
const originalError = console.error;
console.error = function(...args) {
  errorCount++;
  originalError.apply(console, ['🚨 JS ERROR:'].concat(args));
};

// 5. Test API directly
if (taskId) {
  console.log('🌐 Testing API endpoint...');
  
  fetch(`/api/tasks/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  .then(response => {
    console.log('📊 API Response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });
    
    if (!response.ok) {
      return response.text().then(text => {
        console.error('❌ API Error Response:', text);
        throw new Error(`API Error: ${response.status} - ${text}`);
      });
    }
    
    return response.json();
  })
  .then(data => {
    console.log('✅ API Success Response:', data);
    console.log('🔍 Data Structure Analysis:', {
      hasData: !!data,
      hasDataProperty: !!data.data,
      hasTaskProperty: !!data.data?.task,
      dataKeys: data ? Object.keys(data) : [],
      taskKeys: data.data?.task ? Object.keys(data.data.task) : []
    });
    
    // Check if task data looks correct
    const task = data.data?.task;
    if (task) {
      console.log('📋 Task Details:', {
        id: task.id,
        title: task.title,
        type: task.task_type,
        dueDate: task.due_date,
        createdBy: task.created_by,
        hasTeacher: !!(task.teacher_first_name && task.teacher_last_name)
      });
    }
  })
  .catch(error => {
    console.error('🚨 API Request Failed:', error);
  });
}

// 6. Check DOM state
setTimeout(() => {
  console.log('🏗️ DOM Analysis:', {
    bodyChildren: document.body.children.length,
    hasReactRoot: !!document.getElementById('root'),
    rootContent: document.getElementById('root')?.innerHTML.length || 0,
    errorElements: document.querySelectorAll('[class*="error"]').length,
    loadingElements: document.querySelectorAll('[class*="loading"]').length
  });
  
  // Look for specific content
  const commonTexts = ['Task not found', 'Loading', 'Failed to load', 'Error'];
  const foundTexts = commonTexts.filter(text => 
    document.body.textContent.includes(text)
  );
  
  if (foundTexts.length > 0) {
    console.log('📝 Found Error/Status Text:', foundTexts);
  }
  
  console.log('📊 Debug Summary:', {
    taskId,
    hasToken: !!token,
    domContentLength: document.body.textContent.length,
    errorCount,
    timeStamp: new Date().toISOString()
  });
}, 2000);

console.log('✅ Debug script loaded. Check console for results...');
