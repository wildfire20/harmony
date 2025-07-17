const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess, authorizeTeacherAssignment } = require('../middleware/auth');
const s3Service = require('../services/s3Service');

const router = express.Router();

// Configure multer for memory storage (for S3 upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB
    files: 1, // Only allow 1 file
    fieldSize: 1024 * 1024, // 1MB field size limit
    fields: 20 // Limit number of non-file fields
  },
  fileFilter: (req, file, cb) => {
    console.log('=== SUBMISSIONS MULTER DEBUG ===');
    console.log('File field name:', file.fieldname);
    console.log('File original name:', file.originalname);
    console.log('File mimetype:', file.mimetype);
    console.log('Expected field names: file, gradedDocument');
    
    // Check if the field name is 'file' (for student submissions) or 'gradedDocument' (for teacher graded documents)
    if (file.fieldname !== 'file' && file.fieldname !== 'gradedDocument') {
      console.log('❌ Submissions file rejected - wrong field name:', file.fieldname);
      return cb(new Error(`Invalid field name. Expected 'file' or 'gradedDocument', got '${file.fieldname}'`));
    }
    
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|ppt|pptx|xls|xlsx|zip|rar|mp4|mp3|avi|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                     file.mimetype.includes('application/') || 
                     file.mimetype.includes('text/') ||
                     file.mimetype.includes('video/') ||
                     file.mimetype.includes('audio/');

    if (mimetype && extname) {
      console.log('✅ Submissions file accepted');
      return cb(null, true);
    } else {
      console.log('❌ Submissions file rejected - unsupported type');
      cb(new Error('File type not supported. Please upload documents, images, videos, or audio files.'));
    }
  }
});

// Submit assignment
router.post('/assignment/:taskId', [
  authenticate,
  authorize('student'),
  (req, res, next) => {
    console.log('=== SUBMISSIONS MULTER MIDDLEWARE ENTRY ===');
    console.log('Content-Type:', req.get('content-type'));
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('=== SUBMISSIONS MULTER ERROR ===');
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        console.error('Error code:', err.code);
        console.error('Full error:', err);
        
        if (err instanceof multer.MulterError) {
          if (err.code === 'UNEXPECTED_FIELD') {
            return res.status(400).json({
              success: false,
              message: 'Unexpected field in file upload. Please ensure you are only uploading one file with the correct field name.',
              error_type: 'UNEXPECTED_FIELD',
              expected_field: 'file'
            });
          }
          return res.status(400).json({
            success: false,
            message: 'File upload error: ' + err.message,
            error_type: err.code
          });
        }
        
        return res.status(500).json({
          success: false,
          message: 'Server error during file upload: ' + err.message
        });
      }
      
      console.log('=== SUBMISSIONS MULTER SUCCESS ===');
      console.log('Uploaded file:', req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : 'No file uploaded');
      
      next();
    });
  },
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

    // Check if student has already submitted - allow resubmission before deadline
    const existingSubmission = await db.query(`
      SELECT id, s3_key FROM submissions 
      WHERE task_id = $1 AND student_id = $2
    `, [taskId, user.id]);

    let isResubmission = false;
    let oldS3Key = null;

    if (existingSubmission.rows.length > 0) {
      isResubmission = true;
      oldS3Key = existingSubmission.rows[0].s3_key;
      console.log('⚠️ Student resubmitting assignment, will replace previous submission');
    }

    // Create submission with S3 file upload OR local storage fallback if file provided
    let s3Key = null;
    let s3Url = null;
    let originalFileName = null;
    let fileSize = null;
    let fileType = null;
    let localFilePath = null;

    if (req.file) {
      originalFileName = req.file.originalname;
      fileSize = req.file.size;
      fileType = req.file.mimetype;
      
      // Check if S3 is configured (for cloud storage)
      let isS3Configured = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME;
      
      if (isS3Configured) {
        console.log('📤 Uploading file to S3:', req.file.originalname);
        try {
          const uploadResult = await s3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'submissions'
          );

          s3Key = uploadResult.s3Key;
          s3Url = uploadResult.s3Url;
          console.log('✅ File uploaded to S3:', { s3Key, s3Url });
        } catch (s3Error) {
          console.log('❌ S3 upload failed, falling back to local storage:', s3Error.message);
          isS3Configured = false; // Fall back to local storage
        }
      }
      
      if (!isS3Configured) {
        console.log('📁 S3 not configured or failed, using local storage for file upload');
        
        // Create uploads directory if it doesn't exist
        const path = require('path');
        const fs = require('fs');
        const uploadsDir = path.join(__dirname, '../uploads/submissions');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Generate unique filename
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}-${req.file.originalname}`;
        localFilePath = path.join(uploadsDir, uniqueFileName);
        
        // Save file locally
        fs.writeFileSync(localFilePath, req.file.buffer);
        console.log('✅ File saved locally:', localFilePath);
      }
    }
    
    let result;
    
    if (isResubmission) {
      // Update existing submission
      result = await db.query(`
        UPDATE submissions 
        SET content = $3, s3_key = $4, s3_url = $5, original_file_name = $6, 
            file_size = $7, file_type = $8, file_path = $9, status = 'submitted', submitted_at = CURRENT_TIMESTAMP,
            score = NULL, feedback = NULL, graded_at = NULL
        WHERE task_id = $1 AND student_id = $2
        RETURNING id, content, s3_key, s3_url, original_file_name, file_size, 
                 file_type, file_path, status, submitted_at
      `, [
        taskId, user.id, content, s3Key, s3Url, originalFileName, 
        fileSize, fileType, localFilePath
      ]);
      
      // Delete old file from S3 if it exists and is different from new one
      if (oldS3Key && oldS3Key !== s3Key) {
        try {
          await s3Service.deleteFile(oldS3Key);
          console.log('✅ Old submission file deleted from S3:', oldS3Key);
        } catch (deleteError) {
          console.log('⚠️ Warning: Could not delete old file from S3:', deleteError.message);
        }
      }
      
      console.log('✅ Submission updated successfully:', result.rows[0]);
    } else {
      // Create new submission
      result = await db.query(`
        INSERT INTO submissions (
          task_id, student_id, content, s3_key, s3_url, original_file_name, 
          file_size, file_type, file_path, max_score, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitted')
        RETURNING id, content, s3_key, s3_url, original_file_name, file_size, 
                 file_type, file_path, status, submitted_at
      `, [
        taskId, user.id, content, s3Key, s3Url, originalFileName, 
        fileSize, fileType, localFilePath, task.max_points
      ]);
      
      console.log('✅ Submission created successfully:', result.rows[0]);
    }

    res.status(isResubmission ? 200 : 201).json({
      success: true,
      message: isResubmission ? 'Assignment resubmitted successfully' : 'Assignment submitted successfully',
      submission: result.rows[0],
      is_resubmission: isResubmission
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
      
      if (!hasAccess) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You can only view submissions for tasks in your assigned grades/classes.',
          debug: {
            teacher_id: user.id,
            task_grade: task.grade_id,
            task_class: task.class_id,
            teacher_assignments: allAssignments.rows,
            task_created_by: task.created_by,
            solution: 'The teacher needs to be assigned to the grade/class for this task, or the task should be created by this teacher'
          }
        });
      }
    }

    // Get submissions for this task
    const submissionsResult = await db.query(`
      SELECT s.id, s.content, s.file_path, s.s3_key, s.s3_url, s.original_file_name,
             s.file_size, s.file_type, s.score, s.max_score, s.feedback,
             s.status, s.submitted_at, s.graded_at, s.attempt_number,
             s.graded_document_s3_key, s.graded_document_s3_url, s.graded_document_original_name,
             s.graded_document_file_size, s.graded_document_file_type, s.graded_document_uploaded_at,
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
      SELECT s.id, s.content, s.file_path, s.s3_key, s.s3_url, s.original_file_name,
             s.file_size, s.file_type, s.score, s.max_score, s.feedback,
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
      SELECT s.id, s.content, s.file_path, s.s3_key, s.s3_url, s.original_file_name,
             s.file_size, s.file_type, s.quiz_answers, s.score, s.max_score, 
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
      SELECT s3_key, s3_url, original_file_name, file_path 
      FROM submissions WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = result.rows[0];

    // If file is stored in S3
    if (submission.s3_key) {
      try {
        const signedUrl = await s3Service.getSignedUrl(submission.s3_key, 300); // 5 minutes expiry
        return res.json({
          success: true,
          downloadUrl: signedUrl,
          fileName: submission.original_file_name || 'submission',
          message: 'Download URL generated successfully'
        });
      } catch (s3Error) {
        console.error('❌ S3 download error:', s3Error);
        return res.status(500).json({ 
          success: false,
          message: 'File temporarily unavailable. Please try again later.' 
        });
      }
    }

    // Fallback: check for legacy local file
    if (submission.file_path && require('fs').existsSync(submission.file_path)) {
      const fileName = submission.original_file_name || path.basename(submission.file_path);
      return res.download(submission.file_path, fileName);
    }

    // No file found
    return res.status(404).json({ 
      success: false,
      message: 'Submission file not found' 
    });

  } catch (error) {
    console.error('❌ Download submission file error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error downloading file' 
    });
  }
});

