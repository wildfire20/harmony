// Quick test to verify quiz system functionality
const axios = require('axios');
const baseURL = 'http://localhost:5000/api';

console.log('🧪 Testing Harmony Quiz System...\n');

// Test login and quiz creation
async function testQuizSystem() {
  try {
    console.log('1️⃣ Testing teacher login...');
    
    // Login as teacher
    const loginResponse = await axios.post(`${baseURL}/auth/login`, {
      email: 'teacher@harmony.edu',
      password: 'teacher123'
    });
    
    if (loginResponse.data.token) {
      console.log('✅ Teacher login successful');
      
      const token = loginResponse.data.token;
      const headers = { 'Authorization': `Bearer ${token}` };
      
      console.log('\n2️⃣ Testing quiz creation...');
      
      // Create a sample quiz
      const quizData = {
        title: 'Sample Mathematics Quiz',
        description: 'Basic arithmetic test',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        grade_id: 1,
        class_id: 1,
        time_limit: 30,
        attempts_allowed: 2,
        questions: [
          {
            question: 'What is 5 + 3?',
            type: 'multiple_choice',
            options: ['6', '7', '8', '9'],
            correct_answer: '8',
            points: 2
          },
          {
            question: 'Is 10 greater than 5?',
            type: 'true_false',
            correct_answer: 'true',
            points: 1
          }
        ]
      };
      
      const createResponse = await axios.post(`${baseURL}/quizzes`, quizData, { headers });
      
      if (createResponse.data.task) {
        console.log('✅ Quiz created successfully');
        console.log(`   Task ID: ${createResponse.data.task.id}`);
        console.log(`   Quiz ID: ${createResponse.data.quiz.id}`);
        console.log(`   Total Points: ${createResponse.data.task.max_points}`);
        
        console.log('\n3️⃣ Testing quiz retrieval...');
        
        // Get all quizzes for teacher
        const quizzesResponse = await axios.get(`${baseURL}/quizzes`, { headers });
        console.log(`✅ Retrieved ${quizzesResponse.data.quizzes.length} quiz(s)`);
        
        console.log('\n🎉 Quiz system is working perfectly!');
        console.log('\n📋 Available test accounts:');
        console.log('👨‍🏫 Teacher: teacher@harmony.edu / teacher123');
        console.log('👨‍🎓 Student: student@harmony.edu / student123');
        console.log('👑 Admin: admin@harmony.edu / admin123');
        
      } else {
        console.log('❌ Quiz creation failed');
      }
      
    } else {
      console.log('❌ Teacher login failed');
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('⚠️  Server is not running. Please start it with: npm start');
    } else {
      console.log('❌ Test failed:', error.response?.data?.message || error.message);
    }
  }
}

testQuizSystem();
