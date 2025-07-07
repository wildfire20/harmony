const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Authenticate user middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. No token provided.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const result = await db.query(
      'SELECT id, email, first_name, last_name, role, grade_id, class_id, student_number, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token. User not found.' 
      });
    }

    if (!result.rows[0].is_active) {
      return res.status(401).json({ 
        success: false,
        message: 'Account is deactivated.' 
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      success: false,
      message: 'Invalid token.' 
    });
  }
};

// Authorize user roles middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Not authenticated.' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Insufficient permissions.' 
      });
    }

    next();
  };
};

// Resource access authorization middleware
const authorizeResourceAccess = (resourceType) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const resourceId = req.params.id;

      if (!user) {
        return res.status(401).json({ 
          success: false,
          message: 'Access denied. Not authenticated.' 
        });
      }

      // Admins have access to all resources
      if (user.role === 'admin' || user.role === 'super_admin') {
        return next();
      }

      switch (resourceType) {
        case 'submission':
          // Check if user owns the submission or is authorized to view it
          const submissionResult = await db.query(`
            SELECT s.student_id, s.task_id, t.grade_id, t.class_id, t.created_by
            FROM submissions s
            JOIN tasks t ON s.task_id = t.id
            WHERE s.id = $1
          `, [resourceId]);

          if (submissionResult.rows.length === 0) {
            return res.status(404).json({ 
              success: false,
              message: 'Resource not found.' 
            });
          }

          const submission = submissionResult.rows[0];

          // Students can only access their own submissions
          if (user.role === 'student') {
            if (submission.student_id !== user.id) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied.' 
              });
            }
          }

          // Teachers can access if they created the task or are assigned to the grade/class
          if (user.role === 'teacher') {
            if (submission.created_by === user.id) {
              return next();
            }

            const teacherAssignmentResult = await db.query(`
              SELECT 1 FROM teacher_assignments
              WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
            `, [user.id, submission.grade_id, submission.class_id]);

            if (teacherAssignmentResult.rows.length === 0) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied.' 
              });
            }
          }
          break;

        case 'task':
          // Check if user has access to the task
          const taskResult = await db.query(`
            SELECT grade_id, class_id, created_by FROM tasks WHERE id = $1
          `, [resourceId]);

          if (taskResult.rows.length === 0) {
            return res.status(404).json({ 
              success: false,
              message: 'Resource not found.' 
            });
          }

          const task = taskResult.rows[0];

          // Students can access tasks for their grade/class
          if (user.role === 'student') {
            if (task.grade_id !== user.grade_id || task.class_id !== user.class_id) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied.' 
              });
            }
          }

          // Teachers can access if they created the task or are assigned to the grade/class
          if (user.role === 'teacher') {
            if (task.created_by === user.id) {
              return next();
            }

            const teacherAssignmentResult = await db.query(`
              SELECT 1 FROM teacher_assignments
              WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
            `, [user.id, task.grade_id, task.class_id]);

            if (teacherAssignmentResult.rows.length === 0) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied.' 
              });
            }
          }
          break;

        case 'announcement':
          // Check if user has access to the announcement
          const announcementResult = await db.query(`
            SELECT target_grade_id, target_class_id, is_global, created_by
            FROM announcements WHERE id = $1 AND is_active = true
          `, [resourceId]);

          if (announcementResult.rows.length === 0) {
            return res.status(404).json({ 
              success: false,
              message: 'Resource not found.' 
            });
          }

          const announcement = announcementResult.rows[0];

          // Students can access global announcements or those targeted to their grade/class
          if (user.role === 'student') {
            if (announcement.is_global) {
              return next();
            }

            if (announcement.target_grade_id === user.grade_id && 
                announcement.target_class_id === user.class_id) {
              return next();
            }

            return res.status(403).json({ 
              success: false,
              message: 'Access denied.' 
            });
          }

          // Teachers can access if they created it, it's global, or it's for their assigned grade/class
          if (user.role === 'teacher') {
            if (announcement.created_by === user.id || announcement.is_global) {
              return next();
            }

            if (announcement.target_grade_id && announcement.target_class_id) {
              const teacherAssignmentResult = await db.query(`
                SELECT 1 FROM teacher_assignments
                WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
              `, [user.id, announcement.target_grade_id, announcement.target_class_id]);

              if (teacherAssignmentResult.rows.length > 0) {
                return next();
              }
            }

            return res.status(403).json({ 
              success: false,
              message: 'Access denied.' 
            });
          }
          break;

        case 'document':
          // Check if user has access to the document
          const documentResult = await db.query(`
            SELECT grade_id, class_id, uploaded_by FROM documents WHERE id = $1
          `, [resourceId]);

          if (documentResult.rows.length === 0) {
            return res.status(404).json({ 
              success: false,
              message: 'Resource not found.' 
            });
          }

          const document = documentResult.rows[0];

          // Students can access documents for their grade/class
          if (user.role === 'student') {
            if (document.grade_id !== user.grade_id || document.class_id !== user.class_id) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied.' 
              });
            }
          }

          // Teachers can access if they uploaded it or are assigned to the grade/class
          if (user.role === 'teacher') {
            if (document.uploaded_by === user.id) {
              return next();
            }

            const teacherAssignmentResult = await db.query(`
              SELECT 1 FROM teacher_assignments
              WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
            `, [user.id, document.grade_id, document.class_id]);

            if (teacherAssignmentResult.rows.length === 0) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied.' 
              });
            }
          }
          break;

        default:
          return res.status(400).json({ 
            success: false,
            message: 'Invalid resource type.' 
          });
      }

      next();
    } catch (error) {
      console.error('Resource access authorization error:', error);
      res.status(500).json({ 
        success: false,
        message: 'Server error during authorization.' 
      });
    }
  };
};

// Teacher assignment authorization middleware
const authorizeTeacherAssignment = async (req, res, next) => {
  try {
    const user = req.user;
    const { grade_id, class_id } = req.body || req.params;

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Not authenticated.' 
      });
    }

    // Admins have access to all assignments
    if (user.role === 'admin' || user.role === 'super_admin') {
      return next();
    }

    // Teachers can only work with their assigned grades/classes
    if (user.role === 'teacher') {
      const assignmentResult = await db.query(`
        SELECT 1 FROM teacher_assignments
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, grade_id, class_id]);

      if (assignmentResult.rows.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You are not assigned to this grade/class.' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('Teacher assignment authorization error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error during authorization.' 
    });
  }
};

module.exports = {
  authenticate,
  authorize,
  authorizeResourceAccess,
  authorizeTeacherAssignment
};