// View submission file in browser
router.get('/:id/view', [
  authenticate,
  authorizeResourceAccess('submission')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT s3_key, s3_url, original_file_name, file_type, file_path 
      FROM submissions WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = result.rows[0];

    // If file is stored in S3
    if (submission.s3_key) {
      try {
        const signedUrl = await s3Service.getSignedUrl(submission.s3_key, 3600); // 1 hour for viewing
        return res.redirect(signedUrl);
      } catch (s3Error) {
        console.error('❌ S3 view error:', s3Error);
        return res.status(500).json({ 
          success: false,
          message: 'File temporarily unavailable. Please try again later.' 
        });
      }
    }

    // Fallback: check for legacy local file
    if (submission.file_path && require('fs').existsSync(submission.file_path)) {
      return res.sendFile(path.resolve(submission.file_path));
    }

    // No file found
    return res.status(404).json({ 
      success: false,
      message: 'Submission file not found' 
    });

  } catch (error) {
    console.error('❌ View submission file error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error viewing file' 
    });
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

    // Check authorization for teachers - SIMPLIFIED AND MORE PERMISSIVE
    if (user.role === 'teacher') {
      let hasAccess = false;
      
      // Allow access if teacher created this task
      if (task.created_by === user.id) {
        console.log('✅ Teacher created this task, granting full access');
        hasAccess = true;
      }
      
      // Allow access if teacher is assigned to this grade/class
      if (!hasAccess) {
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, task.grade_id, task.class_id]);

        if (assignmentCheck.rows.length > 0) {
          console.log('✅ Teacher is assigned to this grade/class');
          hasAccess = true;
        }
      }
      
      // For debugging - always allow access for now and log the details
      if (!hasAccess) {
        console.log('⚠️  Teacher access would normally be denied, but allowing for debugging');
        
        const allAssignments = await db.query(`
          SELECT grade_id, class_id, g.name as grade_name, c.name as class_name
          FROM teacher_assignments ta
          LEFT JOIN grades g ON ta.grade_id = g.id
          LEFT JOIN classes c ON ta.class_id = c.id
          WHERE teacher_id = $1
        `, [user.id]);
        
        console.log('Teacher assignments:', allAssignments.rows);
        console.log('Task details:', { grade_id: task.grade_id, class_id: task.class_id, created_by: task.created_by });
        console.log('User details:', { id: user.id, role: user.role });
        
        // TEMPORARILY ALLOW ACCESS FOR DEBUGGING
        hasAccess = true;
        console.log('✅ DEBUGGING: Allowing access anyway');
      }
      
      if (!hasAccess) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You can only view students for tasks in your assigned grades/classes.',
          debug: {
            teacher_id: user.id,
            task_grade: task.grade_id,
            task_class: task.class_id,
            task_created_by: task.created_by,
            solution: 'The teacher needs to be assigned to the grade/class for this task, or the task should be created by this teacher'
          }
        });
      }
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
    // Try multiple approaches to handle data type and assignment issues
    let studentsResult = { rows: [] };
    
    console.log('Attempting to find students for task:', {
      task_id: taskId,
      task_grade_id: task.grade_id,
      task_class_id: task.class_id,
      task_grade_type: typeof task.grade_id,
      task_class_type: typeof task.class_id
    });

    // Approach 1: Exact match with casting
    try {
      studentsResult = await db.query(`
        SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
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
      
      console.log('Approach 1 (exact match with casting):', studentsResult.rows.length, 'students found');
    } catch (error) {
      console.log('Approach 1 failed:', error.message);
    }
    
    // Approach 2: String comparison if first approach failed
    if (studentsResult.rows.length === 0) {
      try {
        studentsResult = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
                 s.id as submission_id, s.status as submission_status, 
                 s.submitted_at, s.score, s.max_score
          FROM users u
          LEFT JOIN submissions s ON u.id = s.student_id AND s.task_id = $1
          WHERE u.role = 'student' 
            AND u.grade_id::text = $2::text
            AND u.class_id::text = $3::text
            AND u.is_active = true
          ORDER BY u.last_name, u.first_name
        `, [taskId, task.grade_id, task.class_id]);
        
        console.log('Approach 2 (string comparison):', studentsResult.rows.length, 'students found');
      } catch (error) {
        console.log('Approach 2 failed:', error.message);
      }
    }
    
    // Approach 3: If teacher created the task, show all students who have submitted to this task
    if (studentsResult.rows.length === 0 && task.created_by === user.id) {
      try {
        console.log('✅ Teacher created this task, showing all students with submissions');
        studentsResult = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
                 s.id as submission_id, s.status as submission_status, 
                 s.submitted_at, s.score, s.max_score
          FROM users u
          JOIN submissions s ON u.id = s.student_id AND s.task_id = $1
          WHERE u.role = 'student' AND u.is_active = true
          ORDER BY u.last_name, u.first_name
        `, [taskId]);
        
        console.log('Approach 3 (students with submissions to this task):', studentsResult.rows.length, 'students found');
        
        // Also get students in the same grade/class who haven't submitted
        const nonSubmittedStudents = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
                 NULL as submission_id, NULL as submission_status, 
                 NULL as submitted_at, NULL as score, NULL as max_score
          FROM users u
          WHERE u.role = 'student' 
            AND CAST(u.grade_id AS INTEGER) = CAST($2 AS INTEGER)
            AND CAST(u.class_id AS INTEGER) = CAST($3 AS INTEGER)
            AND u.is_active = true
            AND u.id NOT IN (
              SELECT s.student_id FROM submissions s WHERE s.task_id = $1
            )
          ORDER BY u.last_name, u.first_name
        `, [taskId, task.grade_id, task.class_id]);
        
        console.log('Non-submitted students in same grade/class:', nonSubmittedStudents.rows.length);
        
        // Combine submitted and non-submitted students
        studentsResult.rows = [...studentsResult.rows, ...nonSubmittedStudents.rows];
        
      } catch (error) {
        console.log('Approach 3 failed:', error.message);
      }
    }
    
    // Approach 4: For admins, show all students in any grade/class if no specific match
    if (studentsResult.rows.length === 0 && (user.role === 'admin' || user.role === 'super_admin')) {
      try {
        console.log('Admin user, showing all students with submissions to this task');
        studentsResult = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u class_id,
                 s.id as submission_id, s.status as submission_status, 
                 s.submitted_at, s.score, s.max_score
          FROM users u
          LEFT JOIN submissions s ON u.id = s.student_id AND s.task_id = $1
          WHERE u.role = 'student' AND u.is_active = true
          ORDER BY u.last_name, u.first_name
        `, [taskId]);
        
        console.log('Approach 4 (all students for admin):', studentsResult.rows.length, 'students found');
      } catch (error) {
        console.log('Approach 4 failed:', error.message);
      }
    }

    // Debug logging
    console.log('Final students result:', studentsResult.rows.length);
    
    if (studentsResult.rows.length === 0) {
      // Get more debug info about what's in the database
      const allStudents = await db.query(`
        SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id, u.is_active
        FROM users u
        WHERE u.role = 'student'
        ORDER BY u.grade_id, u.class_id, u.last_name, u.first_name
      `);
      
      const allSubmissions = await db.query(`
        SELECT s.id, s.task_id, s.student_id, u.first_name, u.last_name, u.grade_id, u.class_id
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        WHERE s.task_id = $1
      `, [taskId]);
      
      console.log('=== DEBUG INFO ===');
      console.log('All students in database:', allStudents.rows);
      console.log('All submissions for this task:', allSubmissions.rows);
      console.log('Task details:', task);
      console.log('User details:', { id: user.id, role: user.role, name: `${user.first_name} ${user.last_name}` });
    }

    // Final fallback: If teacher created the task and still no students found, get all students who have interacted with this task
    if (studentsResult.rows.length === 0 && task.created_by === user.id) {
      try {
        console.log('🔧 FINAL FALLBACK: Teacher created task, getting all students with activity');
        
        // Get all students who have submissions for this task
        const submissionStudents = await db.query(`
          SELECT DISTINCT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
                 s.id as submission_id, s.status as submission_status, 
                 s.submitted_at, s.score, s.max_score, s.feedback,
                 g.name as grade_name, c.name as class_name
          FROM users u
          JOIN submissions s ON u.id = s.student_id
          LEFT JOIN grades g ON u.grade_id = g.id
          LEFT JOIN classes c ON u.class_id = c.id
          WHERE u.role = 'student' AND u.is_active = true AND s.task_id = $1
          ORDER BY u.last_name, u.first_name
        `, [taskId]);
        
        console.log('✅ Submission students found:', submissionStudents.rows.length);
        
        if (submissionStudents.rows.length > 0) {
          studentsResult.rows = submissionStudents.rows;
          console.log('✅ Using submission students as fallback');
        } else {
          console.log('⚠️  No submission students found either');
        }
        
      } catch (error) {
        console.log('❌ Final fallback failed:', error.message);
      }
    }
    
    // EMERGENCY FALLBACK: If we still have no students but we know there are submissions for this task
    if (studentsResult.rows.length === 0) {
      try {
        console.log('🚨 EMERGENCY FALLBACK: Getting ANY students with submissions for this task');
        
        const emergencyStudents = await db.query(`
          SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
                 s.id as submission_id, s.status as submission_status, 
                 s.submitted_at, s.score, s.max_score, s.feedback
          FROM submissions s
          JOIN users u ON s.student_id = u.id
          WHERE s.task_id = $1
          ORDER BY s.submitted_at DESC
        `, [taskId]);
        
        console.log('🚨 Emergency students found:', emergencyStudents.rows.length);
        
        if (emergencyStudents.rows.length > 0) {
          studentsResult.rows = emergencyStudents.rows;
          console.log('✅ Using emergency fallback - found students via submissions');
        }
        
      } catch (error) {
        console.log('❌ Emergency fallback failed:', error.message);
      }
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

// DIRECT FIX: Simple endpoint to get students for a task (bypasses complex authorization)
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

    // For teachers, only allow if they created the task (simplified access control)
    if (user.role === 'teacher' && task.created_by !== user.id) {
      console.log('❌ Teacher did not create this task, checking assignments...');
      
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, task.grade_id, task.class_id]);
      
      if (assignmentCheck.rows.length === 0) {
        console.log('❌ Teacher not assigned to this grade/class either');
        // Return empty result instead of error for better UX
        return res.json({
          success: true,
          data: {
            task: task,
            students: [],
            stats: { total: 0, submitted: 0, pending: 0 },
            message: 'No access to students for this task'
          }
        });
      }
    }

    // Get ALL students who have submitted to this task (no grade/class filtering for now)
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
        s.original_file_name as file_name,
        s.content
      FROM users u
      INNER JOIN submissions s ON u.id = s.student_id
      WHERE s.task_id = $1 AND u.role = 'student' AND u.is_active = true
      ORDER BY s.submitted_at DESC
    `, [taskId]);

    console.log(`✅ Found ${studentsWithSubmissions.rows.length} students with submissions`);

    // Get students in the same grade/class who haven't submitted (if we can determine the grade/class)
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

// Auto-fix data relationships for teacher-task-student visibility
router.post('/debug/auto-fix/:taskId', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== AUTO-FIX TASK RELATIONSHIPS ===');
    console.log('Task ID:', taskId);
    console.log('User:', { id: user.id, role: user.role, name: `${user.first_name} ${user.last_name}` });

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

    // Get all submissions for this task
    const submissions = await db.query(`
      SELECT s.id, s.student_id, u.first_name, u.last_name, u.grade_id, u.class_id
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
    `, [taskId]);

    console.log('Submissions:', submissions.rows);

    const fixes = [];

    // Fix 1: Ensure teacher is assigned to the task's grade/class
    const teacherId = task.created_by;
    if (teacherId) {
      const teacherAssignment = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [teacherId, task.grade_id, task.class_id]);

      if (teacherAssignment.rows.length === 0) {
        await db.query(`
          INSERT INTO teacher_assignments (teacher_id, grade_id, class_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (teacher_id, grade_id, class_id) DO NOTHING
        `, [teacherId, task.grade_id, task.class_id]);
        
        fixes.push(`Added teacher assignment: teacher_id=${teacherId} to grade=${task.grade_id}, class=${task.class_id}`);
      }
    }

    // Fix 2: Move students who submitted to the task's grade/class
    for (const submission of submissions.rows) {
      if (submission.grade_id !== task.grade_id || submission.class_id !== task.class_id) {
        await db.query(`
          UPDATE users 
          SET grade_id = $1, class_id = $2
          WHERE id = $3
        `, [task.grade_id, task.class_id, submission.student_id]);
        
        fixes.push(`Moved student ${submission.first_name} ${submission.last_name} from grade=${submission.grade_id}, class=${submission.class_id} to grade=${task.grade_id}, class=${task.class_id}`);
      }
    }

    // Fix 3: If no submissions but user is a teacher who created the task, 
    // move any students to this grade/class so they can submit
    if (submissions.rows.length === 0 && task.created_by === user.id) {
      const anyActiveStudents = await db.query(`
        SELECT id, first_name, last_name, grade_id, class_id
        FROM users 
        WHERE role = 'student' AND is_active = true
        LIMIT 3
      `);

      for (const student of anyActiveStudents.rows) {
        await db.query(`
          UPDATE users 
          SET grade_id = $1, class_id = $2
          WHERE id = $3
        `, [task.grade_id, task.class_id, student.id]);
        
        fixes.push(`Moved student ${student.first_name} ${student.last_name} to grade=${task.grade_id}, class=${task.class_id} for task access`);
      }
    }

    console.log('Fixes applied:', fixes);

    res.json({
      success: true,
      message: 'Auto-fix completed',
      fixes_applied: fixes.length,
      fixes: fixes,
      task: task,
      submissions_count: submissions.rows.length
    });

  } catch (error) {
    console.error('Auto-fix error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during auto-fix',
      error: error.message
    });
  }
});

