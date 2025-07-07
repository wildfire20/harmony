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

    // Check if teacher is assigned to this grade/class
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, task.grade_id, task.class_id]);

      console.log('Teacher assignment check for submissions:', {
        teacher_id: user.id,
        task_grade_id: task.grade_id,
        task_class_id: task.class_id,
        assignments_found: assignmentCheck.rows.length,
        task_created_by: task.created_by
      });

      // Allow if teacher created the task OR is assigned to the grade/class
      if (assignmentCheck.rows.length === 0 && task.created_by !== user.id) {
        console.log('Teacher not assigned and did not create task, denying submissions access');
        
        // For debugging, let's get all teacher assignments
        const allAssignments = await db.query(`
          SELECT grade_id, class_id FROM teacher_assignments WHERE teacher_id = $1
        `, [user.id]);
        
        console.log('Teacher all assignments:', allAssignments.rows);
        
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You can only view submissions for tasks in your assigned grades/classes.',
          debug: {
            teacher_id: user.id,
            task_grade: task.grade_id,
            task_class: task.class_id,
            teacher_assignments: allAssignments.rows,
            task_created_by: task.created_by
          }
        });
      } else {
        console.log('Teacher access granted - either assigned or created the task');
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

// Get all students for a task's grade/class (to show who hasn't submitted)
router.get('/task/:taskId/students', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== GET TASK STUDENTS ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Task ID:', taskId);

    // Get task details first
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1 AND t.is_active = true
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Task not found' 
      });
    }

    const task = taskResult.rows[0];
    console.log('Task details:', task);

    // Check authorization for teachers
    if (user.role === 'teacher') {
      // First check if teacher created this task - if so, allow access regardless of assignments
      if (task.created_by === user.id) {
        console.log('Teacher created this task, granting full access');
      } else {
        // If teacher didn't create the task, check assignments
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, task.grade_id, task.class_id]);

        console.log('Teacher assignment check:', {
          teacher_id: user.id,
          task_grade_id: task.grade_id,
          task_class_id: task.class_id,
          assignments_found: assignmentCheck.rows.length,
          task_created_by: task.created_by
        });

        if (assignmentCheck.rows.length === 0) {
          console.log('Teacher not assigned and did not create task, denying access');
          
          // For debugging, let's get all teacher assignments
          const allAssignments = await db.query(`
            SELECT grade_id, class_id FROM teacher_assignments WHERE teacher_id = $1
          `, [user.id]);
          
          console.log('Teacher all assignments:', allAssignments.rows);
          
          return res.status(403).json({ 
            success: false,
            message: 'Access denied. You can only view students for tasks in your assigned grades/classes.',
            debug: {
              teacher_id: user.id,
              task_grade: task.grade_id,
              task_class: task.class_id,
              teacher_assignments: allAssignments.rows,
              task_created_by: task.created_by
            }
          });
        }
      }
      
      console.log('Teacher access granted - either assigned or created the task');
    }

    // Debug: First check how many students exist in this grade/class
    const studentCountResult = await db.query(`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role = 'student' 
        AND CAST(grade_id AS INTEGER) = CAST($1 AS INTEGER)
        AND CAST(class_id AS INTEGER) = CAST($2 AS INTEGER)
        AND is_active = true
    `, [task.grade_id, task.class_id]);

    console.log('Student count in grade/class:', studentCountResult.rows[0]?.count);

    // Debug: Get all students to see the data
    const allStudentsResult = await db.query(`
      SELECT id, first_name, last_name, grade_id, class_id, is_active
      FROM users 
      WHERE role = 'student' AND is_active = true
      ORDER BY grade_id, class_id, last_name
    `);

    console.log('All active students:', allStudentsResult.rows);

    // Get all students in this grade/class with their submission status
    // Try with explicit casting to handle potential data type mismatches
    const studentsResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number,
             s.id as submission_id, s.status as submission_status, 
             s.submitted_at, s.score, s.max_score
      FROM users u
      LEFT JOIN submissions s ON u.id = s.student_id AND s.task_id = $1
      WHERE u.role = 'student' 
        AND CAST(u.grade_id AS INTEGER) = CAST($2 AS INTEGER)
        AND CAST(u.class_id AS INTEGER) = CAST($3 AS INTEGER)
        AND u.is_active = true
      ORDER BY u.last_name, u.first_name
    `, [taskId, task.grade_id, task.class_id]);

    console.log('Students query result:', studentsResult.rows.length);
    
    // If still no students, let's try a different approach
    if (studentsResult.rows.length === 0) {
      console.log('No students found with exact match, trying alternative approaches...');
      
      // Try without casting in case the data types are different
      const studentsResult2 = await db.query(`
        SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
               s.id as submission_id, s.status as submission_status, 
               s.submitted_at, s.score, s.max_score
        FROM users u
        LEFT JOIN submissions s ON u.id = s.student_id AND s.task_id = $1
        WHERE u.role = 'student' 
          AND u.grade_id = $2
          AND u.class_id = $3
          AND u.is_active = true
        ORDER BY u.last_name, u.first_name
      `, [taskId, task.grade_id.toString(), task.class_id.toString()]);
      
      console.log('Students query result (string match):', studentsResult2.rows.length);
      
      if (studentsResult2.rows.length > 0) {
        // Use the second result if it found students
        studentsResult.rows = studentsResult2.rows;
      } else {
        // If still no students, get students in same grade to help debug
        const sameGradeStudents = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id
          FROM users u
          WHERE u.role = 'student' 
            AND u.grade_id = $1
            AND u.is_active = true
          ORDER BY u.class_id, u.last_name, u.first_name
        `, [task.grade_id]);
        
        console.log('Students in same grade (different classes):', sameGradeStudents.rows);
        
        // Let's also get all active students to see what's available
        const allStudents = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id
          FROM users u
          WHERE u.role = 'student' AND u.is_active = true
          ORDER BY u.grade_id, u.class_id, u.last_name, u.first_name
        `);
        
        console.log('All active students:', allStudents.rows);
      }
    }

    // If no students found with exact match, try a broader search for debugging
    if (studentsResult.rows.length === 0) {
      console.log('No students found with exact match, trying broader search...');
      
      // Try finding students in the same grade (any class)
      const gradeStudentsResult = await db.query(`
        SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id
        FROM users u
        WHERE u.role = 'student' 
          AND CAST(u.grade_id AS INTEGER) = CAST($1 AS INTEGER)
          AND u.is_active = true
        ORDER BY u.class_id, u.last_name, u.first_name
      `, [task.grade_id]);
      
      console.log('Students in same grade (any class):', gradeStudentsResult.rows);
    }

    console.log('Students in task grade/class:', studentsResult.rows);
    console.log('✅ Found students:', studentsResult.rows.length);

    res.json({
      success: true,
      data: {
        task,
        students: studentsResult.rows,
        debug: {
          task_grade_id: task.grade_id,
          task_class_id: task.class_id,
          students_found: studentsResult.rows.length,
          total_active_students: allStudentsResult.rows.length
        }
      }
    });

  } catch (error) {
    console.error('Get task students error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching task students',
      error: error.message
    });
  }
});

// Debug endpoint - check student data for task
router.get('/debug/task/:taskId/data', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== DEBUG TASK STUDENT DATA ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Task ID:', taskId);

    // Get task details
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1 AND t.is_active = true
    `, [taskId]);

    // Get all students in the same grade/class
    const allStudentsResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id, u.is_active,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student'
      ORDER BY u.grade_id, u.class_id, u.last_name
    `, []);

    // Get teacher assignments
    const teacherAssignments = await db.query(`
      SELECT ta.teacher_id, ta.grade_id, ta.class_id,
             g.name as grade_name, c.name as class_name
      FROM teacher_assignments ta
      LEFT JOIN grades g ON ta.grade_id = g.id
      LEFT JOIN classes c ON ta.class_id = c.id
      WHERE ta.teacher_id = $1
    `, [user.id]);

    // Get submissions for this task
    const submissions = await db.query(`
      SELECT s.*, u.first_name, u.last_name
      FROM submissions s
      LEFT JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
    `, [taskId]);

    res.json({
      success: true,
      debug: {
        user: {
          id: user.id,
          role: user.role,
          name: `${user.first_name} ${user.last_name}`
        },
        task: taskResult.rows[0] || null,
        allStudents: allStudentsResult.rows,
        teacherAssignments: teacherAssignments.rows,
        submissions: submissions.rows,
        query_details: {
          task_found: taskResult.rows.length > 0,
          total_students: allStudentsResult.rows.length,
          teacher_assignments: teacherAssignments.rows.length,
          submissions_count: submissions.rows.length
        }
      }
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Debug endpoint error',
      error: error.message
    });
  }
});

// Debug endpoint - simple test
router.get('/debug/simple', [
  authenticate
], async (req, res) => {
  try {
    const user = req.user;
    
    // Get basic counts
    const taskCount = await db.query('SELECT COUNT(*) as count FROM tasks WHERE is_active = true');
    const studentCount = await db.query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['student']);
    const teacherCount = await db.query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['teacher']);
    
    res.json({
      success: true,
      user: {
        id: user.id,
        role: user.role,
        name: `${user.first_name} ${user.last_name}`
      },
      stats: {
        tasks: taskCount.rows[0]?.count || 0,
        students: studentCount.rows[0]?.count || 0,
        teachers: teacherCount.rows[0]?.count || 0
      }
    });
  } catch (error) {
    console.error('Simple debug error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Debug error',
      error: error.message
    });
  }
});

// Debug endpoint - create test students for a task
router.post('/debug/task/:taskId/create-students', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    
    // Get task details
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1 AND t.is_active = true
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Task not found' 
      });
    }

    const task = taskResult.rows[0];
    
    // Check if students already exist
    const existingStudents = await db.query(`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role = 'student' 
        AND CAST(grade_id AS INTEGER) = CAST($1 AS INTEGER)
        AND CAST(class_id AS INTEGER) = CAST($2 AS INTEGER)
        AND is_active = true
    `, [task.grade_id, task.class_id]);

    if (existingStudents.rows[0].count > 0) {
      return res.json({
        success: true,
        message: 'Students already exist for this task',
        existing_count: existingStudents.rows[0].count,
        task: task
      });
    }

    // Create 3 test students for this grade/class
    const testStudents = [
      {
        student_number: `TEST001_${task.grade_id}_${task.class_id}`,
        first_name: 'John',
        last_name: 'Doe',
        email: `john.doe.${task.grade_id}.${task.class_id}@harmonylearning.edu`
      },
      {
        student_number: `TEST002_${task.grade_id}_${task.class_id}`,
        first_name: 'Jane',
        last_name: 'Smith',
        email: `jane.smith.${task.grade_id}.${task.class_id}@harmonylearning.edu`
      },
      {
        student_number: `TEST003_${task.grade_id}_${task.class_id}`,
        first_name: 'Bob',
        last_name: 'Johnson',
        email: `bob.johnson.${task.grade_id}.${task.class_id}@harmonylearning.edu`
      }
    ];

    const createdStudents = [];
    
    for (const student of testStudents) {
      const password = await bcrypt.hash(student.student_number, 12);
      
      const result = await db.query(`
        INSERT INTO users (student_number, first_name, last_name, grade_id, class_id, password, role, email, is_active) 
        VALUES ($1, $2, $3, $4, $5, $6, 'student', $7, true)
        RETURNING id, student_number, first_name, last_name, grade_id, class_id
      `, [
        student.student_number,
        student.first_name,
        student.last_name,
        task.grade_id,
        task.class_id,
        password,
        student.email
      ]);

      createdStudents.push(result.rows[0]);
    }

    res.json({
      success: true,
      message: 'Test students created successfully',
      task: task,
      created_students: createdStudents,
      instructions: 'Test students can login with their student number as password'
    });

  } catch (error) {
    console.error('Create test students error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error creating test students',
      error: error.message
    });
  }
});

// Debug endpoint - quick check for task and students
router.get('/debug/quick/:taskId', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== QUICK DEBUG ===');
    console.log('User:', { id: user.id, role: user.role, name: `${user.first_name} ${user.last_name}` });
    console.log('Task ID:', taskId);

    // Get task details
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1
    `, [taskId]);

    const task = taskResult.rows[0];
    console.log('Task:', task);

    // Get teacher assignments
    const teacherAssignments = await db.query(`
      SELECT grade_id, class_id FROM teacher_assignments WHERE teacher_id = $1
    `, [user.id]);
    console.log('Teacher assignments:', teacherAssignments.rows);

    // Get students in the task's grade/class
    const studentsInGradeClass = await db.query(`
      SELECT id, first_name, last_name, grade_id, class_id
      FROM users 
      WHERE role = 'student' 
        AND grade_id = $1
        AND class_id = $2
        AND is_active = true
    `, [task.grade_id, task.class_id]);
    console.log('Students in task grade/class:', studentsInGradeClass.rows);

    // Get submissions for this task
    const submissions = await db.query(`
      SELECT s.id, s.student_id, u.first_name, u.last_name
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
    `, [taskId]);
    console.log('Submissions:', submissions.rows);

    res.json({
      success: true,
      debug: {
        user: { id: user.id, role: user.role, name: `${user.first_name} ${user.last_name}` },
        task,
        teacher_assignments: teacherAssignments.rows,
        students_in_grade_class: studentsInGradeClass.rows,
        submissions: submissions.rows,
        task_created_by_user: task.created_by === user.id
      }
    });

  } catch (error) {
    console.error('Quick debug error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Debug error',
      error: error.message 
    });
  }
});

