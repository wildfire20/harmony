// Test script for the Enhanced Quiz System
// This file demonstrates how to use all the quiz routes and functionality

const axios = require('axios');

// Configuration - Update these based on your setup
const API_BASE_URL = 'http://localhost:3000/api'; // or your deployed URL
const TEACHER_TOKEN = 'your-teacher-jwt-token';
const STUDENT_TOKEN = 'your-student-jwt-token';

// Headers for authenticated requests
const teacherHeaders = {
  'Authorization': `Bearer ${TEACHER_TOKEN}`,
  'Content-Type': 'application/json'
};

const studentHeaders = {
  'Authorization': `Bearer ${STUDENT_TOKEN}`,
  'Content-Type': 'application/json'
};

// Sample quiz data
const sampleQuiz = {
  title: 'Mathematics Quiz - Algebra Basics',
  description: 'This quiz covers basic algebraic concepts including linear equations and inequalities.',
  due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
  grade_id: 1,
  class_id: 1,
  time_limit: 45, // 45 minutes
  attempts_allowed: 2,
  show_results: true,
  randomize_questions: false,
  questions: [
    {
      question: 'What is the value of x in the equation 2x + 5 = 15?',
      type: 'multiple_choice',
      options: ['5', '10', '7.5', '15'],
      correct_answer: '5',
      points: 2,
      explanation: 'Solving: 2x + 5 = 15, subtract 5 from both sides: 2x = 10, divide by 2: x = 5'
    },
    {
      question: 'Is the statement "x + 3 = 3 + x" an example of the commutative property?',
      type: 'true_false',
      correct_answer: 'true',
      points: 1,
      explanation: 'Yes, the commutative property states that a + b = b + a'
    },
    {
      question: 'Explain in your own words what a variable represents in algebra.',
      type: 'short_answer',
      correct_answer: 'A variable is a symbol (usually a letter) that represents an unknown number or value.',
      points: 3,
      explanation: 'Variables are fundamental to algebra as they allow us to work with unknown quantities.'
    },
    {
      question: 'Which of the following is NOT a valid algebraic expression?',
      type: 'multiple_choice',
      options: ['2x + 3y', '5 + 7 =', 'a² - 4b', '(x + 1)(x - 1)'],
      correct_answer: '5 + 7 =',
      points: 2,
      explanation: 'An algebraic expression cannot end with an equals sign without something after it.'
    },
    {
      question: 'The equation 2x = 10 has exactly one solution.',
      type: 'true_false',
      correct_answer: 'true',
      points: 1,
      explanation: 'Linear equations like this have exactly one solution: x = 5'
    }
  ]
};

// Sample student answers
const sampleAnswers = [
  { question_id: 1, answer: '5' },
  { question_id: 2, answer: 'true' },
  { question_id: 3, answer: 'A variable is a letter that stands for a number we don\'t know yet.' },
  { question_id: 4, answer: '5 + 7 =' },
  { question_id: 5, answer: 'false' } // Intentionally wrong to test grading
];

// Manual grading data for short answer
const manualGrading = {
  question_grades: [
    {
      question_id: 3,
      points_awarded: 2.5, // Partial credit
      feedback: 'Good explanation but could be more detailed about unknown values.'
    }
  ],
  overall_feedback: 'Good work overall. Review the commutative property for next time.'
};

/**
 * Test all quiz functionality
 */
