// Quiz-specific middleware and helper functions
const db = require('../config/database');

/**
 * Middleware to check if a quiz exists and user has access to it
 */
const validateQuizAccess = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    // Get quiz and task details
    const quizResult = await db.query(`
      SELECT q.*, t.title, t.grade_id, t.class_id, t.is_active, t.due_date
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1
    `, [taskId]);

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];

    // Check if task is active
    if (!quiz.is_active) {
      return res.status(400).json({ message: 'Quiz is not active' });
    }

    // Check user access based on role
    if (user.role === 'student') {
      // Students can only access quizzes for their grade/class
      if (user.grade_id !== quiz.grade_id || user.class_id !== quiz.class_id) {
        return res.status(403).json({ message: 'Access denied to this quiz' });
      }
    } else if (user.role === 'teacher') {
      // Teachers can only access quizzes for their assigned classes
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, quiz.grade_id, quiz.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }
    // Admins and super_admins have access to all quizzes

    // Attach quiz data to request for use in route handlers
    req.quiz = quiz;
    next();

  } catch (error) {
    console.error('Quiz access validation error:', error);
    res.status(500).json({ message: 'Server error validating quiz access' });
  }
};

/**
 * Middleware to check if a student can still take a quiz
 */
const validateQuizAvailability = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const user = req.user;
    const quiz = req.quiz; // Should be set by validateQuizAccess

    // Check if quiz is overdue
    if (new Date() > new Date(quiz.due_date)) {
      return res.status(400).json({ 
        message: 'Quiz submission deadline has passed',
        due_date: quiz.due_date
      });
    }

    // Check student's attempts
    const attemptResult = await db.query(`
      SELECT COUNT(*) as attempt_count, MAX(attempt_number) as last_attempt,
             MAX(submitted_at) as last_submission
      FROM submissions 
      WHERE task_id = $1 AND student_id = $2
    `, [taskId, user.id]);

    const attempts = attemptResult.rows[0];
    const attemptCount = parseInt(attempts.attempt_count);

    if (attemptCount >= quiz.attempts_allowed) {
      return res.status(403).json({ 
        message: 'Maximum attempts reached',
        attempts_used: attemptCount,
        max_attempts: quiz.attempts_allowed,
        last_submission: attempts.last_submission
      });
    }

    // Attach attempt information to request
    req.attempts = {
      count: attemptCount,
      next: (attempts.last_attempt || 0) + 1,
      remaining: quiz.attempts_allowed - attemptCount
    };

    next();

  } catch (error) {
    console.error('Quiz availability validation error:', error);
    res.status(500).json({ message: 'Server error validating quiz availability' });
  }
};

/**
 * Helper function to auto-grade a quiz submission
 */
const autoGradeQuiz = (questions, studentAnswers) => {
  let totalScore = 0;
  let maxScore = 0;
  const gradedAnswers = [];

  for (const question of questions) {
    const studentAnswer = studentAnswers.find(a => a.question_id === question.id);
    maxScore += question.points;

    let isCorrect = false;
    let pointsEarned = 0;

    if (studentAnswer && studentAnswer.answer !== null && studentAnswer.answer !== '') {
      if (question.type === 'multiple_choice' || question.type === 'true_false') {
        // Auto-grade multiple choice and true/false
        isCorrect = studentAnswer.answer.toString().trim().toLowerCase() === 
                   question.correct_answer.toString().trim().toLowerCase();
        pointsEarned = isCorrect ? question.points : 0;
        totalScore += pointsEarned;
      } else if (question.type === 'short_answer') {
        // Store short answers for manual grading
        isCorrect = null; // Will be manually graded
        pointsEarned = 0; // Will be awarded after manual grading
      }
    }

    gradedAnswers.push({
      question_id: question.id,
      question_text: question.question,
      question_type: question.type,
      student_answer: studentAnswer ? studentAnswer.answer : null,
      correct_answer: question.correct_answer,
      is_correct: isCorrect,
      points_earned: pointsEarned,
      points_possible: question.points,
      needs_manual_grading: question.type === 'short_answer'
    });
  }

  return {
    totalScore,
    maxScore,
    gradedAnswers,
    hasShortAnswers: questions.some(q => q.type === 'short_answer')
  };
};