// Fix teacher assignment for tasks they created
router.post('/debug/fix-teacher-assignment/:taskId', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== FIX TEACHER ASSIGNMENT ===');
    console.log('User:', { id: user.id, role: user.role, name: `${user.first_name} ${user.last_name}` });
    console.log('Task ID:', taskId);

    // Get task details
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const task = taskResult.rows[0];
    console.log('Task:', task);

    // Check if user can perform this action
    if (user.role === 'teacher' && task.created_by !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only fix assignments for tasks you created'
      });
    }

    const teacherId = user.role === 'teacher' ? user.id : task.created_by;

    // Check if teacher is already assigned to this grade/class
    const existingAssignment = await db.query(`
      SELECT 1 FROM teacher_assignments 
      WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
    `, [teacherId, task.grade_id, task.class_id]);

    if (existingAssignment.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Teacher is already assigned to this grade/class',
        assignment_exists: true
      });
    }

    // Add teacher assignment
    await db.query(`
      INSERT INTO teacher_assignments (teacher_id, grade_id, class_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (teacher_id, grade_id, class_id) DO NOTHING
    `, [teacherId, task.grade_id, task.class_id]);

    console.log(`✅ Added teacher assignment: teacher_id=${teacherId}, grade_id=${task.grade_id}, class_id=${task.class_id}`);

    res.json({
      success: true,
      message: 'Teacher assignment added successfully',
      assignment: {
        teacher_id: teacherId,
        grade_id: task.grade_id,
        class_id: task.class_id,
        grade_name: task.grade_name,
        class_name: task.class_name
      }
    });

  } catch (error) {
    console.error('Fix teacher assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fixing teacher assignment',
      error: error.message
    });
  }
});

