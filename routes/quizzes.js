const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess, authorizeTeacherAssignment, requireTeacherAssignment } = require('../middleware/auth');

const router = express.Router();

// Create quiz
router.post('/', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('task_id').isInt().withMessage('Task ID is required'),
  body('questions').isArray().withMessage('Questions must be an array'),
  body('questions.*.question').notEmpty().withMessage('Question text is required'),
  body('questions.*.type').isIn(['multiple_choice', 'true_false', 'short_answer']).withMessage('Invalid question type'),
  body('questions.*.options').optional().isArray().withMessage('Options must be an array'),
  body('questions.*.correct_answer').notEmpty().withMessage('Correct answer is required'),
  body('questions.*.points').optional().isInt({ min: 1 }).withMessage('Points must be a positive integer'),
  body('time_limit').optional().isInt({ min: 1 }).withMessage('Time limit must be a positive integer'),
  body('attempts_allowed').optional().isInt({ min: 1 }).withMessage('Attempts allowed must be a positive integer'),
  body('show_results').optional().isBoolean().withMessage('Show results must be a boolean'),
  body('randomize_questions').optional().isBoolean().withMessage('Randomize questions must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      task_id, 
      questions, 
      time_limit, 
      attempts_allowed, 
      show_results, 
      randomize_questions 
    } = req.body;

    // Verify task exists and user has access
    const taskResult = await db.query(`
      SELECT id, grade_id, class_id, task_type FROM tasks 
      WHERE id = $1 AND is_active = true
    `, [task_id]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const task = taskResult.rows[0];

    if (task.task_type !== 'quiz') {
      return res.status(400).json({ message: 'Task must be of type quiz' });
    }

    // Check if user has access to this grade/class
    const user = req.user;
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, task.grade_id, task.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }

    // Process questions to ensure they have proper structure
    const processedQuestions = questions.map((q, index) => ({
      id: index + 1,
      question: q.question,
      type: q.type,
      options: q.options || [],
      correct_answer: q.correct_answer,
      points: q.points || 1,
      explanation: q.explanation || ''
    }));

    // Check if quiz already exists for this task
    const existingQuiz = await db.query('SELECT id FROM quizzes WHERE task_id = $1', [task_id]);

    let result;
    if (existingQuiz.rows.length > 0) {
      // Update existing quiz
      result = await db.query(`
        UPDATE quizzes 
        SET questions = $1, time_limit = $2, attempts_allowed = $3, show_results = $4, randomize_questions = $5
        WHERE task_id = $6
        RETURNING id, task_id, time_limit, attempts_allowed, show_results, randomize_questions, created_at
      `, [
        JSON.stringify(processedQuestions),
        time_limit,
        attempts_allowed || 1,
        show_results !== undefined ? show_results : true,
        randomize_questions !== undefined ? randomize_questions : false,
        task_id
      ]);
    } else {
      // Create new quiz
      result = await db.query(`
        INSERT INTO quizzes (task_id, questions, time_limit, attempts_allowed, show_results, randomize_questions)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, task_id, time_limit, attempts_allowed, show_results, randomize_questions, created_at
      `, [
        task_id,
        JSON.stringify(processedQuestions),
        time_limit,
        attempts_allowed || 1,
        show_results !== undefined ? show_results : true,
        randomize_questions !== undefined ? randomize_questions : false
      ]);
    }

    res.status(201).json({
      message: 'Quiz created/updated successfully',
      quiz: {
        ...result.rows[0],
        questions: processedQuestions
      }
    });

  } catch (error) {
    console.error('Create quiz error:', error);
    res.status(500).json({ message: 'Server error creating quiz' });
  }
});

