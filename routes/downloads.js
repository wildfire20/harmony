const express = require('express');
const { authenticate } = require('../middleware/auth');
const s3Service = require('../services/s3Service');
const db = require('../config/database');

const router = express.Router();

// Download task attachment
router.get('/task-attachment/:taskId', authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    console.log('=== DOWNLOAD TASK ATTACHMENT ===');
    console.log('Task ID:', taskId);
    console.log('User:', user.email, user.role);

    // Get task details and verify access
    const taskResult = await db.query(`
      SELECT t.*, t.attachment_s3_key, t.attachment_original_name, t.attachment_file_type
      FROM tasks t
      WHERE t.id = $1 AND t.is_active = true
    `, [taskId]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const task = taskResult.rows[0];

    if (!task.attachment_s3_key) {
      return res.status(404).json({ success: false, message: 'No attachment found for this task' });
    }

    // Check if user has access to this task
    if (user.role === 'student') {
      const userGradeId = parseInt(user.grade_id, 10);
      const userClassId = parseInt(user.class_id, 10);
      const taskGradeId = parseInt(task.grade_id, 10);
      const taskClassId = parseInt(task.class_id, 10);

      if (userGradeId !== taskGradeId || userClassId !== taskClassId) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied - you can only download attachments for your assigned grade and class' 
        });
      }
    } else if (user.role === 'teacher') {
      // Check if teacher has access to this grade/class
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, task.grade_id, task.class_id]);

      if (assignmentCheck.rows.length === 0 && task.created_by !== user.id) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied - you are not assigned to this grade/class' 
        });
      }
    }

    console.log('✅ Access granted, downloading:', task.attachment_s3_key);

    // Generate a presigned URL for download
    const downloadUrl = await s3Service.getPresignedUrl(task.attachment_s3_key, 300); // 5 minutes

    console.log('✅ Generated presigned URL for download');

    // Return the download URL as JSON instead of redirecting
    res.json({
      success: true,
      downloadUrl: downloadUrl,
      filename: task.attachment_original_name,
      message: 'Download URL generated successfully'
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to download attachment',
      error: error.message 
    });
  }
});

module.exports = router;
