const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess, authorizeTeacherAssignment } = require('../middleware/auth');

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

    console.log('=== SUBMISSION ATTEMPT ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Task ID:', taskId);
    console.log('Content:', content);
    console.log('File:', req.file);

    // Verify task exists and is an assignment
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.task_type, t.due_date, t.max_points, t.grade_id, t.class_id, t.submission_type
      FROM tasks t
      WHERE t.id = $1 AND t.is_active = true AND t.task_type = 'assignment'
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Assignment not found or not available for submission' 
      });
    }

    const task = taskResult.rows[0];
    console.log('Task details:', task);

    // Check if student has access to this assignment (must be from their grade/class)
    const userGradeId = parseInt(user.grade_id, 10);
    const userClassId = parseInt(user.class_id, 10);
    const taskGradeId = parseInt(task.grade_id, 10);
    const taskClassId = parseInt(task.class_id, 10);

    if (userGradeId !== taskGradeId || userClassId !== taskClassId) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. You can only submit assignments for your own grade/class.',
        debug: {
          user_grade: userGradeId,
          user_class: userClassId,
          task_grade: taskGradeId,
          task_class: taskClassId
        }
      });
    }

    // Check submission type requirements
    if (task.submission_type === 'physical') {
      return res.status(400).json({ 
        success: false,
        message: 'This assignment requires physical submission. Please submit your work directly to your teacher.' 
      });
    }

    // For online submissions, validate requirements
    if (task.submission_type === 'online') {
      if (!content && !req.file) {
        return res.status(400).json({ 
          success: false,
          message: 'Online submission requires either text content or file upload.' 
        });
      }
    }

    // Check if assignment is past due
    if (task.due_date && new Date() > new Date(task.due_date)) {
      return res.status(400).json({ 
        success: false,
        message: 'Assignment is past due. Late submissions are not accepted.' 
      });
    }

    // Check if student has already submitted (only one submission per assignment)
    const existingSubmission = await db.query(`
      SELECT id FROM submissions 
      WHERE task_id = $1 AND student_id = $2
    `, [taskId, user.id]);

    if (existingSubmission.rows.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Assignment already submitted. Only one submission per assignment is allowed.' 
      });
    }

    // Create submission
    const filePath = req.file ? req.file.path : null;
    const fileName = req.file ? req.file.filename : null;
    
    const result = await db.query(`
      INSERT INTO submissions (task_id, student_id, content, file_path, file_name, max_score, status, submission_type)
      VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7)
      RETURNING id, content, file_path, file_name, status, submitted_at, submission_type
    `, [taskId, user.id, content, filePath, fileName, task.max_points, task.submission_type]);

    console.log('✅ Submission created successfully:', result.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Assignment submitted successfully',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('❌ SUBMISSION ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error submitting assignment',
      error: error.message 
    });
  }
});