// Get quiz details
router.get('/:taskId', [
  authenticate,
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    // Get quiz details
    const result = await db.query(`
      SELECT q.id, q.task_id, q.questions, q.time_limit, q.attempts_allowed, 
             q.show_results, q.randomize_questions, q.created_at,
             t.title, t.description, t.due_date, t.max_points
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1 AND t.is_active = true
    `, [taskId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = result.rows[0];
    let questions = JSON.parse(quiz.questions);

    // For students, hide correct answers and randomize if needed
    if (user.role === 'student') {
      // Check student's previous attempts
      const attemptResult = await db.query(`
        SELECT COUNT(*) as attempt_count, MAX(attempt_number) as last_attempt
        FROM submissions 
        WHERE task_id = $1 AND student_id = $2
      `, [taskId, user.id]);

      const attempts = attemptResult.rows[0];
      const attemptCount = parseInt(attempts.attempt_count);
      const maxAttempts = quiz.attempts_allowed;

      if (attemptCount >= maxAttempts) {
        return res.status(403).json({ 
          message: 'Maximum attempts reached',
          attempts_used: attemptCount,
          max_attempts: maxAttempts
        });
      }

      // Hide correct answers from students
      questions = questions.map(q => ({
        ...q,
        correct_answer: undefined,
        explanation: undefined
      }));

      // Randomize questions if enabled
      if (quiz.randomize_questions) {
        questions = questions.sort(() => Math.random() - 0.5);
      }

      quiz.attempts_remaining = maxAttempts - attemptCount;
    }

    quiz.questions = questions;

    res.json({ quiz });

  } catch (error) {
    console.error('Get quiz error:', error);
    res.status(500).json({ message: 'Server error fetching quiz' });
  }
});

// Submit quiz answers
router.post('/:taskId/submit', [
  authenticate,
  authorize('student'),
  body('answers').isArray().withMessage('Answers must be an array'),
  body('answers.*.question_id').isInt().withMessage('Question ID is required'),
  body('answers.*.answer').notEmpty().withMessage('Answer is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { taskId } = req.params;
    const { answers } = req.body;
    const user = req.user;

    // Get quiz details
    const quizResult = await db.query(`
      SELECT q.id, q.questions, q.attempts_allowed, q.show_results,
             t.max_points, t.grade_id, t.class_id
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1 AND t.is_active = true
    `, [taskId]);

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];
    const questions = JSON.parse(quiz.questions);

    // Check if student has access to this quiz
    if (user.grade_id != quiz.grade_id || user.class_id != quiz.class_id) {
      return res.status(403).json({ message: 'Access denied to this quiz' });
    }

    // Check attempts
    const attemptResult = await db.query(`
      SELECT COUNT(*) as attempt_count, MAX(attempt_number) as last_attempt
      FROM submissions 
      WHERE task_id = $1 AND student_id = $2
    `, [taskId, user.id]);

    const attempts = attemptResult.rows[0];
    const attemptCount = parseInt(attempts.attempt_count);
    const nextAttempt = (attempts.last_attempt || 0) + 1;

    if (attemptCount >= quiz.attempts_allowed) {
      return res.status(403).json({ message: 'Maximum attempts reached' });
    }

    // Calculate score
    let totalScore = 0;
    let maxScore = 0;
    const gradedAnswers = [];

    for (const question of questions) {
      const studentAnswer = answers.find(a => a.question_id === question.id);
      const isCorrect = studentAnswer && studentAnswer.answer === question.correct_answer;
      
      maxScore += question.points;
      if (isCorrect) {
        totalScore += question.points;
      }

      gradedAnswers.push({
        question_id: question.id,
        student_answer: studentAnswer ? studentAnswer.answer : null,
        correct_answer: question.correct_answer,
        is_correct: isCorrect,
        points_earned: isCorrect ? question.points : 0,
        points_possible: question.points
      });
    }

    // Store submission
    const submissionResult = await db.query(`
      INSERT INTO submissions (task_id, student_id, quiz_answers, score, max_score, status, attempt_number)
      VALUES ($1, $2, $3, $4, $5, 'graded', $6)
      RETURNING id, score, max_score, submitted_at
    `, [
      taskId,
      user.id,
      JSON.stringify(gradedAnswers),
      totalScore,
      maxScore,
      nextAttempt
    ]);

    const submission = submissionResult.rows[0];

    // Prepare response
    const response = {
      message: 'Quiz submitted successfully',
      submission: {
        id: submission.id,
        score: submission.score,
        max_score: submission.max_score,
        percentage: Math.round((submission.score / submission.max_score) * 100),
        submitted_at: submission.submitted_at,
        attempt_number: nextAttempt
      }
    };

    // Include detailed results if enabled
    if (quiz.show_results) {
      response.results = gradedAnswers.map(answer => ({
        question_id: answer.question_id,
        student_answer: answer.student_answer,
        correct_answer: answer.correct_answer,
        is_correct: answer.is_correct,
        points_earned: answer.points_earned,
        points_possible: answer.points_possible,
        question: questions.find(q => q.id === answer.question_id)?.question,
        explanation: questions.find(q => q.id === answer.question_id)?.explanation
      }));
    }

    res.json(response);

  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json({ message: 'Server error submitting quiz' });
  }
});

// Get quiz results (for teachers)
router.get('/:taskId/results', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;

    // Get quiz results
    const result = await db.query(`
      SELECT s.id, s.score, s.max_score, s.submitted_at, s.attempt_number,
             u.id as student_id, u.student_number, u.first_name, u.last_name,
             s.quiz_answers
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
      ORDER BY u.last_name, u.first_name, s.attempt_number DESC
    `, [taskId]);

    // Get quiz questions for context
    const quizResult = await db.query(`
      SELECT questions FROM quizzes WHERE task_id = $1
    `, [taskId]);

    const questions = quizResult.rows.length > 0 ? JSON.parse(quizResult.rows[0].questions) : [];

    // Calculate statistics
    const submissions = result.rows;
    const scores = submissions.map(s => s.score);
    const stats = {
      total_submissions: submissions.length,
      average_score: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0,
      highest_score: scores.length > 0 ? Math.max(...scores) : 0,
      lowest_score: scores.length > 0 ? Math.min(...scores) : 0,
      pass_rate: submissions.filter(s => (s.score / s.max_score) >= 0.6).length / submissions.length * 100
    };

    res.json({
      results: submissions,
      questions,
      statistics: stats
    });

  } catch (error) {
    console.error('Get quiz results error:', error);
    res.status(500).json({ message: 'Server error fetching quiz results' });
  }
});

