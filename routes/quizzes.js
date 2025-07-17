const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess, authorizeTeacherAssignment, requireTeacherAssignment } = require('../middleware/auth');

const router = express.Router();

// Create quiz with enhanced validation and features
router.post('/', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('title').notEmpty().withMessage('Quiz title is required'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('due_date').isISO8601().withMessage('Valid due date is required'),
  body('grade_id').isInt().withMessage('Grade ID is required'),
  body('class_id').isInt().withMessage('Class ID is required'),
  body('questions').isArray({ min: 1 }).withMessage('At least one question is required'),
  body('questions.*.question').notEmpty().withMessage('Question text is required'),
  body('questions.*.type').isIn(['multiple_choice', 'true_false', 'short_answer']).withMessage('Invalid question type'),
  body('questions.*.options').optional().isArray().withMessage('Options must be an array'),
  body('questions.*.correct_answer').notEmpty().withMessage('Correct answer is required'),
  body('questions.*.points').optional().isInt({ min: 1 }).withMessage('Points must be a positive integer'),
  body('questions.*.explanation').optional().isString().withMessage('Explanation must be a string'),
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
      title,
      description,
      due_date,
      grade_id,
      class_id,
      questions, 
      time_limit, 
      attempts_allowed, 
      show_results, 
      randomize_questions 
    } = req.body;

    const user = req.user;

    // Check if teacher has access to this grade/class
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, grade_id, class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }

    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);

    // Validate questions based on type
    for (const question of questions) {
      if (question.type === 'multiple_choice' && (!question.options || question.options.length < 2)) {
        return res.status(400).json({ 
          message: 'Multiple choice questions must have at least 2 options' 
        });
      }
      if (question.type === 'true_false' && !['true', 'false', 'True', 'False'].includes(question.correct_answer)) {
        return res.status(400).json({ 
          message: 'True/false questions must have correct answer as "true" or "false"' 
        });
      }
    }

    // Start transaction
    await db.query('BEGIN');

    try {
      // Create task first
      const taskResult = await db.query(`
        INSERT INTO tasks (title, description, due_date, max_points, task_type, grade_id, class_id, created_by)
        VALUES ($1, $2, $3, $4, 'quiz', $5, $6, $7)
        RETURNING id, title, description, due_date, max_points, grade_id, class_id, created_at
      `, [title, description, due_date, totalPoints, grade_id, class_id, user.id]);

      const task = taskResult.rows[0];

      // Process questions with enhanced validation
      const processedQuestions = questions.map((q, index) => ({
        id: index + 1,
        question: q.question.trim(),
        type: q.type,
        options: q.type === 'multiple_choice' ? q.options : [],
        correct_answer: q.correct_answer.toString().trim(),
        points: q.points || 1,
        explanation: q.explanation?.trim() || ''
      }));

      // Validate processed questions JSON
      const questionsJSON = JSON.stringify(processedQuestions);
      console.log('Creating quiz with questions JSON length:', questionsJSON.length);
      
      // Test that we can parse it back
      try {
        const testParse = JSON.parse(questionsJSON);
        console.log('✅ Questions JSON validation passed');
      } catch (jsonError) {
        console.error('❌ Questions JSON validation failed:', jsonError);
        throw new Error('Invalid questions format');
      }

      // Create quiz
      const quizResult = await db.query(`
        INSERT INTO quizzes (task_id, questions, time_limit, attempts_allowed, show_results, randomize_questions)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, task_id, time_limit, attempts_allowed, show_results, randomize_questions, created_at
      `, [
        task.id,
        questionsJSON,
        time_limit || null,
        attempts_allowed || 1,
        show_results !== undefined ? show_results : true,
        randomize_questions !== undefined ? randomize_questions : false
      ]);

      await db.query('COMMIT');

      res.status(201).json({
        message: 'Quiz created successfully',
        task: task,
        quiz: {
          ...quizResult.rows[0],
          questions: processedQuestions
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Create quiz error:', error);
    res.status(500).json({ message: 'Server error creating quiz' });
  }
});

// Get all quizzes for a teacher or student
router.get('/', [
  authenticate
], async (req, res) => {
  try {
    const user = req.user;
    const { grade_id, class_id, status } = req.query;

    let query = `
      SELECT t.id as task_id, t.title, t.description, t.due_date, t.max_points,
             t.grade_id, t.class_id, g.name as grade_name, c.name as class_name,
             q.id as quiz_id, q.time_limit, q.attempts_allowed, q.show_results,
             q.randomize_questions, t.created_at,
             CASE 
               WHEN t.due_date < NOW() THEN 'overdue'
               WHEN t.due_date > NOW() THEN 'active' 
               ELSE 'due_today'
             END as quiz_status
      FROM tasks t
      JOIN quizzes q ON t.id = q.task_id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE t.is_active = true AND t.task_type = 'quiz'
    `;
    
    const params = [];
    let paramCount = 0;

    if (user.role === 'student') {
      query += ` AND t.grade_id = $${++paramCount} AND t.class_id = $${++paramCount}`;
      params.push(user.grade_id, user.class_id);
    } else if (user.role === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $${++paramCount} AND ta.grade_id = t.grade_id AND ta.class_id = t.class_id
      )`;
      params.push(user.id);
    }

    if (grade_id) {
      query += ` AND t.grade_id = $${++paramCount}`;
      params.push(grade_id);
    }

    if (class_id) {
      query += ` AND t.class_id = $${++paramCount}`;
      params.push(class_id);
    }

    if (status === 'active') {
      query += ` AND t.due_date > NOW()`;
    } else if (status === 'overdue') {
      query += ` AND t.due_date < NOW()`;
    }

    query += ` ORDER BY t.due_date ASC, t.created_at DESC`;

    const result = await db.query(query, params);
    const quizzes = result.rows;

    // For students, get their submission status for each quiz
    if (user.role === 'student' && quizzes.length > 0) {
      const taskIds = quizzes.map(q => q.task_id);
      const submissionsResult = await db.query(`
        SELECT task_id, COUNT(*) as attempts, MAX(score) as best_score, 
               MAX(submitted_at) as last_attempt, status
        FROM submissions 
        WHERE task_id = ANY($1) AND student_id = $2
        GROUP BY task_id, status
      `, [taskIds, user.id]);

      const submissionMap = {};
      submissionsResult.rows.forEach(sub => {
        submissionMap[sub.task_id] = sub;
      });

      quizzes.forEach(quiz => {
        const submission = submissionMap[quiz.task_id];
        quiz.student_status = submission ? {
          attempts: parseInt(submission.attempts),
          best_score: submission.best_score,
          last_attempt: submission.last_attempt,
          status: submission.status,
          can_attempt: parseInt(submission.attempts) < quiz.attempts_allowed
        } : {
          attempts: 0,
          best_score: null,
          last_attempt: null,
          status: 'not_attempted',
          can_attempt: true
        };
      });
    }

    res.json({ quizzes });

  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ message: 'Server error fetching quizzes' });
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

    console.log(`=== GET QUIZ DETAILS DEBUG ===`);
    console.log(`Task ID: ${taskId}`);
    console.log(`User:`, JSON.stringify({
      id: user.id,
      role: user.role,
      grade_id: user.grade_id,
      class_id: user.class_id
    }, null, 2));

    // Get quiz details with enhanced error handling
    const result = await db.query(`
      SELECT q.id, q.task_id, q.questions, q.time_limit, q.attempts_allowed, 
             q.show_results, q.randomize_questions, q.created_at,
             t.title, t.description, t.due_date, t.max_points, t.grade_id, t.class_id
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1 AND t.is_active = true
    `, [taskId]);

    console.log(`Database query returned ${result.rows.length} rows`);

    if (result.rows.length === 0) {
      console.log('❌ Quiz not found in database');
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = result.rows[0];
    console.log('Quiz found:', JSON.stringify({
      id: quiz.id,
      title: quiz.title,
      grade_id: quiz.grade_id,
      class_id: quiz.class_id
    }, null, 2));

    let questions;
    try {
      console.log('Quiz questions type:', typeof quiz.questions);
      console.log('Quiz questions value preview:', JSON.stringify(quiz.questions).substring(0, 200) + '...');
      
      if (typeof quiz.questions === 'string') {
        questions = JSON.parse(quiz.questions);
      } else if (Array.isArray(quiz.questions)) {
        questions = quiz.questions; // Already parsed
      } else if (typeof quiz.questions === 'object' && quiz.questions !== null) {
        // If it's already an object but not an array, it might be a parsed JSON
        questions = quiz.questions;
      } else {
        throw new Error('Questions data is neither string nor array');
      }
      
      console.log(`✅ Parsed ${questions.length} questions successfully`);
      
      // Validate question structure
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('Questions array is empty or invalid');
      }
      
    } catch (parseError) {
      console.error('Error parsing quiz questions:', parseError);
      console.error('Raw questions value:', quiz.questions);
      console.error('Questions type:', typeof quiz.questions);
      return res.status(500).json({ 
        message: 'Quiz data is corrupted',
        debug: process.env.NODE_ENV === 'development' ? {
          error: parseError.message,
          dataType: typeof quiz.questions,
          rawData: quiz.questions
        } : undefined
      });
    }

    // For students, hide correct answers and randomize if needed
    if (user.role === 'student') {
      console.log('Processing quiz for student...');
      
      // Check student's previous attempts
      const attemptResult = await db.query(`
        SELECT COUNT(*) as attempt_count, MAX(attempt_number) as last_attempt
        FROM submissions 
        WHERE task_id = $1 AND student_id = $2
      `, [taskId, user.id]);

      const attempts = attemptResult.rows[0];
      const attemptCount = parseInt(attempts.attempt_count);
      const maxAttempts = quiz.attempts_allowed;

      console.log(`Student attempts: ${attemptCount}/${maxAttempts}`);

      if (attemptCount >= maxAttempts) {
        console.log('❌ Maximum attempts reached');
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
        console.log('Questions randomized');
      }

      quiz.attempts_remaining = maxAttempts - attemptCount;
    }

    quiz.questions = questions;
    console.log('✅ Quiz details prepared successfully');

    res.json({ quiz });

  } catch (error) {
    console.error('Get quiz error details:', {
      message: error.message,
      stack: error.stack,
      taskId: req.params.taskId,
      userId: req.user?.id,
      userRole: req.user?.role
    });
    res.status(500).json({ 
      message: 'Server error fetching quiz',
      debug: process.env.NODE_ENV === 'development' ? {
        error: error.message,
        taskId: req.params.taskId
      } : undefined
    });
  }
});

// Submit quiz answers - Enhanced with better validation
router.post('/:taskId/submit', [
  authenticate,
  authorize('student'),
  body('answers').isArray().withMessage('Answers must be an array'),
  body('answers.*.question_id').isInt().withMessage('Question ID is required'),
  body('answers.*.answer').exists().withMessage('Answer field is required'),
  body('time_taken').optional().isInt({ min: 0 }).withMessage('Time taken must be a positive integer')
], async (req, res) => {
  try {
    console.log('=== QUIZ SUBMISSION DEBUG ===');
    console.log('TaskId:', req.params.taskId);
    console.log('User:', req.user ? `${req.user.id} (${req.user.email})` : 'No user');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false,
        message: 'Invalid submission data',
        errors: errors.array() 
      });
    }

    const { taskId } = req.params;
    const { answers, time_taken } = req.body;
    const user = req.user;

    // Get quiz details with task information
    const quizResult = await db.query(`
      SELECT q.id, q.questions, q.attempts_allowed, q.show_results, q.time_limit,
             t.max_points, t.grade_id, t.class_id, t.due_date, t.title,
             t.is_active
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1
    `, [taskId]);

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];
    
    // Check if quiz is still active
    if (!quiz.is_active) {
      return res.status(400).json({ message: 'This quiz is no longer active' });
    }

    // Check if quiz is overdue
    if (new Date() > new Date(quiz.due_date)) {
      return res.status(400).json({ message: 'Quiz submission deadline has passed' });
    }

    // Parse questions with proper error handling
    let questions;
    try {
      console.log('Quiz questions type:', typeof quiz.questions);
      console.log('Quiz questions value:', quiz.questions);
      
      if (typeof quiz.questions === 'string') {
        questions = JSON.parse(quiz.questions);
      } else if (Array.isArray(quiz.questions)) {
        questions = quiz.questions;
      } else if (typeof quiz.questions === 'object' && quiz.questions !== null) {
        // If it's already an object but not an array, it might be a parsed JSON
        questions = quiz.questions;
      } else {
        throw new Error('Invalid questions format');
      }
      
      console.log('Parsed questions count:', questions.length);
    } catch (parseError) {
      console.error('Error parsing quiz questions:', parseError);
      console.error('Raw questions value:', quiz.questions);
      return res.status(500).json({ 
        message: 'Quiz data is corrupted',
        debug: process.env.NODE_ENV === 'development' ? {
          error: parseError.message,
          dataType: typeof quiz.questions,
          rawData: quiz.questions
        } : undefined
      });
    }

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
      return res.status(403).json({ 
        message: 'Maximum attempts reached',
        attempts_used: attemptCount,
        max_attempts: quiz.attempts_allowed
      });
    }

    // Validate time limit if set
    if (quiz.time_limit && time_taken && time_taken > (quiz.time_limit * 60)) {
      return res.status(400).json({ 
        message: 'Quiz submitted after time limit',
        time_limit: quiz.time_limit,
        time_taken: Math.round(time_taken / 60)
      });
    }

    // Validate answers against questions
    const validQuestionIds = questions.map(q => q.id).filter(id => id !== undefined && id !== null);
    console.log('Valid question IDs:', validQuestionIds);
    console.log('Submitted answers:', answers.map(a => ({ question_id: a.question_id, answer: a.answer })));
    
    for (const answer of answers) {
      if (!validQuestionIds.includes(answer.question_id)) {
        console.error(`Invalid question ID submitted: ${answer.question_id}`);
        console.error('Valid question IDs are:', validQuestionIds);
        return res.status(400).json({ 
          message: `Invalid question ID: ${answer.question_id}`,
          valid_question_ids: validQuestionIds
        });
      }
    }

    // Auto-grade the quiz
    let totalScore = 0;
    let maxScore = 0;
    const gradedAnswers = [];

    console.log('🎯 Starting auto-grading process...');
    
    for (const question of questions) {
      try {
        const studentAnswer = answers.find(a => a.question_id === question.id);
        const questionPoints = question.points || 1; // Default to 1 point if not specified
        maxScore += questionPoints;

        let isCorrect = false;
        let pointsEarned = 0;

        console.log(`Grading question ${question.id}: "${question.question.substring(0, 50)}..."`);

        if (studentAnswer && studentAnswer.answer !== null && studentAnswer.answer !== '') {
          if (question.type === 'multiple_choice' || question.type === 'true_false') {
            // Auto-grade multiple choice and true/false
            isCorrect = studentAnswer.answer.toString().trim().toLowerCase() === 
                       question.correct_answer.toString().trim().toLowerCase();
            pointsEarned = isCorrect ? questionPoints : 0;
            totalScore += pointsEarned;
            console.log(`✅ Auto-graded: ${isCorrect ? 'Correct' : 'Incorrect'} (${pointsEarned}/${questionPoints} points)`);
          } else if (question.type === 'short_answer') {
            // Store short answers for manual grading
            isCorrect = null; // Will be manually graded
            pointsEarned = 0; // Will be awarded after manual grading
            console.log(`📝 Short answer queued for manual grading`);
          }
        } else {
          console.log(`❌ No answer provided for question ${question.id}`);
        }

        gradedAnswers.push({
          question_id: question.id,
          question_text: question.question,
          question_type: question.type,
          student_answer: studentAnswer ? studentAnswer.answer : null,
          correct_answer: question.correct_answer,
          is_correct: isCorrect,
          points_earned: pointsEarned,
          points_possible: questionPoints,
          needs_manual_grading: question.type === 'short_answer'
        });
        
      } catch (questionError) {
        console.error(`❌ Error grading question ${question.id}:`, questionError);
        // Still add the question to gradedAnswers with zero points
        gradedAnswers.push({
          question_id: question.id,
          question_text: question.question || 'Question text unavailable',
          question_type: question.type || 'unknown',
          student_answer: null,
          correct_answer: question.correct_answer || '',
          is_correct: false,
          points_earned: 0,
          points_possible: question.points || 1,
          needs_manual_grading: true,
          error: questionError.message
        });
        maxScore += (question.points || 1);
      }
    }

    // Determine submission status
    const hasShortAnswers = questions.some(q => q.type === 'short_answer');
    const submissionStatus = hasShortAnswers ? 'pending_review' : 'graded';

    // Store submission with comprehensive debugging
    console.log('📝 Attempting to store submission...');
    console.log('Submission data validation:', {
      taskId: taskId,
      taskIdType: typeof taskId,
      userId: user.id,
      userIdType: typeof user.id,
      gradedAnswersLength: gradedAnswers.length,
      gradedAnswersValid: Array.isArray(gradedAnswers),
      totalScore: totalScore,
      totalScoreType: typeof totalScore,
      maxScore: maxScore,
      maxScoreType: typeof maxScore,
      submissionStatus: submissionStatus,
      nextAttempt: nextAttempt,
      nextAttemptType: typeof nextAttempt,
      timeTaken: time_taken,
      timeTakenType: typeof time_taken
    });

    // First, check if submissions table exists
    console.log('🔍 Checking submissions table...');
    try {
      const tableCheck = await db.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_name = 'submissions' AND table_schema = 'public'
      `);
      
      if (tableCheck.rows.length === 0) {
        console.error('❌ CRITICAL: submissions table does not exist!');
        return res.status(500).json({ 
          success: false,
          message: 'Database configuration error: submissions table missing',
          error: 'submissions_table_missing'
        });
      }
      console.log('✅ Submissions table exists');
    } catch (tableError) {
      console.error('❌ Error checking table:', tableError);
      return res.status(500).json({ 
        success: false,
        message: 'Database access error',
        error: 'database_access_error'
      });
    }

    // Check for existing submission with same attempt number
    console.log('🔍 Checking for duplicate submissions...');
    try {
      const duplicateCheck = await db.query(`
        SELECT id, attempt_number FROM submissions 
        WHERE task_id = $1 AND student_id = $2 AND attempt_number = $3
      `, [taskId, user.id, nextAttempt]);
      
      if (duplicateCheck.rows.length > 0) {
        console.log('⚠️ Duplicate submission detected:', duplicateCheck.rows[0]);
        return res.status(400).json({ 
          success: false,
          message: 'Submission already exists for this attempt',
          error: 'duplicate_submission'
        });
      }
      console.log('✅ No duplicate submissions found');
    } catch (dupError) {
      console.error('❌ Error checking duplicates:', dupError);
    }
    
    let submission;
    try {
      console.log('📤 Executing INSERT query...');
      const submissionResult = await db.query(`
        INSERT INTO submissions (
          task_id, student_id, quiz_answers, score, max_score, 
          status, attempt_number
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, score, max_score, submitted_at, status
      `, [
        parseInt(taskId),
        parseInt(user.id),
        JSON.stringify(gradedAnswers),
        parseFloat(totalScore),
        parseFloat(maxScore),
        submissionStatus,
        parseInt(nextAttempt)
      ]);

      console.log('✅ Submission stored successfully:', {
        id: submissionResult.rows[0].id,
        score: submissionResult.rows[0].score,
        max_score: submissionResult.rows[0].max_score,
        status: submissionResult.rows[0].status,
        submitted_at: submissionResult.rows[0].submitted_at
      });
      
      submission = submissionResult.rows[0];

    } catch (dbError) {
      console.error('❌ Database insertion error:', {
        message: dbError.message,
        code: dbError.code,
        detail: dbError.detail,
        hint: dbError.hint,
        constraint: dbError.constraint,
        table: dbError.table,
        column: dbError.column,
        position: dbError.position,
        file: dbError.file,
        line: dbError.line,
        routine: dbError.routine
      });
      
      // Provide specific error handling
      if (dbError.code === '23503') { // Foreign key violation
        return res.status(400).json({ 
          success: false,
          message: 'Invalid task or student reference',
          error: 'foreign_key_violation',
          details: dbError.detail
        });
      } else if (dbError.code === '23505') { // Unique violation
        return res.status(400).json({ 
          success: false,
          message: 'Duplicate submission detected',
          error: 'unique_violation',
          details: dbError.detail
        });
      } else if (dbError.code === '42P01') { // Table does not exist
        return res.status(500).json({ 
          success: false,
          message: 'Database schema error',
          error: 'table_missing',
          details: 'Submissions table not found'
        });
      }
      
      throw dbError;
    }

    // Prepare response
    console.log('📤 Preparing response...');
    const response = {
      message: 'Quiz submitted successfully',
      submission: {
        id: submission.id,
        score: submission.score,
        max_score: submission.max_score,
        percentage: submission.max_score > 0 ? Math.round((submission.score / submission.max_score) * 100) : 0,
        submitted_at: submission.submitted_at,
        attempt_number: nextAttempt,
        status: submission.status,
        needs_manual_grading: hasShortAnswers
      }
    };

    // Include detailed results if enabled and quiz is fully auto-graded
    if (quiz.show_results && !hasShortAnswers) {
      response.results = gradedAnswers.map(answer => ({
        question_id: answer.question_id,
        question_text: answer.question_text,
        student_answer: answer.student_answer,
        correct_answer: answer.correct_answer,
        is_correct: answer.is_correct,
        points_earned: answer.points_earned,
        points_possible: answer.points_possible,
        explanation: questions.find(q => q.id === answer.question_id)?.explanation
      }));
    }

    res.json(response);

  } catch (error) {
    console.error('Submit quiz error:', error);
    console.error('Error stack:', error.stack);
    
    // Provide more specific error messages
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ 
        success: false,
        message: 'Quiz already submitted for this attempt' 
      });
    }
    
    if (error.code === '22P02') { // Invalid input syntax
      return res.status(400).json({ 
        success: false,
        message: 'Invalid data format in submission' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Server error submitting quiz',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get quiz results (for teachers) - Enhanced with submission tracking
router.get('/:taskId/results', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    
    console.log('=== QUIZ RESULTS DEBUG ===');
    console.log('TaskId:', taskId);
    console.log('User:', req.user ? `${req.user.id} (${req.user.email})` : 'No user');

    // Get quiz details
    console.log('📊 Fetching quiz details...');
    const quizResult = await db.query(`
      SELECT q.*, t.title, t.description, t.due_date, t.max_points, t.grade_id, t.class_id,
             g.name as grade_name, c.name as class_name
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE q.task_id = $1
    `, [taskId]);

    console.log('Quiz query returned:', quizResult.rows.length, 'rows');

    if (quizResult.rows.length === 0) {
      console.log('❌ Quiz not found');
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];
    console.log('Quiz found:', {
      id: quiz.id,
      title: quiz.title,
      grade_id: quiz.grade_id,
      class_id: quiz.class_id
    });
    
    let questions;
    try {
      console.log('Quiz questions type:', typeof quiz.questions);
      console.log('Quiz questions value preview:', JSON.stringify(quiz.questions).substring(0, 200) + '...');
      
      if (typeof quiz.questions === 'string') {
        questions = JSON.parse(quiz.questions);
      } else if (Array.isArray(quiz.questions)) {
        questions = quiz.questions;
      } else if (typeof quiz.questions === 'object' && quiz.questions !== null) {
        // If it's already an object but not an array, it might be a parsed JSON
        questions = quiz.questions;
      } else {
        throw new Error('Invalid questions format');
      }
      
      console.log('✅ Questions parsed successfully:', questions.length, 'questions');
    } catch (parseError) {
      console.error('❌ Error parsing quiz questions:', parseError);
      console.error('Raw questions value:', quiz.questions);
      return res.status(500).json({ 
        message: 'Quiz data is corrupted',
        debug: process.env.NODE_ENV === 'development' ? {
          error: parseError.message,
          dataType: typeof quiz.questions,
          rawData: quiz.questions
        } : undefined
      });
    }

    // Get all students in the grade/class
    console.log('👥 Fetching students...');
    const studentsResult = await db.query(`
      SELECT id, student_number, first_name, last_name, email
      FROM users 
      WHERE role = 'student' AND grade_id = $1 AND class_id = $2 AND is_active = true
      ORDER BY last_name, first_name
    `, [quiz.grade_id, quiz.class_id]);

    const allStudents = studentsResult.rows;
    console.log('Students found:', allStudents.length);

    // Get all submissions for this quiz
    console.log('📋 Fetching submissions...');
    const submissionsResult = await db.query(`
      SELECT s.*, u.student_number, u.first_name, u.last_name, u.email
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
      ORDER BY u.last_name, u.first_name, s.attempt_number DESC
    `, [taskId]);

    console.log('Submissions found:', submissionsResult.rows.length);
    
    const submissions = submissionsResult.rows.map(sub => {
      try {
        return {
          ...sub,
          quiz_answers: sub.quiz_answers || [],
          percentage: sub.max_score > 0 ? Math.round((sub.score / sub.max_score) * 100) : 0
        };
      } catch (mapError) {
        console.error('Error processing submission:', sub.id, mapError);
        return {
          ...sub,
          quiz_answers: [],
          percentage: 0
        };
      }
    });

    // Identify students who haven't submitted
    const submittedStudentIds = new Set(submissions.map(s => s.student_id));
    const studentsNotSubmitted = allStudents.filter(student => !submittedStudentIds.has(student.id));

    // Calculate detailed statistics
    const scores = submissions.map(s => s.score);
    const percentages = submissions.map(s => s.percentage);
    
    const stats = {
      total_students: allStudents.length,
      submitted_count: submittedStudentIds.size,
      not_submitted_count: studentsNotSubmitted.length,
      submission_rate: allStudents.length > 0 ? Math.round((submittedStudentIds.size / allStudents.length) * 100) : 0,
      average_score: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0,
      average_percentage: percentages.length > 0 ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length) : 0,
      highest_score: scores.length > 0 ? Math.max(...scores) : 0,
      lowest_score: scores.length > 0 ? Math.min(...scores) : 0,
      highest_percentage: percentages.length > 0 ? Math.max(...percentages) : 0,
      lowest_percentage: percentages.length > 0 ? Math.min(...percentages) : 0,
      pass_rate: submissions.length > 0 ? Math.round((submissions.filter(s => s.percentage >= 60).length / submissions.length) * 100) : 0
    };

    // Group submissions by student (latest attempt first)
    const submissionsByStudent = {};
    submissions.forEach(sub => {
      if (!submissionsByStudent[sub.student_id]) {
        submissionsByStudent[sub.student_id] = [];
      }
      submissionsByStudent[sub.student_id].push(sub);
    });

    console.log('📊 Calculating statistics...');
    res.json({
      quiz: {
        id: quiz.id,
        task_id: quiz.task_id,
        title: quiz.title,
        description: quiz.description,
        due_date: quiz.due_date,
        max_points: quiz.max_points,
        grade_name: quiz.grade_name,
        class_name: quiz.class_name,
        time_limit: quiz.time_limit,
        attempts_allowed: quiz.attempts_allowed,
        questions: questions
      },
      submissions: submissionsByStudent,
      students_not_submitted: studentsNotSubmitted,
      statistics: stats
    });
    
    console.log('✅ Quiz results sent successfully');

  } catch (error) {
    console.error('❌ Get quiz results error:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      taskId: req.params.taskId
    });
    res.status(500).json({ 
      message: 'Server error fetching quiz results',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get quiz submission analytics for teachers
router.get('/:taskId/analytics', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;

    // Get quiz details and questions
    const quizResult = await db.query(`
      SELECT q.questions, t.title, t.max_points
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1
    `, [taskId]);

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];
    
    let questions;
    try {
      console.log('Analytics - Quiz questions type:', typeof quiz.questions);
      
      if (typeof quiz.questions === 'string') {
        questions = JSON.parse(quiz.questions);
      } else if (Array.isArray(quiz.questions)) {
        questions = quiz.questions;
      } else if (typeof quiz.questions === 'object' && quiz.questions !== null) {
        questions = quiz.questions;
      } else {
        throw new Error('Invalid questions format');
      }
    } catch (parseError) {
      console.error('Error parsing quiz questions in analytics:', parseError);
      return res.status(500).json({ message: 'Quiz data is corrupted' });
    }

    // Get all submissions
    const submissionsResult = await db.query(`
      SELECT quiz_answers, score, max_score
      FROM submissions
      WHERE task_id = $1 AND quiz_answers IS NOT NULL
    `, [taskId]);

    const submissions = submissionsResult.rows;

    // Analyze question performance
    const questionAnalytics = questions.map(question => {
      let correctCount = 0;
      let totalAnswered = 0;
      const answerDistribution = {};

      submissions.forEach(submission => {
        const answers = submission.quiz_answers || [];
        const studentAnswer = answers.find(a => a.question_id === question.id);
        
        if (studentAnswer && studentAnswer.student_answer !== null) {
          totalAnswered++;
          
          // Count answer distribution
          const answer = studentAnswer.student_answer;
          answerDistribution[answer] = (answerDistribution[answer] || 0) + 1;
          
          // Count correct answers
          if (studentAnswer.is_correct) {
            correctCount++;
          }
        }
      });

      return {
        question_id: question.id,
        question_text: question.question,
        question_type: question.type,
        correct_answer: question.correct_answer,
        total_answered: totalAnswered,
        correct_count: correctCount,
        incorrect_count: totalAnswered - correctCount,
        accuracy_rate: totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0,
        answer_distribution: answerDistribution
      };
    });

    res.json({
      quiz_title: quizResult.rows[0].title,
      total_submissions: submissions.length,
      question_analytics: questionAnalytics,
      overall_performance: {
        average_score: submissions.length > 0 ? 
          (submissions.reduce((sum, s) => sum + s.score, 0) / submissions.length).toFixed(2) : 0,
        average_percentage: submissions.length > 0 ? 
          Math.round(submissions.reduce((sum, s) => sum + (s.score / s.max_score * 100), 0) / submissions.length) : 0
      }
    });

  } catch (error) {
    console.error('Get quiz analytics error:', error);
    res.status(500).json({ message: 'Server error fetching quiz analytics' });
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

// Manual grading route for short answer questions
router.put('/:taskId/submissions/:submissionId/grade', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('question_grades').isArray().withMessage('Question grades must be an array'),
  body('question_grades.*.question_id').isInt().withMessage('Question ID is required'),
  body('question_grades.*.points_awarded').isNumeric().withMessage('Points awarded must be a number'),
  body('question_grades.*.feedback').optional().isString().withMessage('Feedback must be a string'),
  body('overall_feedback').optional().isString().withMessage('Overall feedback must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { taskId, submissionId } = req.params;
    const { question_grades, overall_feedback } = req.body;
    const user = req.user;

    // Get submission and quiz details
    const submissionResult = await db.query(`
      SELECT s.*, t.grade_id, t.class_id, t.max_points, q.questions
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN quizzes q ON q.task_id = t.id
      WHERE s.id = $1 AND s.task_id = $2
    `, [submissionId, taskId]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];
    const questions = JSON.parse(submission.questions);

    // Check teacher permissions
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, submission.grade_id, submission.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }

    // Get current quiz answers
    let quizAnswers = submission.quiz_answers || [];
    let totalScore = 0;

    // Update grades for specified questions
    const gradeMap = {};
    question_grades.forEach(grade => {
      gradeMap[grade.question_id] = grade;
    });

    // Update the quiz answers with manual grades
    quizAnswers = quizAnswers.map(answer => {
      const grade = gradeMap[answer.question_id];
      
      if (grade) {
        // Validate points don't exceed maximum for this question
        const question = questions.find(q => q.id === answer.question_id);
        const maxPoints = question ? question.points : answer.points_possible;
        
        if (grade.points_awarded > maxPoints) {
          throw new Error(`Points awarded (${grade.points_awarded}) cannot exceed maximum points (${maxPoints}) for question ${answer.question_id}`);
        }

        answer.points_earned = grade.points_awarded;
        answer.is_correct = grade.points_awarded > 0;
        answer.teacher_feedback = grade.feedback || '';
        answer.manually_graded = true;
        answer.graded_by = user.id;
        answer.graded_at = new Date().toISOString();
      }

      totalScore += answer.points_earned || 0;
      return answer;
    });

    // Update submission with new grades
    const updateResult = await db.query(`
      UPDATE submissions 
      SET quiz_answers = $1, score = $2, feedback = $3, status = 'graded', 
          graded_at = CURRENT_TIMESTAMP, graded_by = $4
      WHERE id = $5
      RETURNING id, score, max_score, status, graded_at
    `, [
      JSON.stringify(quizAnswers),
      totalScore,
      overall_feedback || submission.feedback,
      user.id,
      submissionId
    ]);

    const updatedSubmission = updateResult.rows[0];

    res.json({
      message: 'Quiz graded successfully',
      submission: {
        ...updatedSubmission,
        percentage: updatedSubmission.max_score > 0 ? 
          Math.round((updatedSubmission.score / updatedSubmission.max_score) * 100) : 0
      },
      graded_questions: question_grades.length
    });

  } catch (error) {
    console.error('Manual grading error:', error);
    if (error.message.includes('Points awarded')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error grading quiz' });
  }
});

// Get pending submissions for manual grading
router.get('/:taskId/pending-grades', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;

    // Get quiz questions to check for short answer types
    const quizResult = await db.query(`
      SELECT q.questions, t.title, t.grade_id, t.class_id
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1
    `, [taskId]);

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];
    const questions = JSON.parse(quiz.questions);
    const shortAnswerQuestions = questions.filter(q => q.type === 'short_answer');

    if (shortAnswerQuestions.length === 0) {
      return res.json({
        message: 'No short answer questions in this quiz',
        pending_submissions: []
      });
    }

    // Get submissions that need manual grading
    const pendingResult = await db.query(`
      SELECT s.id, s.quiz_answers, s.score, s.max_score, s.submitted_at,
             u.id as student_id, u.student_number, u.first_name, u.last_name
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1 AND s.status IN ('pending_review', 'submitted')
      ORDER BY s.submitted_at ASC
    `, [taskId]);

    const pendingSubmissions = pendingResult.rows.map(sub => {
      const quizAnswers = sub.quiz_answers || [];
      const shortAnswers = quizAnswers.filter(answer => 
        shortAnswerQuestions.some(q => q.id === answer.question_id)
      );

      return {
        submission_id: sub.id,
        student: {
          id: sub.student_id,
          student_number: sub.student_number,
          name: `${sub.first_name} ${sub.last_name}`
        },
        submitted_at: sub.submitted_at,
        current_score: sub.score,
        max_score: sub.max_score,
        short_answers: shortAnswers.map(answer => {
          const question = shortAnswerQuestions.find(q => q.id === answer.question_id);
          return {
            question_id: answer.question_id,
            question_text: question?.question,
            student_answer: answer.student_answer,
            points_possible: answer.points_possible,
            current_points: answer.points_earned || 0,
            is_graded: answer.manually_graded || false
          };
        })
      };
    });

    res.json({
      quiz_title: quiz.title,
      short_answer_questions: shortAnswerQuestions.length,
      pending_submissions: pendingSubmissions,
      total_pending: pendingSubmissions.length
    });

  } catch (error) {
    console.error('Get pending grades error:', error);
    res.status(500).json({ message: 'Server error fetching pending grades' });
  }
});