// Check or create students for a task's grade/class
router.post('/debug/ensure-students/:taskId', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { taskId } = req.params;

    console.log('=== ENSURE STUDENTS FOR TASK ===');
    console.log('Task ID:', taskId);

    // Get task details
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const task = taskResult.rows[0];
    console.log('Task:', task);

    // Check how many students exist in this grade/class
    const studentCount = await db.query(`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role = 'student' 
        AND grade_id = $1
        AND class_id = $2
        AND is_active = true
    `, [task.grade_id, task.class_id]);

    const existingStudents = parseInt(studentCount.rows[0].count);
    console.log('Existing students in grade/class:', existingStudents);

    if (existingStudents > 0) {
      return res.json({
        success: true,
        message: `Grade ${task.grade_name} Class ${task.class_name} already has ${existingStudents} students`,
        existing_students: existingStudents
      });
    }

    // Get the existing student 'kelly kellu' and move them to this grade/class
    const kellyResult = await db.query(`
      SELECT id, first_name, last_name, grade_id, class_id
      FROM users 
      WHERE role = 'student' 
        AND (first_name ILIKE 'kelly' OR student_number LIKE '%kelly%')
        AND is_active = true
      LIMIT 1
    `);

    if (kellyResult.rows.length > 0) {
      const kelly = kellyResult.rows[0];
      console.log('Found kelly:', kelly);

      // Move kelly to the task's grade/class
      await db.query(`
        UPDATE users 
        SET grade_id = $1, class_id = $2
        WHERE id = $3
      `, [task.grade_id, task.class_id, kelly.id]);

      console.log(`✅ Moved kelly (ID: ${kelly.id}) to grade ${task.grade_id}, class ${task.class_id}`);

      res.json({
        success: true,
        message: `Successfully moved kelly kellu to Grade ${task.grade_name} Class ${task.class_name}`,
        student_moved: {
          id: kelly.id,
          name: `${kelly.first_name} ${kelly.last_name}`,
          from_grade: kelly.grade_id,
          from_class: kelly.class_id,
          to_grade: task.grade_id,
          to_class: task.class_id
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Could not find kelly kellu student to move',
        suggestion: 'Create a student in this grade/class manually'
      });
    }

  } catch (error) {
    console.error('Ensure students error:', error);
    res.status(500).json({
      success: false,
      message: 'Error ensuring students for task',
      error: error.message
    });
  }
});

module.exports = router;