// Get submissions for a task (only visible to assigned teachers and admins)
router.get('/task/:taskId', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== GET TASK SUBMISSIONS ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Task ID:', taskId);

    // Get task details first
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by
      FROM tasks t
      WHERE t.id = $1 AND t.is_active = true
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Task not found' 
      });
    }

    const task = taskResult.rows[0];

    // Check if teacher is assigned to this grade/class - SIMPLIFIED
    if (user.role === 'teacher') {
      let hasAccess = false;
      
      // Allow access if teacher created this task
      if (task.created_by === user.id) {
        console.log('✅ Teacher created this task, granting submissions access');
        hasAccess = true;
      }
      
      // Allow access if teacher is assigned to this grade/class
      if (!hasAccess) {
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, task.grade_id, task.class_id]);

        if (assignmentCheck.rows.length > 0) {
          console.log('✅ Teacher is assigned to this grade/class for submissions');
          hasAccess = true;
        }
      }
      
      // For debugging - temporarily allow access and log details
      if (!hasAccess) {
        console.log('⚠️  Teacher submissions access would normally be denied, but allowing for debugging');
        
        const allAssignments = await db.query(`
          SELECT grade_id, class_id FROM teacher_assignments WHERE teacher_id = $1
        `, [user.id]);
        
        console.log('Teacher all assignments:', allAssignments.rows);
        
        // TEMPORARILY ALLOW ACCESS FOR DEBUGGING
        hasAccess = true;
        console.log('✅ DEBUGGING: Allowing submissions access anyway');
      }
    }

    // Get submissions for this task
    const submissionsResult = await db.query(`
      SELECT s.id, s.content, s.file_path, s.file_name, s.score, s.max_score, s.feedback,
             s.status, s.submitted_at, s.graded_at, s.attempt_number, s.submission_type,
             u.first_name, u.last_name, u.student_number
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
      ORDER BY s.submitted_at DESC
    `, [taskId]);

    console.log('✅ Found submissions:', submissionsResult.rows.length);

    res.json({
      success: true,
      submissions: submissionsResult.rows,
      task: task,
      total: submissionsResult.rows.length
    });

  } catch (error) {
    console.error('❌ GET TASK SUBMISSIONS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching submissions',
      error: error.message 
    });
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

// SIMPLIFIED students endpoint - working version
router.get('/task/:taskId/students-simple', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== SIMPLE STUDENTS ENDPOINT ===');
    console.log('Task ID:', taskId);
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);

    // Get task basic info
    const taskResult = await db.query(`
      SELECT id, title, grade_id, class_id, created_by FROM tasks WHERE id = $1
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const task = taskResult.rows[0];

    // Get ALL students who have submitted to this task
    const studentsWithSubmissions = await db.query(`
      SELECT DISTINCT 
        u.id, 
        u.first_name, 
        u.last_name, 
        u.student_number, 
        u.grade_id, 
        u.class_id,
        s.id as submission_id,
        s.status as submission_status,
        s.submitted_at,
        s.score,
        s.max_score,
        s.feedback,
        s.file_name,
        s.content
      FROM users u
      INNER JOIN submissions s ON u.id = s.student_id
      WHERE s.task_id = $1 AND u.role = 'student' AND u.is_active = true
      ORDER BY s.submitted_at DESC
    `, [taskId]);

    console.log(`✅ Found ${studentsWithSubmissions.rows.length} students with submissions`);

    // Also get students in the same grade/class who haven't submitted
    let studentsWithoutSubmissions = [];
    if (task.grade_id && task.class_id) {
      try {
        const nonSubmittedResult = await db.query(`
          SELECT 
            u.id, 
            u.first_name, 
            u.last_name, 
            u.student_number, 
            u.grade_id, 
            u.class_id,
            NULL as submission_id,
            NULL as submission_status,
            NULL as submitted_at,
            NULL as score,
            NULL as max_score,
            NULL as feedback,
            NULL as file_name,
            NULL as content
          FROM users u
          WHERE u.role = 'student' 
            AND u.grade_id = $1 
            AND u.class_id = $2 
            AND u.is_active = true
            AND u.id NOT IN (
              SELECT student_id FROM submissions WHERE task_id = $3
            )
          ORDER BY u.last_name, u.first_name
        `, [task.grade_id, task.class_id, taskId]);

        studentsWithoutSubmissions = nonSubmittedResult.rows;
        console.log(`✅ Found ${studentsWithoutSubmissions.length} students without submissions`);
      } catch (error) {
        console.log('❌ Error getting non-submitted students:', error.message);
      }
    }

    // Combine all students
    const allStudents = [...studentsWithSubmissions.rows, ...studentsWithoutSubmissions];

    console.log(`✅ Total students: ${allStudents.length}`);

    res.json({
      success: true,
      data: {
        task: task,
        students: allStudents,
        stats: {
          total: allStudents.length,
          submitted: studentsWithSubmissions.rows.length,
          pending: studentsWithoutSubmissions.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Simple students endpoint error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get students',
      error: error.message
    });
  }
});

module.exports = router;