// Update quiz (edit existing quiz)
router.put('/:taskId', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task'),
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('due_date').optional().isISO8601().withMessage('Valid due date is required'),
  body('questions').optional().isArray({ min: 1 }).withMessage('At least one question is required'),
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

    const { taskId } = req.params;
    const updateData = req.body;
    const user = req.user;

    // Get current quiz details
    const currentQuizResult = await db.query(`
      SELECT q.*, t.title, t.description, t.due_date, t.max_points, t.grade_id, t.class_id
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      WHERE q.task_id = $1
    `, [taskId]);

    if (currentQuizResult.rows.length === 0) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const currentQuiz = currentQuizResult.rows[0];

    // Check if there are any submissions
    const submissionCheck = await db.query(`
      SELECT COUNT(*) as submission_count FROM submissions WHERE task_id = $1
    `, [taskId]);

    const hasSubmissions = parseInt(submissionCheck.rows[0].submission_count) > 0;

    // Restrict certain updates if quiz has submissions
    if (hasSubmissions && updateData.questions) {
      return res.status(400).json({ 
        message: 'Cannot modify questions after students have submitted answers' 
      });
    }

    // Start transaction
    await db.query('BEGIN');

    try {
      // Update task details if provided
      if (updateData.title || updateData.description || updateData.due_date) {
        const taskUpdates = [];
        const taskParams = [];
        let paramCount = 0;

        if (updateData.title) {
          taskUpdates.push(`title = $${++paramCount}`);
          taskParams.push(updateData.title);
        }
        if (updateData.description !== undefined) {
          taskUpdates.push(`description = $${++paramCount}`);
          taskParams.push(updateData.description);
        }
        if (updateData.due_date) {
          taskUpdates.push(`due_date = $${++paramCount}`);
          taskParams.push(updateData.due_date);
        }

        taskUpdates.push(`updated_at = CURRENT_TIMESTAMP`);
        taskParams.push(taskId);

        await db.query(`
          UPDATE tasks SET ${taskUpdates.join(', ')}
          WHERE id = $${taskParams.length}
        `, taskParams);
      }

      // Update quiz details if provided
      const quizUpdates = [];
      const quizParams = [];
      let paramCount = 0;

      if (updateData.questions) {
        // Process and validate questions
        const processedQuestions = updateData.questions.map((q, index) => ({
          id: index + 1,
          question: q.question.trim(),
          type: q.type,
          options: q.type === 'multiple_choice' ? q.options : [],
          correct_answer: q.correct_answer.toString().trim(),
          points: q.points || 1,
          explanation: q.explanation?.trim() || ''
        }));

        quizUpdates.push(`questions = $${++paramCount}`);
        quizParams.push(JSON.stringify(processedQuestions));

        // Update max_points in task
        const newTotalPoints = processedQuestions.reduce((sum, q) => sum + q.points, 0);
        await db.query(`UPDATE tasks SET max_points = $1 WHERE id = $2`, [newTotalPoints, taskId]);
      }

      if (updateData.time_limit !== undefined) {
        quizUpdates.push(`time_limit = $${++paramCount}`);
        quizParams.push(updateData.time_limit);
      }
      if (updateData.attempts_allowed) {
        quizUpdates.push(`attempts_allowed = $${++paramCount}`);
        quizParams.push(updateData.attempts_allowed);
      }
      if (updateData.show_results !== undefined) {
        quizUpdates.push(`show_results = $${++paramCount}`);
        quizParams.push(updateData.show_results);
      }
      if (updateData.randomize_questions !== undefined) {
        quizUpdates.push(`randomize_questions = $${++paramCount}`);
        quizParams.push(updateData.randomize_questions);
      }

      if (quizUpdates.length > 0) {
        quizUpdates.push(`updated_at = CURRENT_TIMESTAMP`);
        quizParams.push(taskId);

        await db.query(`
          UPDATE quizzes SET ${quizUpdates.join(', ')}
          WHERE task_id = $${quizParams.length}
        `, quizParams);
      }

      await db.query('COMMIT');

      // Get updated quiz
      const updatedQuizResult = await db.query(`
        SELECT q.*, t.title, t.description, t.due_date, t.max_points
        FROM quizzes q
        JOIN tasks t ON q.task_id = t.id
        WHERE q.task_id = $1
      `, [taskId]);

      const updatedQuiz = updatedQuizResult.rows[0];

      res.json({
        message: 'Quiz updated successfully',
        quiz: {
          ...updatedQuiz,
          questions: JSON.parse(updatedQuiz.questions)
        },
        has_submissions: hasSubmissions
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ message: 'Server error updating quiz' });
  }
});

module.exports = router;