async function runQuizTests() {
  console.log('🧪 Starting Enhanced Quiz System Tests...\n');

  try {
    // 1. Create a quiz (Teacher)
    console.log('1️⃣ Creating a quiz...');
    const createResponse = await axios.post(
      `${API_BASE_URL}/quizzes`,
      sampleQuiz,
      { headers: teacherHeaders }
    );
    
    const createdQuiz = createResponse.data;
    const taskId = createdQuiz.task.id;
    console.log('✅ Quiz created successfully:', {
      taskId: taskId,
      title: createdQuiz.task.title,
      totalQuestions: createdQuiz.quiz.questions.length,
      totalPoints: createdQuiz.task.max_points
    });

    // 2. Get all quizzes (Teacher view)
    console.log('\n2️⃣ Fetching teacher\'s quizzes...');
    const teacherQuizzesResponse = await axios.get(
      `${API_BASE_URL}/quizzes`,
      { headers: teacherHeaders }
    );
    console.log('✅ Teacher quizzes fetched:', teacherQuizzesResponse.data.quizzes.length, 'quizzes found');

    // 3. Get quiz details (Student view)
    console.log('\n3️⃣ Getting quiz for student...');
    const studentQuizResponse = await axios.get(
      `${API_BASE_URL}/quizzes/${taskId}`,
      { headers: studentHeaders }
    );
    const studentQuiz = studentQuizResponse.data.quiz;
    console.log('✅ Student quiz view:', {
      title: studentQuiz.title,
      questionsVisible: studentQuiz.questions.length,
      timeLimit: studentQuiz.time_limit,
      attemptsAllowed: studentQuiz.attempts_allowed
    });

    // 4. Submit quiz answers (Student)
    console.log('\n4️⃣ Submitting quiz answers...');
    const submitResponse = await axios.post(
      `${API_BASE_URL}/quizzes/${taskId}/submit`,
      {
        answers: sampleAnswers,
        time_taken: 1800 // 30 minutes
      },
      { headers: studentHeaders }
    );
    
    const submission = submitResponse.data.submission;
    const submissionId = submission.id;
    console.log('✅ Quiz submitted:', {
      submissionId: submissionId,
      score: submission.score,
      maxScore: submission.max_score,
      percentage: submission.percentage,
      status: submission.status,
      needsManualGrading: submission.needs_manual_grading
    });

    // 5. Get quiz results (Teacher view)
    console.log('\n5️⃣ Fetching quiz results...');
    const resultsResponse = await axios.get(
      `${API_BASE_URL}/quizzes/${taskId}/results`,
      { headers: teacherHeaders }
    );
    const results = resultsResponse.data;
    console.log('✅ Quiz results:', {
      totalStudents: results.statistics.total_students,
      submitted: results.statistics.submitted_count,
      notSubmitted: results.statistics.not_submitted_count,
      submissionRate: results.statistics.submission_rate + '%',
      averageScore: results.statistics.average_score
    });

    // 6. Get pending grades (Teacher)
    console.log('\n6️⃣ Checking pending manual grades...');
    const pendingResponse = await axios.get(
      `${API_BASE_URL}/quizzes/${taskId}/pending-grades`,
      { headers: teacherHeaders }
    );
    const pendingGrades = pendingResponse.data;
    console.log('✅ Pending grades:', {
      totalPending: pendingGrades.total_pending,
      shortAnswerQuestions: pendingGrades.short_answer_questions
    });

    // 7. Manual grading (Teacher)
    if (pendingGrades.total_pending > 0) {
      console.log('\n7️⃣ Performing manual grading...');
      const gradingResponse = await axios.put(
        `${API_BASE_URL}/quizzes/${taskId}/submissions/${submissionId}/grade`,
        manualGrading,
        { headers: teacherHeaders }
      );
      console.log('✅ Manual grading completed:', {
        newScore: gradingResponse.data.submission.score,
        newPercentage: gradingResponse.data.submission.percentage,
        gradedQuestions: gradingResponse.data.graded_questions
      });
    }

    // 8. Get quiz analytics (Teacher)
    console.log('\n8️⃣ Fetching quiz analytics...');
    const analyticsResponse = await axios.get(
      `${API_BASE_URL}/quizzes/${taskId}/analytics`,
      { headers: teacherHeaders }
    );
    const analytics = analyticsResponse.data;
    console.log('✅ Quiz analytics:', {
      totalSubmissions: analytics.total_submissions,
      averagePercentage: analytics.overall_performance.average_percentage + '%',
      questionPerformance: analytics.question_analytics.map(q => ({
        questionType: q.question_type,
        accuracyRate: q.accuracy_rate + '%'
      }))
    });

    // 9. Update quiz (Teacher)
    console.log('\n9️⃣ Updating quiz settings...');
    const updateResponse = await axios.put(
      `${API_BASE_URL}/quizzes/${taskId}`,
      {
        attempts_allowed: 3, // Increase attempts
        show_results: true,
        time_limit: 60 // Increase time limit
      },
      { headers: teacherHeaders }
    );
    console.log('✅ Quiz updated:', {
      newAttemptsAllowed: updateResponse.data.quiz.attempts_allowed,
      newTimeLimit: updateResponse.data.quiz.time_limit
    });

    // 10. Get student quiz status
    console.log('\n🔟 Getting all quizzes for student...');
    const studentQuizzesResponse = await axios.get(
      `${API_BASE_URL}/quizzes`,
      { headers: studentHeaders }
    );
    const studentQuizzes = studentQuizzesResponse.data.quizzes;
    console.log('✅ Student quiz overview:', {
      totalQuizzes: studentQuizzes.length,
      studentStatus: studentQuizzes.map(q => ({
        title: q.title,
        status: q.quiz_status,
        attempts: q.student_status?.attempts || 0,
        canAttempt: q.student_status?.can_attempt
      }))
    });

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
  }
}