/**
 * Helper function to validate quiz questions
 */
const validateQuizQuestions = (questions) => {
  const errors = [];

  if (!Array.isArray(questions) || questions.length === 0) {
    errors.push('At least one question is required');
    return errors;
  }

  questions.forEach((question, index) => {
    const questionNum = index + 1;

    if (!question.question || question.question.trim() === '') {
      errors.push(`Question ${questionNum}: Question text is required`);
    }

    if (!['multiple_choice', 'true_false', 'short_answer'].includes(question.type)) {
      errors.push(`Question ${questionNum}: Invalid question type`);
    }

    if (question.type === 'multiple_choice') {
      if (!question.options || !Array.isArray(question.options) || question.options.length < 2) {
        errors.push(`Question ${questionNum}: Multiple choice questions must have at least 2 options`);
      }
    }

    if (question.type === 'true_false') {
      if (!['true', 'false', 'True', 'False'].includes(question.correct_answer)) {
        errors.push(`Question ${questionNum}: True/false questions must have correct answer as "true" or "false"`);
      }
    }

    if (!question.correct_answer || question.correct_answer.toString().trim() === '') {
      errors.push(`Question ${questionNum}: Correct answer is required`);
    }

    if (question.points && (isNaN(question.points) || question.points < 1)) {
      errors.push(`Question ${questionNum}: Points must be a positive number`);
    }
  });

  return errors;
};

/**
 * Helper function to format quiz response for students (hide answers)
 */
const formatQuizForStudent = (quiz, user) => {
  const questions = JSON.parse(quiz.questions);
  
  // Hide correct answers and explanations from students
  const sanitizedQuestions = questions.map(q => ({
    id: q.id,
    question: q.question,
    type: q.type,
    options: q.options || [],
    points: q.points
  }));

  // Randomize questions if enabled
  if (quiz.randomize_questions) {
    sanitizedQuestions.sort(() => Math.random() - 0.5);
  }

  return {
    id: quiz.id,
    task_id: quiz.task_id,
    title: quiz.title,
    description: quiz.description,
    due_date: quiz.due_date,
    max_points: quiz.max_points,
    time_limit: quiz.time_limit,
    attempts_allowed: quiz.attempts_allowed,
    questions: sanitizedQuestions
  };
};

/**
 * Helper function to get quiz statistics
 */
const calculateQuizStatistics = async (taskId) => {
  try {
    // Get basic submission stats
    const submissionStats = await db.query(`
      SELECT 
        COUNT(*) as total_submissions,
        COUNT(DISTINCT student_id) as unique_students,
        AVG(score) as average_score,
        MAX(score) as highest_score,
        MIN(score) as lowest_score,
        AVG(score::float / max_score::float * 100) as average_percentage
      FROM submissions 
      WHERE task_id = $1
    `, [taskId]);

    const stats = submissionStats.rows[0];

    // Get grade distribution
    const gradeDistribution = await db.query(`
      SELECT 
        CASE 
          WHEN (score::float / max_score::float * 100) >= 90 THEN 'A'
          WHEN (score::float / max_score::float * 100) >= 80 THEN 'B'
          WHEN (score::float / max_score::float * 100) >= 70 THEN 'C'
          WHEN (score::float / max_score::float * 100) >= 60 THEN 'D'
          ELSE 'F'
        END as grade,
        COUNT(*) as count
      FROM submissions 
      WHERE task_id = $1
      GROUP BY grade
      ORDER BY grade
    `, [taskId]);

    return {
      total_submissions: parseInt(stats.total_submissions),
      unique_students: parseInt(stats.unique_students),
      average_score: parseFloat(stats.average_score).toFixed(2),
      highest_score: parseInt(stats.highest_score),
      lowest_score: parseInt(stats.lowest_score),
      average_percentage: Math.round(parseFloat(stats.average_percentage)),
      grade_distribution: gradeDistribution.rows
    };

  } catch (error) {
    console.error('Error calculating quiz statistics:', error);
    throw error;
  }
};

module.exports = {
  validateQuizAccess,
  validateQuizAvailability,
  autoGradeQuiz,
  validateQuizQuestions,
  formatQuizForStudent,
  calculateQuizStatistics
};