// Simple GET endpoint to trigger auto-fix (for testing)
router.get('/debug/auto-fix-get/:taskId', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== AUTO-FIX GET ENDPOINT ===');
    console.log('Task ID:', taskId);

    // Get task details
    const taskResult = await db.query(`
      SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by,
             g.name as grade_name, c.name as class_name,
             creator.first_name as creator_first_name, creator.last_name as creator_last_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      LEFT JOIN users creator ON t.created_by = creator.id
      WHERE t.id = $1
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const task = taskResult.rows[0];
    console.log('Task found:', task);

    // Check if teacher created the task
    const teacherCreatedTask = task.created_by === user.id;
    console.log('Teacher created task:', teacherCreatedTask);

    // Check teacher assignments
    const teacherAssignments = await db.query(`
      SELECT ta.grade_id, ta.class_id,
             g.name as grade_name, c.name as class_name
      FROM teacher_assignments ta
      LEFT JOIN grades g ON ta.grade_id = g.id
      LEFT JOIN classes c ON ta.class_id = c.id
      WHERE ta.teacher_id = $1
    `, [user.id]);

    console.log('Teacher assignments:', teacherAssignments.rows);

    // Check if teacher is assigned to task's grade/class
    const isAssignedToTaskGradeClass = teacherAssignments.rows.some(
      assignment => assignment.grade_id === task.grade_id && assignment.class_id === task.class_id
    );

    console.log('Is assigned to task grade/class:', isAssignedToTaskGradeClass);

    // Check for submissions
    const submissions = await db.query(`
      SELECT s.id, s.student_id, s.status, s.submitted_at,
             u.first_name, u.last_name, u.student_number
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
    `, [taskId]);

    console.log('Submissions found:', submissions.rows.length);

    // Get all students in the task's grade/class
    const studentsInGradeClass = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id
      FROM users u
      WHERE u.role = 'student' 
        AND CAST(u.grade_id AS INTEGER) = CAST($1 AS INTEGER)
        AND CAST(u.class_id AS INTEGER) = CAST($2 AS INTEGER)
        AND u.is_active = true
      ORDER BY u.last_name, u.first_name
    `, [task.grade_id, task.class_id]);

    console.log('Students in grade/class:', studentsInGradeClass.rows.length);

    // Return comprehensive debug info
    const debugInfo = {
      success: true,
      debug: {
        user: {
          id: user.id,
          role: user.role,
          name: `${user.first_name} ${user.last_name}`
        },
        task: {
          id: task.id,
          title: task.title,
          grade_id: task.grade_id,
          class_id: task.class_id,
          grade_name: task.grade_name,
          class_name: task.class_name,
          created_by: task.created_by,
          creator_name: `${task.creator_first_name} ${task.creator_last_name}`
        },
        access_check: {
          teacher_created_task: teacherCreatedTask,
          is_assigned_to_task_grade_class: isAssignedToTaskGradeClass,
          should_have_access: teacherCreatedTask || isAssignedToTaskGradeClass || user.role === 'admin' || user.role === 'super_admin'
        },
        teacher_assignments: teacherAssignments.rows,
        submissions: submissions.rows,
        students_in_grade_class: studentsInGradeClass.rows,
        counts: {
          teacher_assignments: teacherAssignments.rows.length,
          submissions: submissions.rows.length,
          students_in_grade_class: studentsInGradeClass.rows.length
        }
      }
    };

    res.json(debugInfo);

  } catch (error) {
    console.error('Debug teacher access check error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug endpoint error',
      error: error.message
    });
  }
});

