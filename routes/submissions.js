const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'submissions');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|ppt|pptx|xls|xlsx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only certain file types are allowed'));
    }
  }
});

// Submit assignment
router.post('/assignment/:taskId', [
  authenticate,
  authorize('student'),
  upload.single('file'),
  body('content').optional()
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const { content } = req.body;
    const user = req.user;

    // Verify task exists and is an assignment
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.task_type, t.due_date, t.max_points, t.grade_id, t.class_id
      FROM tasks t
      WHERE t.id = $1 AND t.is_active = true AND t.task_type = 'assignment'
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const task = taskResult.rows[0];

    // Check if student has access to this assignment
    if (user.grade_id != task.grade_id || user.class_id != task.class_id) {
      return res.status(403).json({ message: 'Access denied to this assignment' });
    }

    // Check if assignment is past due
    if (task.due_date && new Date() > new Date(task.due_date)) {
      return res.status(400).json({ message: 'Assignment is past due' });
    }

    // Check if student has already submitted (only one submission per assignment)
    const existingSubmission = await db.query(`
      SELECT id FROM submissions 
      WHERE task_id = $1 AND student_id = $2
    `, [taskId, user.id]);

    if (existingSubmission.rows.length > 0) {
      return res.status(400).json({ message: 'Assignment already submitted' });
    }

    // Create submission
    const filePath = req.file ? req.file.path : null;
    
    const result = await db.query(`
      INSERT INTO submissions (task_id, student_id, content, file_path, max_score, status)
      VALUES ($1, $2, $3, $4, $5, 'submitted')
      RETURNING id, content, file_path, status, submitted_at
    `, [taskId, user.id, content, filePath, task.max_points]);

    res.status(201).json({
      message: 'Assignment submitted successfully',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).json({ message: 'Server error submitting assignment' });
  }
});

// Get student's submissions
router.get('/student', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { status, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT s.id, s.content, s.file_path, s.score, s.max_score, s.feedback,
             s.status, s.submitted_at, s.graded_at, s.attempt_number,
             t.id as task_id, t.title, t.task_type, t.due_date,
             g.name as grade_name, c.name as class_name
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE s.student_id = $1
    `;

    const params = [user.id];

    if (status) {
      query += ' AND s.status = $2';
      params.push(status);
    }

    query += ' ORDER BY s.submitted_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({ submissions: result.rows });

  } catch (error) {
    console.error('Get student submissions error:', error);
    res.status(500).json({ message: 'Server error fetching submissions' });
  }
});

// Get submission details
router.get('/:id', [
  authenticate,
  authorizeResourceAccess('submission')
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const result = await db.query(`
      SELECT s.id, s.content, s.file_path, s.quiz_answers, s.score, s.max_score, 
             s.feedback, s.status, s.submitted_at, s.graded_at, s.attempt_number,
             t.id as task_id, t.title, t.description, t.instructions, t.task_type, t.due_date,
             u.student_number, u.first_name, u.last_name,
             g.name as grade_name, c.name as class_name
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN users u ON s.student_id = u.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE s.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = result.rows[0];

    // Parse quiz answers if it's a quiz submission
    if (submission.task_type === 'quiz' && submission.quiz_answers) {
      submission.quiz_answers = JSON.parse(submission.quiz_answers);
    }

    res.json({ submission });

  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ message: 'Server error fetching submission' });
  }
});

// Grade submission (teachers only)
router.put('/:id/grade', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('submission'),
  body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer'),
  body('feedback').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { score, feedback } = req.body;
    const user = req.user;

    // Get submission details
    const submissionResult = await db.query(`
      SELECT s.id, s.max_score, s.student_id, t.grade_id, t.class_id
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id = $1
    `, [id]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];

    // Validate score
    if (score > submission.max_score) {
      return res.status(400).json({ 
        message: `Score cannot exceed maximum score of ${submission.max_score}` 
      });
    }

    // Update submission
    const result = await db.query(`
      UPDATE submissions 
      SET score = $1, feedback = $2, status = 'graded', graded_at = CURRENT_TIMESTAMP, graded_by = $3
      WHERE id = $4
      RETURNING id, score, max_score, feedback, status, graded_at
    `, [score, feedback, user.id, id]);

    res.json({
      message: 'Submission graded successfully',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('Grade submission error:', error);
    res.status(500).json({ message: 'Server error grading submission' });
  }
});

// Return submission to student with feedback
router.put('/:id/return', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('submission'),
  body('feedback').notEmpty().withMessage('Feedback is required when returning submission')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { feedback } = req.body;
    const user = req.user;

    const result = await db.query(`
      UPDATE submissions 
      SET feedback = $1, status = 'returned', graded_at = CURRENT_TIMESTAMP, graded_by = $2
      WHERE id = $3
      RETURNING id, feedback, status, graded_at
    `, [feedback, user.id, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    res.json({
      message: 'Submission returned to student',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('Return submission error:', error);
    res.status(500).json({ message: 'Server error returning submission' });
  }
});

// Download submission file
router.get('/:id/download', [
  authenticate,
  authorizeResourceAccess('submission')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT file_path FROM submissions WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const filePath = result.rows[0].file_path;

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' });
    }

    const fileName = path.basename(filePath);
    res.download(filePath, fileName);

  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ message: 'Server error downloading file' });
  }
});

// Get submissions for a specific task (teacher view)
router.get('/task/:taskId', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.query;

    let query = `
      SELECT s.id, s.content, s.file_path, s.score, s.max_score, s.feedback,
             s.status, s.submitted_at, s.graded_at, s.attempt_number,
             u.id as student_id, u.student_number, u.first_name, u.last_name
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
    `;

    const params = [taskId];

    if (status) {
      query += ' AND s.status = $2';
      params.push(status);
    }

    query += ' ORDER BY s.submitted_at DESC';

    const result = await db.query(query, params);

    // Get task details
    const taskResult = await db.query(`
      SELECT title, task_type, max_points FROM tasks WHERE id = $1
    `, [taskId]);

    res.json({
      submissions: result.rows,
      task: taskResult.rows[0] || null
    });

  } catch (error) {
    console.error('Get task submissions error:', error);
    res.status(500).json({ message: 'Server error fetching task submissions' });
  }
});

module.exports = router;
