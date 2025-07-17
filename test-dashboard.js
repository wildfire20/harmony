// Frontend Dashboard Test
// This simulates what the React frontend is doing and helps us debug the teacher dashboard

const testTeacherDashboard = async () => {
    console.log('🔍 Testing Teacher Dashboard Frontend Issue');
    console.log('This test simulates what the React app does...\n');
    
    // Simulate the exact API calls the frontend makes
    const baseUrl = 'https://content-compassion-production.up.railway.app/api';
    
    // Step 1: Login as teacher
    console.log('Step 1: Login as teacher...');
    try {
        const loginResponse = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: 'math.teacher@harmony.edu',
                password: 'teacher123'
            })
        });
        
        if (!loginResponse.ok) {
            throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
        }
        
        const loginData = await loginResponse.json();
        console.log('✅ Login successful');
        console.log(`Teacher ID: ${loginData.user.id}`);
        console.log(`User Type: ${loginData.user.user_type}`);
        
        const token = loginData.token;
        
        // Step 2: Get teacher's tasks
        console.log('\nStep 2: Get teacher tasks...');
        const tasksResponse = await fetch(`${baseUrl}/tasks`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!tasksResponse.ok) {
            throw new Error(`Tasks fetch failed: ${tasksResponse.status} ${tasksResponse.statusText}`);
        }
        
        const tasksData = await tasksResponse.json();
        console.log('✅ Tasks fetched successfully');
        console.log(`Number of tasks: ${tasksData.tasks?.length || 0}`);
        
        if (tasksData.tasks && tasksData.tasks.length > 0) {
            const firstTask = tasksData.tasks[0];
            console.log(`First task: ${firstTask.id} - ${firstTask.title}`);
            
            // Step 3: Test the students endpoint for this task (this is what's failing in the frontend)
            console.log(`\nStep 3: Test students endpoint for task ${firstTask.id}...`);
            const studentsResponse = await fetch(`${baseUrl}/tasks/${firstTask.id}/students`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            console.log(`Students API Status: ${studentsResponse.status} ${studentsResponse.statusText}`);
            
            if (!studentsResponse.ok) {
                const errorText = await studentsResponse.text();
                console.log('❌ Students API Error Response:', errorText);
                
                // Try the force endpoint as fallback
                console.log('\nTrying force endpoint as fallback...');
                const forceResponse = await fetch(`${baseUrl}/submissions/${firstTask.id}/students/force`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                console.log(`Force API Status: ${forceResponse.status} ${forceResponse.statusText}`);
                if (forceResponse.ok) {
                    const forceData = await forceResponse.json();
                    console.log('✅ Force endpoint worked');
                    console.log('Force response structure:', Object.keys(forceData));
                    console.log('Force response:', JSON.stringify(forceData, null, 2));
                }
            } else {
                const studentsData = await studentsResponse.json();
                console.log('✅ Students API worked');
                console.log('Students response structure:', Object.keys(studentsData));
                console.log('Full students response:', JSON.stringify(studentsData, null, 2));
                
                // Analyze the response structure
                if (studentsData.success && studentsData.data && studentsData.data.students) {
                    console.log(`\n📊 Analysis:`);
                    console.log(`- Success: ${studentsData.success}`);
                    console.log(`- Students count: ${studentsData.data.students.length}`);
                    console.log(`- Response has 'success' flag: ✅`);
                    console.log(`- Response has 'data' object: ✅`);
                    console.log(`- Data has 'students' array: ✅`);
                    
                    if (studentsData.data.students.length > 0) {
                        console.log(`- First student:`, studentsData.data.students[0]);
                    } else {
                        console.log(`- No students found for this task`);
                    }
                    
                    // Check if there are any students with submissions
                    const studentsWithSubmissions = studentsData.data.students.filter(s => s.submission_id);
                    console.log(`- Students with submissions: ${studentsWithSubmissions.length}`);
                    
                } else {
                    console.log('❌ Unexpected response structure');
                    console.log('Expected: { success: true, data: { students: [...] } }');
                    console.log('Got:', JSON.stringify(studentsData, null, 2));
                }
            }
            
            // Step 4: Test submissions endpoint
            console.log(`\nStep 4: Test submissions endpoint for task ${firstTask.id}...`);
            const submissionsResponse = await fetch(`${baseUrl}/tasks/${firstTask.id}/submissions`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            console.log(`Submissions API Status: ${submissionsResponse.status} ${submissionsResponse.statusText}`);
            
            if (submissionsResponse.ok) {
                const submissionsData = await submissionsResponse.json();
                console.log('✅ Submissions API worked');
                console.log('Submissions response structure:', Object.keys(submissionsData));
                console.log(`Number of submissions: ${submissionsData.submissions?.length || 0}`);
            } else {
                const errorText = await submissionsResponse.text();
                console.log('❌ Submissions API Error:', errorText);
            }
            
        } else {
            console.log('⚠️ No tasks found for this teacher');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
};

// Check if we're in Node.js or browser environment
if (typeof window === 'undefined') {
    // Node.js environment
    const fetch = require('node-fetch');
    testTeacherDashboard();
} else {
    // Browser environment
    console.log('This script is designed to run in Node.js');
}