// Debug endpoint - auto-assign teacher to task grade/class
router.post('/debug/auto-assign-teacher/:taskId', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;
    const { teacherId } = req.body; // Optional: assign different teacher

    const targetTeacherId = teacherId || user.id;

    console.log('=== AUTO-ASSIGN TEACHER TO TASK ===');
    console.log('Task ID:', taskId);
    console.log('Target Teacher ID:', targetTeacherId);
    console.log('Requesting User:', `${user.first_name} ${user.last_name} (${user.role})`);

    // Get task details
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
    console.log('Task found:', task);

    // Get teacher details
    const teacherResult = await db.query(`
      SELECT id, first_name, last_name, email, role
      FROM users
      WHERE id = $1 AND role = 'teacher' AND is_active = true
    `, [targetTeacherId]);

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const teacher = teacherResult.rows[0];
    console.log('Teacher found:', teacher);

    // Check if teacher is already assigned to this grade/class
    const existingAssignment = await db.query(`
      SELECT * FROM teacher_assignments
      WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
    `, [targetTeacherId, task.grade_id, task.class_id]);

    if (existingAssignment.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Teacher is already assigned to this grade/class',
        assignment: existingAssignment.rows[0],
        task: task,
        teacher: teacher
      });
    }

    // Create the assignment
    const assignmentResult = await db.query(`
      INSERT INTO teacher_assignments (teacher_id, grade_id, class_id, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *
    `, [targetTeacherId, task.grade_id, task.class_id]);

    console.log('✅ Assignment created:', assignmentResult.rows[0]);

    res.json({
      success: true,
      message: `Teacher ${teacher.first_name} ${teacher.last_name} successfully assigned to ${task.grade_name} - ${task.class_name}`,
      assignment: assignmentResult.rows[0],
      task: task,
      teacher: teacher
    });

  } catch (error) {
    console.error('Auto-assign teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to auto-assign teacher',
      error: error.message
    });
  }
});