// Delete quiz
router.delete('/:taskId', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await db.query(`
      DELETE FROM quizzes 
      WHERE task_id = $1
      RETURNING id, task_id
    `, [taskId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    res.json({
      message: 'Quiz deleted successfully',
      quiz: result.rows[0]
    });

  } catch (error) {
    console.error('Delete quiz error:', error);
    res.status(500).json({ message: 'Server error deleting quiz' });
  }
});

// Get quiz results for a student
router.get('/:id/results', [
  authenticate
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Get quiz and task information
    const quizResult = await db.query(`
      SELECT q.*, t.title, t.grade_id, t.class_id, t.max_points
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.id = $1 AND t.is_active = true
    `, [id]);

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];

    // Check access permissions
    if (user.role === 'student' && (user.grade_id != quiz.grade_id || user.class_id != quiz.class_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, quiz.grade_id, quiz.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    if (user.role === 'student') {
      // Get student's submissions for this quiz
      const submissionsResult = await db.query(`
        SELECT s.*, u.first_name, u.last_name
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        WHERE s.task_id = $1 AND s.student_id = $2
        ORDER BY s.attempt_number DESC
      `, [quiz.task_id, user.id]);

      const submissions = submissionsResult.rows.map(sub => ({
        ...sub,
        quiz_answers: sub.quiz_answers || [],
        percentage: sub.max_score > 0 ? Math.round((sub.score / sub.max_score) * 100) : 0
      }));

      res.json({
        quiz: {
          id: quiz.id,
          title: quiz.title,
          max_points: quiz.max_points,
          show_results: quiz.show_results,
          time_limit: quiz.time_limit,
          attempts_allowed: quiz.attempts_allowed
        },
        submissions
      });
    } else {
      // For teachers and admins, get all student results
      const allSubmissionsResult = await db.query(`
        SELECT s.*, u.first_name, u.last_name, u.student_number
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        WHERE s.task_id = $1
        ORDER BY u.last_name, u.first_name, s.attempt_number DESC
      `, [quiz.task_id]);

      const submissions = allSubmissionsResult.rows.map(sub => ({
        ...sub,
        quiz_answers: sub.quiz_answers || [],
        percentage: sub.max_score > 0 ? Math.round((sub.score / sub.max_score) * 100) : 0
      }));

      res.json({
        quiz: {
          id: quiz.id,
          title: quiz.title,
          max_points: quiz.max_points,
          questions: quiz.questions,
          show_results: quiz.show_results,
          time_limit: quiz.time_limit,
          attempts_allowed: quiz.attempts_allowed
        },
        submissions
      });
    }

  } catch (error) {
    console.error('Get quiz results error:', error);
    res.status(500).json({ message: 'Server error fetching quiz results' });
  }
});

// Update quiz result (for teachers and admins to modify grades)
router.put('/:id/results/:submissionId', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer'),
  body('feedback').optional().isString().withMessage('Feedback must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id, submissionId } = req.params;
    const { score, feedback } = req.body;
    const user = req.user;

    // Get submission and quiz information
    const submissionResult = await db.query(`
      SELECT s.*, t.grade_id, t.class_id, t.max_points
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN quizzes q ON q.task_id = t.id
      WHERE s.id = $1 AND q.id = $2
    `, [submissionId, id]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];

    // Check teacher permissions
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, submission.grade_id, submission.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Validate score doesn't exceed max points
    if (score > submission.max_points) {
      return res.status(400).json({ 
        message: `Score cannot exceed maximum points (${submission.max_points})` 
      });
    }

    // Update submission
    const result = await db.query(`
      UPDATE submissions 
      SET score = $1, feedback = $2, graded_at = CURRENT_TIMESTAMP, graded_by = $3, status = 'graded'
      WHERE id = $4
      RETURNING *
    `, [score, feedback, user.id, submissionId]);

    res.json({
      message: 'Grade updated successfully',
      submission: {
        ...result.rows[0],
        percentage: submission.max_points > 0 ? Math.round((score / submission.max_points) * 100) : 0
      }
    });

  } catch (error) {
    console.error('Update quiz result error:', error);
    res.status(500).json({ message: 'Server error updating quiz result' });
  }
});

module.exports = router;
