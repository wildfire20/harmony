const axios = require('axios');

// Configuration - Update with your Railway URL
const BASE_URL = process.env.RAILWAY_URL || 'https://web-production-618c0.up.railway.app';
const API_URL = `${BASE_URL}/api`;

// Test credentials
const STUDENT_CREDENTIALS = {
  email: 'SUT123',
  password: 'SUT123'
};

const TEACHER_CREDENTIALS = {
  email: 'ove@harmonylearning.edu',
  password: 'Ove1234'
};

async function testQuizFunctionality() {
  console.log('🧪 COMPREHENSIVE QUIZ FUNCTIONALITY TEST');
  console.log('========================================');
  console.log('Testing against:', BASE_URL);
  
  let studentToken = null;
  let teacherToken = null;
  let testQuizId = null;

  try {
    // 1. Test student login
    console.log('\n1. Testing student login...');
    try {
      const studentLoginResponse = await axios.post(`${API_URL}/auth/login`, STUDENT_CREDENTIALS);
      studentToken = studentLoginResponse.data.token;
      console.log('✅ Student login successful');
      console.log('Student user:', JSON.stringify(studentLoginResponse.data.user, null, 2));
    } catch (loginError) {
      console.error('❌ Student login failed:', {
        status: loginError.response?.status,
        message: loginError.response?.data?.message || loginError.message,
        data: loginError.response?.data
      });
    }

    // 2. Test teacher login
    console.log('\n2. Testing teacher login...');
    try {
      const teacherLoginResponse = await axios.post(`${API_URL}/auth/login`, TEACHER_CREDENTIALS);
      teacherToken = teacherLoginResponse.data.token;
      console.log('✅ Teacher login successful');
      console.log('Teacher user:', JSON.stringify(teacherLoginResponse.data.user, null, 2));
    } catch (loginError) {
      console.error('❌ Teacher login failed:', {
        status: loginError.response?.status,
        message: loginError.response?.data?.message || loginError.message,
        data: loginError.response?.data
      });
    }

    // 3. Get available quizzes for student
    if (studentToken) {
      console.log('\n3. Getting available quizzes for student...');
      try {
        const quizzesResponse = await axios.get(`${API_URL}/quizzes`, {
          headers: { Authorization: `Bearer ${studentToken}` }
        });
        console.log('✅ Quizzes retrieved successfully');
        console.log(`Found ${quizzesResponse.data.quizzes.length} quizzes`);
        
        if (quizzesResponse.data.quizzes.length > 0) {
          testQuizId = quizzesResponse.data.quizzes[0].task_id;
          console.log('📝 Using quiz ID for testing:', testQuizId);
          console.log('Quiz details:', JSON.stringify(quizzesResponse.data.quizzes[0], null, 2));
        }
      } catch (quizzesError) {
        console.error('❌ Get quizzes failed:', {
          status: quizzesError.response?.status,
          message: quizzesError.response?.data?.message || quizzesError.message,
          data: quizzesError.response?.data
        });
      }
    }

    // 4. Get specific quiz details
    if (studentToken && testQuizId) {
      console.log('\n4. Getting quiz details...');
      try {
        const quizDetailsResponse = await axios.get(`${API_URL}/quizzes/${testQuizId}`, {
          headers: { Authorization: `Bearer ${studentToken}` }
        });
        console.log('✅ Quiz details retrieved successfully');
        console.log('Quiz structure:', JSON.stringify({
          id: quizDetailsResponse.data.quiz.id,
          title: quizDetailsResponse.data.quiz.title,
          questionsCount: quizDetailsResponse.data.quiz.questions?.length || 0,
          timeLimit: quizDetailsResponse.data.quiz.time_limit,
          attemptsAllowed: quizDetailsResponse.data.quiz.attempts_allowed
        }, null, 2));
        
        // 5. Test quiz submission
        if (quizDetailsResponse.data.quiz.questions && quizDetailsResponse.data.quiz.questions.length > 0) {
          console.log('\n5. Testing quiz submission...');
          
          // Create test answers for all questions
          const testAnswers = quizDetailsResponse.data.quiz.questions.map(q => ({
            question_id: q.id,
            answer: q.type === 'multiple_choice' ? (q.options?.[0] || 'A') : 
                   q.type === 'true_false' ? 'true' : 'test answer'
          }));
          
          const submissionData = {
            answers: testAnswers,
            time_taken: 120
          };
          
          console.log('Submitting answers:', JSON.stringify(submissionData, null, 2));
          
          try {
            const submissionResponse = await axios.post(
              `${API_URL}/quizzes/${testQuizId}/submit`, 
              submissionData,
              { headers: { Authorization: `Bearer ${studentToken}` } }
            );
            console.log('✅ Quiz submission successful!');
            console.log('Submission result:', JSON.stringify(submissionResponse.data, null, 2));
          } catch (submissionError) {
            console.error('❌ Quiz submission failed:', {
              status: submissionError.response?.status,
              message: submissionError.response?.data?.message || submissionError.message,
              error: submissionError.response?.data?.error,
              details: submissionError.response?.data?.details,
              data: submissionError.response?.data
            });
            
            // Log the full error response for debugging
            if (submissionError.response?.data) {
              console.error('Full error response:', JSON.stringify(submissionError.response.data, null, 2));
            }
          }
        }
      } catch (detailsError) {
        console.error('❌ Get quiz details failed:', {
          status: detailsError.response?.status,
          message: detailsError.response?.data?.message || detailsError.message,
          data: detailsError.response?.data
        });
      }
    }

    // 6. Test quiz results (teacher view)
    if (teacherToken && testQuizId) {
      console.log('\n6. Testing quiz results (teacher view)...');
      try {
        const resultsResponse = await axios.get(`${API_URL}/quizzes/${testQuizId}/results`, {
          headers: { Authorization: `Bearer ${teacherToken}` }
        });
        console.log('✅ Quiz results retrieved successfully');
        console.log('Results summary:', JSON.stringify({
          totalStudents: resultsResponse.data.statistics?.total_students,
          submittedCount: resultsResponse.data.statistics?.submitted_count,
          averageScore: resultsResponse.data.statistics?.average_score
        }, null, 2));
      } catch (resultsError) {
        console.error('❌ Get quiz results failed:', {
          status: resultsError.response?.status,
          message: resultsError.response?.data?.message || resultsError.message,
          data: resultsError.response?.data
        });
      }
    }

    console.log('\n✅ TEST COMPLETE');
    console.log('================');

  } catch (error) {
    console.error('❌ UNEXPECTED ERROR:', error.message);
  }
}

// Run the test
testQuizFunctionality().catch(console.error);