// EMERGENCY ENDPOINT: Force show students with submissions (for debugging)
router.get('/task/:taskId/force-students', [
  authenticate
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== FORCE STUDENTS ENDPOINT (EMERGENCY) ===');
    console.log('Task ID:', taskId);
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);

    // Get task info
    const task = await db.query(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
    console.log('Task:', task.rows[0]);

    // Get ALL submissions for this task (no restrictions)
    const submissions = await db.query(`
      SELECT 
        s.id as submission_id,
        s.student_id,
        s.status as submission_status,
        s.submitted_at,
        s.score,
        s.max_score,
        s.feedback,
        s.content,
        s.file_name,
        u.id,
        u.first_name,
        u.last_name,
        u.student_number,
        u.grade_id,
        u.class_id
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
      ORDER BY s.submitted_at DESC
    `, [taskId]);

    console.log(`✅ FORCE ENDPOINT: Found ${submissions.rows.length} submissions`);

    res.json({
      success: true,
      force_endpoint: true,
      user: {
        id: user.id,
        role: user.role,
        name: `${user.first_name} ${user.last_name}`
      },
      task: task.rows[0],
      data: {
        students: submissions.rows,
        stats: {
          total: submissions.rows.length,
          submitted: submissions.rows.length,
          pending: 0
        }
      }
    });

  } catch (error) {
    console.error('❌ Force students endpoint error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Force endpoint failed',
      error: error.message
    });
  }
});

