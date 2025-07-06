const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user details from database
    const result = await db.query(`
      SELECT u.id, u.student_number, u.email, u.first_name, u.last_name, 
             u.role, u.grade_id, u.class_id, g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id = $1 AND u.is_active = true
    `, [decoded.id]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid token. User not found.' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired. Please login again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token.' });
    }
    console.error('Authentication error:', error);
    res.status(500).json({ message: 'Server error during authentication.' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.' 
      });
    }

    next();
  };
};

const authorizeGradeClass = async (req, res, next) => {
  try {
    const { gradeId, classId } = req.params;
    const user = req.user;

    // Super admin and admin can access everything
    if (user.role === 'super_admin' || user.role === 'admin') {
      return next();
    }

    // Teachers can only access their assigned grades/classes
    if (user.role === 'teacher') {
      const result = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      if (result.rows.length === 0) {
        return res.status(403).json({ 
          message: 'Access denied. You are not assigned to this grade/class.' 
        });
      }
    }

    // Students can only access their own grade/class
    if (user.role === 'student') {
      if (user.grade_id != gradeId || user.class_id != classId) {
        return res.status(403).json({ 
          message: 'Access denied. You can only access your own grade/class.' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({ message: 'Server error during authorization.' });
  }
};

const authorizeResourceAccess = (resourceType) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const resourceId = req.params.id;

      // Super admin can access everything
      if (user.role === 'super_admin') {
        return next();
      }

      let query = '';
      let params = [];

      switch (resourceType) {
        case 'task':
          query = `
            SELECT grade_id, class_id, created_by, submission_type FROM tasks 
            WHERE id = $1 AND is_active = true
          `;
          params = [resourceId];
          break;
        case 'announcement':
          query = `
            SELECT grade_id, class_id, created_by FROM announcements 
            WHERE id = $1 AND is_active = true
          `;
          params = [resourceId];
          break;
        case 'submission':
          query = `
            SELECT t.grade_id, t.class_id, s.student_id, t.created_by as task_created_by 
            FROM submissions s 
            JOIN tasks t ON s.task_id = t.id 
            WHERE s.id = $1
          `;
          params = [resourceId];
          break;
        case 'document':
          query = `
            SELECT grade_id, class_id, uploaded_by FROM documents 
            WHERE id = $1 AND is_active = true
          `;
          params = [resourceId];
          break;
        case 'quiz':
          query = `
            SELECT t.grade_id, t.class_id, t.created_by 
            FROM quizzes q
            JOIN tasks t ON q.task_id = t.id 
            WHERE q.id = $1
          `;
          params = [resourceId];
          break;
        default:
          return res.status(400).json({ message: 'Invalid resource type.' });
      }

      const result = await db.query(query, params);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Resource not found.' });
      }

      const resource = result.rows[0];

      // Check access based on user role
      if (user.role === 'admin') {
        // Admins can access everything
        return next();
      } else if (user.role === 'teacher') {
        // Check if teacher is assigned to this grade/class
        const assignmentResult = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, resource.grade_id, resource.class_id]);

        if (assignmentResult.rows.length === 0) {
          return res.status(403).json({ 
            message: 'Access denied. You are not assigned to this grade/class.' 
          });
        }

        // For submissions, teachers can only view submissions for tasks they created
        // or tasks in their assigned grades/classes
        if (resourceType === 'submission') {
          // Teachers can view submissions if they created the task or are assigned to the grade/class
          if (resource.task_created_by != user.id && assignmentResult.rows.length === 0) {
            return res.status(403).json({ 
              message: 'Access denied. You can only view submissions for your tasks or assigned classes.' 
            });
          }
        }

      } else if (user.role === 'student') {
        // Students can only access resources from their grade/class
        console.log('=== STUDENT RESOURCE ACCESS DEBUG ===');
        console.log('Resource grade_id:', resource.grade_id, 'type:', typeof resource.grade_id);
        console.log('User grade_id:', user.grade_id, 'type:', typeof user.grade_id);
        console.log('Resource class_id:', resource.class_id, 'type:', typeof resource.class_id);
        console.log('User class_id:', user.class_id, 'type:', typeof user.class_id);
        console.log('Grade match:', resource.grade_id == user.grade_id);
        console.log('Class match:', resource.class_id == user.class_id);
        
        if (parseInt(resource.grade_id) !== parseInt(user.grade_id) || parseInt(resource.class_id) !== parseInt(user.class_id)) {
          console.log('❌ Access denied due to grade/class mismatch');
          return res.status(403).json({ 
            message: 'Access denied. You can only access resources from your grade/class.',
            debug: {
              resource_grade: resource.grade_id,
              user_grade: user.grade_id,
              resource_class: resource.class_id,
              user_class: user.class_id
            }
          });
        }
        
        console.log('✅ Student access granted');

        // For submissions, students can only access their own
        if (resourceType === 'submission' && resource.student_id != user.id) {
          return res.status(403).json({ 
            message: 'Access denied. You can only access your own submissions.' 
          });
        }
      }

      // Store resource info for later use in the route
      req.resource = resource;
      next();
    } catch (error) {
      console.error('Resource authorization error:', error);
      res.status(500).json({ message: 'Server error during resource authorization.' });
    }
  };
};

// Enhanced middleware to check teacher assignments
const authorizeTeacherAssignment = async (req, res, next) => {
  try {
    const user = req.user;
    const { gradeId, classId } = req.params;

    // Super admin and admin can access everything
    if (user.role === 'super_admin' || user.role === 'admin') {
      return next();
    }

    // Teachers must be assigned to the grade/class
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ 
          message: 'Access denied. You are not assigned to this grade/class. Please contact an administrator to assign you to this grade/class.' 
        });
      }
    }

    // Students can only access their own grade/class
    if (user.role === 'student') {
      if (user.grade_id != gradeId || user.class_id != classId) {
        return res.status(403).json({ 
          message: 'Access denied. You can only access your own grade/class.' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('Teacher assignment authorization error:', error);
    res.status(500).json({ message: 'Server error during teacher assignment authorization.' });
  }
};

// Middleware to ensure teachers have assignments before creating content
const requireTeacherAssignment = async (req, res, next) => {
  try {
    const user = req.user;

    // Only check for teachers
    if (user.role !== 'teacher') {
      return next();
    }

    // Check if teacher has any assignments
    const assignmentCheck = await db.query(`
      SELECT grade_id, class_id FROM teacher_assignments 
      WHERE teacher_id = $1
    `, [user.id]);

    if (assignmentCheck.rows.length === 0) {
      return res.status(403).json({ 
        message: 'You must be assigned to at least one grade/class before creating content. Please contact an administrator for assignment.' 
      });
    }

    // Store teacher assignments for later use
    req.teacherAssignments = assignmentCheck.rows;
    next();
  } catch (error) {
    console.error('Teacher assignment requirement error:', error);
    res.status(500).json({ message: 'Server error checking teacher assignments.' });
  }
};

module.exports = {
  authenticate,
  authorize,
  authorizeGradeClass,
  authorizeResourceAccess,
  authorizeTeacherAssignment,
  requireTeacherAssignment
};