/**
 * Example usage scenarios
 */
const usageExamples = {
  // Creating different types of quizzes
  createMultipleChoiceQuiz: () => ({
    title: 'Science Quiz - Solar System',
    description: 'Test your knowledge about planets and space.',
    due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    grade_id: 2,
    class_id: 1,
    time_limit: 30,
    attempts_allowed: 1,
    show_results: false, // Don't show results immediately
    randomize_questions: true,
    questions: [
      {
        question: 'Which planet is closest to the Sun?',
        type: 'multiple_choice',
        options: ['Venus', 'Mercury', 'Earth', 'Mars'],
        correct_answer: 'Mercury',
        points: 1
      },
      {
        question: 'How many moons does Mars have?',
        type: 'multiple_choice',
        options: ['1', '2', '3', '0'],
        correct_answer: '2',
        points: 1
      }
    ]
  }),

  createTrueFalseQuiz: () => ({
    title: 'History Quiz - World War II',
    description: 'True or False questions about WWII events.',
    due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    grade_id: 3,
    class_id: 2,
    time_limit: 15,
    attempts_allowed: 2,
    show_results: true,
    randomize_questions: false,
    questions: [
      {
        question: 'World War II ended in 1945.',
        type: 'true_false',
        correct_answer: 'true',
        points: 1
      },
      {
        question: 'The D-Day invasion took place in France.',
        type: 'true_false',
        correct_answer: 'true',
        points: 1
      }
    ]
  }),

  createMixedQuiz: () => ({
    title: 'English Literature - Comprehensive Test',
    description: 'Mixed question types covering Shakespeare and poetry.',
    due_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    grade_id: 4,
    class_id: 1,
    time_limit: 90,
    attempts_allowed: 1,
    show_results: true,
    randomize_questions: true,
    questions: [
      {
        question: 'Who wrote "Romeo and Juliet"?',
        type: 'multiple_choice',
        options: ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Mark Twain'],
        correct_answer: 'William Shakespeare',
        points: 2
      },
      {
        question: 'Shakespeare was born in the 16th century.',
        type: 'true_false',
        correct_answer: 'true',
        points: 1
      },
      {
        question: 'Analyze the theme of love in "Romeo and Juliet". Provide specific examples.',
        type: 'short_answer',
        correct_answer: 'Love is portrayed as both beautiful and destructive, shown through the passionate but tragic relationship between Romeo and Juliet.',
        points: 5
      }
    ]
  })
};

module.exports = {
  runQuizTests,
  usageExamples,
  sampleQuiz,
  sampleAnswers,
  manualGrading
};

// Run tests if this file is executed directly
if (require.main === module) {
  runQuizTests();
}