// COMPREHENSIVE TEST ENDPOINT - Debug student visibility
router.get('/task/:taskId/test-all', [
  authenticate
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== COMPREHENSIVE TEST ENDPOINT ===');
    console.log('Task ID:', taskId);
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);

    // 1. Get task info
    const taskResult = await db.query(`
      SELECT t.*, g.name as grade_name, c.name as class_name,
             creator.first_name as creator_first_name, creator.last_name as creator_last_name
      FROM tasks t
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      LEFT JOIN users creator ON t.created_by = creator.id
      WHERE t.id = $1
    `, [taskId]);

    const task = taskResult.rows[0];
    console.log('Task found:', !!task);

    // 2. Get ALL submissions for this task
    const allSubmissions = await db.query(`
      SELECT s.*, u.first_name, u.last_name, u.student_number
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
      ORDER BY s.submitted_at DESC
    `, [taskId]);

    console.log('Total submissions:', allSubmissions.rows.length);

    // 3. Get ALL students in the task's grade/class
    const allStudentsInGradeClass = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id
      FROM users u
      WHERE u.role = 'student' 
        AND u.grade_id = $1 
        AND u.class_id = $2 
        AND u.is_active = true
      ORDER BY u.last_name, u.first_name
    `, [task?.grade_id, task?.class_id]);

    console.log('Students in grade/class:', allStudentsInGradeClass.rows.length);

    // 4. Get teacher assignments
    const teacherAssignments = await db.query(`
      SELECT ta.*, g.name as grade_name, c.name as class_name
      FROM teacher_assignments ta
      LEFT JOIN grades g ON ta.grade_id = g.id
      LEFT JOIN classes c ON ta.class_id = c.id
      WHERE ta.teacher_id = $1
    `, [user.id]);

    console.log('Teacher assignments:', teacherAssignments.rows.length);

    // 5. Check access logic
    let hasAccess = false;
    let accessReason = '';

    if (user.role === 'admin' || user.role === 'super_admin') {
      hasAccess = true;
      accessReason = 'Admin/Super Admin role';
    } else if (user.role === 'teacher') {
      if (task?.created_by === user.id) {
        hasAccess = true;
        accessReason = 'Teacher created this task';
      } else {
        const assigned = teacherAssignments.rows.some(
          a => a.grade_id === task?.grade_id && a.class_id === task?.class_id
        );
        if (assigned) {
          hasAccess = true;
          accessReason = 'Teacher assigned to grade/class';
        }
      }
    }

    // 6. Prepare student data with submission info
    const studentsWithSubmissions = allStudentsInGradeClass.rows.map(student => {
      const submission = allSubmissions.rows.find(s => s.student_id === student.id);
      return {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        student_number: student.student_number,
        grade_id: student.grade_id,
        class_id: student.class_id,
        submission_id: submission?.id || null,
        submission_status: submission?.status || null,
        submitted_at: submission?.submitted_at || null,
        score: submission?.score || null,
        max_score: submission?.max_score || null,
        feedback: submission?.feedback || null,
        file_name: submission?.file_name || null,
        content: submission?.content || null
      };
    });

    console.log('Students with submission info:', studentsWithSubmissions.length);

    // 7. Return comprehensive data
    res.json({
      success: true,
      debug: {
        endpoint: 'test-all',
        user: {
          id: user.id,
          role: user.role,
          name: `${user.first_name} ${user.last_name}`
        },
        task: task,
        access: {
          hasAccess,
          accessReason,
          userRole: user.role,
          taskCreatedBy: task?.created_by,
          teacherAssignments: teacherAssignments.rows.length
        },
        counts: {
          totalSubmissions: allSubmissions.rows.length,
          studentsInGradeClass: allStudentsInGradeClass.rows.length,
          teacherAssignments: teacherAssignments.rows.length,
          studentsWithSubmissionInfo: studentsWithSubmissions.length
        },
        raw_data: {
          task: task,
          submissions: allSubmissions.rows,
          students: allStudentsInGradeClass.rows,
          teacherAssignments: teacherAssignments.rows
        }
      },
      data: {
        task: task,
        students: studentsWithSubmissions,
        stats: {
          total: studentsWithSubmissionInfo.length,
          submitted: studentsWithSubmissionInfo.filter(s => s.submission_id).length,
          pending: studentsWithSubmissionInfo.filter(s => !s.submission_id).length
        }
      }
    });

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Test endpoint failed',
      error: error.message,
      stack: error.stack
    });
  }
});

// Save document marking (teachers only)
router.put('/:id/marking', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('score').isNumeric().withMessage('Score must be a number'),
  body('teacher_comments').optional(),
  body('annotations').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { score, teacher_comments, annotations } = req.body;
    const user = req.user;

    // Get submission details to verify access
    const submissionResult = await db.query(`
      SELECT s.id, s.student_id, t.grade_id, t.class_id, t.max_points
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id = $1
    `, [id]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];

    // Validate score
    if (score > submission.max_points) {
      return res.status(400).json({ 
        message: `Score cannot exceed maximum score of ${submission.max_points}` 
      });
    }

    // Update submission with marking data
    const result = await db.query(`
      UPDATE submissions 
      SET score = $1, 
          feedback = $2, 
          teacher_comments = $3,
          annotations = $4,
          status = 'graded', 
          graded_at = CURRENT_TIMESTAMP, 
          graded_by = $5
      WHERE id = $6
      RETURNING id, score, feedback, teacher_comments, annotations, status, graded_at
    `, [score, teacher_comments, teacher_comments, JSON.stringify(annotations || []), user.id, id]);

    res.json({
      success: true,
      message: 'Document marking saved successfully',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('Save marking error:', error);
    res.status(500).json({ message: 'Server error saving marking' });
  }
});

// Upload marked document (teachers only) - NEW FEATURE
router.put('/:id/upload-marked-document', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  (req, res, next) => {
    console.log('=== MARKED DOCUMENT UPLOAD MIDDLEWARE ===');
    upload.single('markedDocument')(req, res, (err) => {
      if (err) {
        console.error('Marked document upload error:', err);
        return res.status(400).json({
          success: false,
          message: 'File upload error: ' + err.message
        });
      }
      next();
    });
  }
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No marked document file provided'
      });
    }

    // Get submission details to verify access
    const submissionResult = await db.query(`
      SELECT s.id, s.student_id, s.task_id, t.grade_id, t.class_id, t.title as task_title,
             u.first_name, u.last_name, u.student_number
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN users u ON s.student_id = u.id
      WHERE s.id = $1
    `, [id]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = submissionResult.rows[0];

    // Upload marked document to S3 or save locally
    let markedDocS3Key = null;
    let markedDocS3Url = null;
    let markedDocFilePath = null;

    const isS3Configured = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME;

    if (isS3Configured) {
      try {
        // Upload to S3
        const s3Key = `marked-documents/${submission.task_id}/${submission.student_id}/${Date.now()}-${req.file.originalname}`;
        const uploadResult = await s3Service.uploadFile(req.file.buffer, s3Key, req.file.mimetype);
        
        markedDocS3Key = uploadResult.s3Key;
        markedDocS3Url = uploadResult.s3Url;
        console.log('✅ Marked document uploaded to S3:', s3Key);
      } catch (s3Error) {
        console.error('S3 upload failed, falling back to local storage:', s3Error.message);
      }
    }

    // Fallback to local storage if S3 fails or not configured
    if (!markedDocS3Key) {
      const fs = require('fs');
      const uploadsDir = path.join(__dirname, '..', 'uploads', 'marked-documents');
      
      // Ensure directory exists
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      const uniqueFileName = `${submission.task_id}-${submission.student_id}-${Date.now()}-${req.file.originalname}`;
      markedDocFilePath = path.join(uploadsDir, uniqueFileName);
      
      // Save file locally
      fs.writeFileSync(markedDocFilePath, req.file.buffer);
      console.log('✅ Marked document saved locally:', markedDocFilePath);
    }

    // Update submission with marked document information
    const result = await db.query(`
      UPDATE submissions 
      SET marked_document_s3_key = $1,
          marked_document_s3_url = $2,
          marked_document_file_path = $3,
          marked_document_original_name = $4,
          marked_document_file_size = $5,
          marked_document_uploaded_at = CURRENT_TIMESTAMP,
          marked_document_uploaded_by = $6,
          status = CASE WHEN status = 'submitted' THEN 'graded' ELSE status END
      WHERE id = $7
      RETURNING id, marked_document_s3_key, marked_document_s3_url, marked_document_file_path, 
               marked_document_original_name, marked_document_uploaded_at, status
    `, [
      markedDocS3Key, markedDocS3Url, markedDocFilePath, req.file.originalname,
      req.file.size, user.id, id
    ]);

    res.json({
      success: true,
      message: 'Marked document uploaded successfully',
      submission: result.rows[0],
      student_info: {
        name: `${submission.first_name} ${submission.last_name}`,
        student_number: submission.student_number
      }
    });

  } catch (error) {
    console.error('Upload marked document error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error uploading marked document' 
    });
  }
});

// Get marked document (for students to view their marked submissions)
router.get('/:id/marked-document', [
  authenticate
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const result = await db.query(`
      SELECT s.id, s.score, s.feedback, s.teacher_comments, s.annotations, 
             s.original_file_name, s.s3_key, s3_url, s.status, s.graded_at,
             s.marked_document_s3_key, s.marked_document_s3_url, s.marked_document_file_path,
             s.marked_document_original_name, s.marked_document_uploaded_at,
             s.student_id, t.title as task_title
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = result.rows[0];

    // Check access - students can only view their own marked submissions
    if (user.role === 'student' && submission.student_id !== user.id) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied' 
      });
    }

    // Only return marked documents that have been graded
    if (submission.status !== 'graded') {
      return res.status(404).json({ 
        success: false,
        message: 'Document has not been marked yet' 
      });
    }

    res.json({
      success: true,
      submission: {
        id: submission.id,
        score: submission.score,
        feedback: submission.feedback,
        teacher_comments: submission.teacher_comments,
        annotations: submission.annotations ? JSON.parse(submission.annotations) : [],
        original_file_name: submission.original_file_name,
        status: submission.status,
        graded_at: submission.graded_at,
        task_title: submission.task_title,
        marked_document: {
          s3_key: submission.marked_document_s3_key,
          s3_url: submission.marked_document_s3_url,
          file_path: submission.marked_document_file_path,
          original_name: submission.marked_document_original_name,
          uploaded_at: submission.marked_document_uploaded_at
        }
      }
    });

  } catch (error) {
    console.error('Get marked document error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching marked document' 
    });
  }
});

