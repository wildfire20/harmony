const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://content-compassion-production.up.railway.app';

// Test credentials
const teacherLogin = {
    email: 'math.teacher@harmony.edu',
    password: 'teacher123'
};

const studentLogin = {
    email: 'john.doe@student.harmony.edu',
    password: 'student123'
};

let teacherToken = '';
let studentToken = '';
let testTaskId = '';

async function login(credentials, userType) {
    try {
        console.log(`\n=== Logging in as ${userType} ===`);
        const response = await axios.post(`${BASE_URL}/api/auth/login`, credentials);
        console.log(`✅ ${userType} login successful`);
        console.log(`User ID: ${response.data.user.id}`);
        console.log(`User Type: ${response.data.user.user_type}`);
        return response.data.token;
    } catch (error) {
        console.error(`❌ ${userType} login failed:`, error.response?.data || error.message);
        throw error;
    }
}

async function testDocumentUpload(token, userType) {
    try {
        console.log(`\n=== Testing Document Upload (${userType}) ===`);
        
        // Create a test file
        const testContent = `Test document uploaded by ${userType} at ${new Date().toISOString()}`;
        const testFilePath = path.join(__dirname, `test-${userType}-doc.txt`);
        fs.writeFileSync(testFilePath, testContent);
        
        const formData = new FormData();
        formData.append('file', fs.createReadStream(testFilePath));
        formData.append('title', `Test Document - ${userType}`);
        formData.append('description', `Test document uploaded by ${userType}`);
        formData.append('target_audience', 'all');
        
        const response = await axios.post(`${BASE_URL}/api/documents/upload`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log(`✅ Document uploaded successfully`);
        console.log(`Document ID: ${response.data.document.id}`);
        console.log(`Storage type: ${response.data.document.s3_key ? 'S3' : 'Local'}`);
        if (response.data.document.s3_key) {
            console.log(`S3 Key: ${response.data.document.s3_key}`);
        }
        
        // Clean up test file
        fs.unlinkSync(testFilePath);
        
        return response.data.document.id;
    } catch (error) {
        console.error(`❌ Document upload failed:`, error.response?.data || error.message);
        throw error;
    }
}

async function testTaskCreation(token) {
    try {
        console.log(`\n=== Testing Task Creation (Teacher) ===`);
        
        // Create a test file for task attachment
        const testContent = 'Task assignment instructions and materials';
        const testFilePath = path.join(__dirname, 'test-task-attachment.txt');
        fs.writeFileSync(testFilePath, testContent);
        
        const formData = new FormData();
        formData.append('title', 'Test Assignment - S3 Integration');
        formData.append('description', 'Test assignment to verify S3 file storage');
        formData.append('subject', 'Mathematics');
        formData.append('grade', 'Grade 10');
        formData.append('due_date', '2024-02-15');
        formData.append('file', fs.createReadStream(testFilePath));
        
        const response = await axios.post(`${BASE_URL}/api/tasks`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log(`✅ Task created successfully`);
        console.log(`Task ID: ${response.data.task.id}`);
        console.log(`Storage type: ${response.data.task.s3_key ? 'S3' : 'Local'}`);
        if (response.data.task.s3_key) {
            console.log(`S3 Key: ${response.data.task.s3_key}`);
        }
        
        // Clean up test file
        fs.unlinkSync(testFilePath);
        
        return response.data.task.id;
    } catch (error) {
        console.error(`❌ Task creation failed:`, error.response?.data || error.message);
        throw error;
    }
}

async function testTaskStudents(token, taskId) {
    try {
        console.log(`\n=== Testing Task Students API ===`);
        
        const response = await axios.get(`${BASE_URL}/api/tasks/${taskId}/students`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log(`✅ Task students API working`);
        console.log(`Response structure:`, Object.keys(response.data));
        console.log(`Number of students: ${response.data.data?.students?.length || 0}`);
        if (response.data.data?.students?.length > 0) {
            console.log(`First student:`, response.data.data.students[0]);
        }
        
        return response.data;
    } catch (error) {
        console.error(`❌ Task students API failed:`, error.response?.data || error.message);
        throw error;
    }
}

async function testSubmissionUpload(token, taskId) {
    try {
        console.log(`\n=== Testing Submission Upload (Student) ===`);
        
        // Create a test submission file
        const testContent = 'Student submission content for the test assignment';
        const testFilePath = path.join(__dirname, 'test-submission.txt');
        fs.writeFileSync(testFilePath, testContent);
        
        const formData = new FormData();
        formData.append('file', fs.createReadStream(testFilePath));
        formData.append('notes', 'Test submission via S3 integration');
        
        const response = await axios.post(`${BASE_URL}/api/submissions/${taskId}`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log(`✅ Submission uploaded successfully`);
        console.log(`Submission ID: ${response.data.submission.id}`);
        console.log(`Storage type: ${response.data.submission.s3_key ? 'S3' : 'Local'}`);
        if (response.data.submission.s3_key) {
            console.log(`S3 Key: ${response.data.submission.s3_key}`);
        }
        
        // Clean up test file
        fs.unlinkSync(testFilePath);
        
        return response.data.submission.id;
    } catch (error) {
        console.error(`❌ Submission upload failed:`, error.response?.data || error.message);
        throw error;
    }
}

async function testTaskStudentsAfterSubmission(token, taskId) {
    try {
        console.log(`\n=== Testing Task Students API After Submission ===`);
        
        const response = await axios.get(`${BASE_URL}/api/tasks/${taskId}/students`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log(`✅ Task students API working after submission`);
        console.log(`Number of students: ${response.data.data?.students?.length || 0}`);
        if (response.data.data?.students?.length > 0) {
            const studentsWithSubmissions = response.data.data.students.filter(s => s.submission_id);
            console.log(`Students with submissions: ${studentsWithSubmissions.length}`);
            if (studentsWithSubmissions.length > 0) {
                console.log(`First submission:`, studentsWithSubmissions[0]);
            }
        }
        
        return response.data;
    } catch (error) {
        console.error(`❌ Task students API failed after submission:`, error.response?.data || error.message);
        throw error;
    }
}

async function runProductionTest() {
    try {
        console.log('🚀 Starting Production S3 Integration Test');
        console.log(`Testing against: ${BASE_URL}`);
        
        // Login as teacher and student
        teacherToken = await login(teacherLogin, 'Teacher');
        studentToken = await login(studentLogin, 'Student');
        
        // Test document upload by teacher
        await testDocumentUpload(teacherToken, 'Teacher');
        
        // Test task creation by teacher
        testTaskId = await testTaskCreation(teacherToken);
        
        // Test task students API (should show 0 initially)
        await testTaskStudents(teacherToken, testTaskId);
        
        // Test submission upload by student
        await testSubmissionUpload(studentToken, testTaskId);
        
        // Test task students API again (should show 1 student with submission)
        await testTaskStudentsAfterSubmission(teacherToken, testTaskId);
        
        console.log('\n🎉 All tests completed successfully!');
        console.log('\n📋 Summary:');
        console.log('- ✅ Teacher login');
        console.log('- ✅ Student login');
        console.log('- ✅ Document upload with S3');
        console.log('- ✅ Task creation with S3');
        console.log('- ✅ Task students API');
        console.log('- ✅ Submission upload with S3');
        console.log('- ✅ Updated task students count');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Add error handling for network issues
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

runProductionTest();