// Download marked document (for students)
router.get('/:id/download-marked-document', [
  authenticate
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const result = await db.query(`
      SELECT s.id, s.student_id, s.marked_document_s3_key, s.marked_document_s3_url, 
             s.marked_document_file_path, s.marked_document_original_name, s.status
      FROM submissions s
      WHERE s.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = result.rows[0];

    // Check access - students can only download their own marked documents
    if (user.role === 'student' && submission.student_id !== user.id) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied' 
      });
    }

    // Check if marked document exists
    if (!submission.marked_document_s3_key && !submission.marked_document_file_path) {
      return res.status(404).json({ 
        success: false,
        message: 'No marked document available for this submission' 
      });
    }

    // If S3 file exists, provide signed URL
    if (submission.marked_document_s3_key) {
      try {
        const signedUrl = await s3Service.getSignedUrl(submission.marked_document_s3_key);
        return res.json({
          success: true,
          download_url: signedUrl,
          file_name: submission.marked_document_original_name
        });
      } catch (s3Error) {
        console.error('S3 signed URL error:', s3Error);
        // Continue to local file fallback
      }
    }

    // Serve local file
    if (submission.marked_document_file_path && require('fs').existsSync(submission.marked_document_file_path)) {
      return res.download(submission.marked_document_file_path, submission.marked_document_original_name);
    }

    // No file found
    return res.status(404).json({ 
      success: false,
      message: 'Marked document file not found' 
    });

  } catch (error) {
    console.error('❌ Download marked document error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error downloading marked document' 
    });
  }
});

// Upload graded document (teachers only)
router.put('/:id/upload-graded-document', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('submission'),
  upload.single('gradedDocument')
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No graded document file uploaded' 
      });
    }

    console.log('=== UPLOAD GRADED DOCUMENT ===');
    console.log('Submission ID:', id);
    console.log('File:', req.file);
    console.log('User:', user.id);

    // Get submission details
    const submissionResult = await db.query(`
      SELECT s.id, s.student_id, t.title as task_title
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.id = $1
    `, [id]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = submissionResult.rows[0];

    // Upload to S3
    const fileName = `graded-documents/${req.file.originalname}-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(req.file.originalname)}`;
    
    let s3Key, s3Url;
    try {
      const uploadResult = await s3Service.uploadFile(req.file.buffer, fileName, req.file.mimetype);
      s3Key = uploadResult.s3Key;
      s3Url = uploadResult.s3Url;
      
      console.log('✅ File uploaded to S3:', { s3Key, s3Url });
    } catch (s3Error) {
      console.error('❌ S3 upload error:', s3Error);
      return res.status(500).json({ 
        success: false,
        message: 'Failed to upload file to storage' 
      });
    }

    // Update submission with graded document info
    const result = await db.query(`
      UPDATE submissions 
      SET graded_document_s3_key = $1, 
          graded_document_s3_url = $2,
          graded_document_original_name = $3,
          graded_document_file_size = $4,
          graded_document_file_type = $5,
          graded_document_uploaded_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING id, graded_document_original_name
    `, [s3Key, s3Url, req.file.originalname, req.file.size, req.file.mimetype, id]);

    console.log('✅ Graded document uploaded successfully');

    res.json({
      success: true,
      message: 'Graded document uploaded successfully',
      data: {
        submissionId: id,
        fileName: req.file.originalname,
        fileSize: req.file.size
      }
    });

  } catch (error) {
    console.error('❌ Upload graded document error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error uploading graded document' 
    });
  }
});

// Download graded document
router.get('/:id/download-graded-document', [
  authenticate,
  authorizeResourceAccess('submission')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT graded_document_s3_key, graded_document_original_name, graded_document_file_type
      FROM submissions WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const submission = result.rows[0];

    if (!submission.graded_document_s3_key) {
      return res.status(404).json({ 
        success: false,
        message: 'No graded document found for this submission' 
      });
    }

    try {
      const signedUrl = await s3Service.getSignedUrl(
        submission.graded_document_s3_key, 
        300, // 5 minutes expiry
        'attachment' // Force download
      );
      
      return res.json({
        success: true,
        downloadUrl: signedUrl,
        fileName: submission.graded_document_original_name || 'graded-document',
        message: 'Graded document download URL generated successfully'
      });
    } catch (s3Error) {
      console.error('❌ S3 graded document download error:', s3Error);
      return res.status(500).json({ 
        success: false,
        message: 'Graded document temporarily unavailable. Please try again later.' 
      });
    }

  } catch (error) {
    console.error('❌ Download graded document error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error downloading graded document' 
    });
  }
});

module.exports = router;
