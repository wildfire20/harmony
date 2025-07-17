const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token decoded successfully:', { id: decoded.id, email: decoded.email });
    
    // Get user details from database with retry logic
    let result;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        result = await db.query(`
          SELECT u.id, u.student_number, u.email, u.first_name, u.last_name, 
                 u.role, u.grade_id, u.class_id, g.name as grade_name, c.name as class_name
          FROM users u
          LEFT JOIN grades g ON u.grade_id = g.id
          LEFT JOIN classes c ON u.class_id = c.id
          WHERE u.id = $1 AND u.is_active = true
        `, [decoded.id]);
        break;
      } catch (dbError) {
        attempts++;
        console.error(`Database query attempt ${attempts} failed:`, dbError);
        if (attempts >= maxAttempts) {
          throw dbError;
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (result.rows.length === 0) {
      console.log('❌ User not found in database for id:', decoded.id);
      return res.status(401).json({ message: 'Invalid token. User not found.' });
    }

    req.user = result.rows[0];
    console.log('✅ User authenticated:', { id: req.user.id, email: req.user.email, role: req.user.role });
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
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

// Authentication middleware that supports both header and query parameter tokens
const authenticateFlexible = async (req, res, next) => {
  try {
    // Try to get token from Authorization header first, then from query parameter
    let token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      token = req.query.token;
    }
    
    if (!token) {
      console.log('❌ No token provided in header or query');
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token decoded successfully:', { id: decoded.id, email: decoded.email });
    
    // Get user details from database with retry logic
    let result;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        result = await db.query(`
          SELECT u.id, u.student_number, u.email, u.first_name, u.last_name, 
                 u.role, u.grade_id, u.class_id, g.name as grade_name, c.name as class_name
          FROM users u
          LEFT JOIN grades g ON u.grade_id = g.id
          LEFT JOIN classes c ON u.class_id = c.id
          WHERE u.id = $1 AND u.is_active = true
        `, [decoded.id]);
        break;
      } catch (dbError) {
        attempts++;
        console.error(`Database query attempt ${attempts} failed:`, dbError);
        if (attempts >= maxAttempts) {
          throw dbError;
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (result.rows.length === 0) {
      console.log('❌ User not found in database for id:', decoded.id);
      return res.status(401).json({ message: 'Invalid token. User not found.' });
    }

    req.user = result.rows[0];
    console.log('✅ User authenticated (flexible):', { id: req.user.id, email: req.user.email, role: req.user.role });
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.status(401).json({ message: 'Invalid token.' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      console.log('❌ Authorization failed: No user in request');
      return res.status(401).json({ message: 'Authentication required.' });
    }

    console.log('🔍 Checking authorization for user:', { id: req.user.id, role: req.user.role });
    console.log('🔍 Required roles:', roles);

    if (!roles.includes(req.user.role)) {
      console.log('❌ Authorization failed: User role not in required roles');
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.' 
      });
    }

    console.log('✅ Authorization successful');
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
      const resourceId = req.params.id || req.params.taskId || req.params.submissionId;

      console.log(`=== AUTHORIZE RESOURCE ACCESS DEBUG ===`);
      console.log(`Resource Type: ${resourceType}`);
      console.log(`Resource ID: ${resourceId}`);
      console.log(`All params:`, req.params);
      console.log(`User:`, JSON.stringify(user, null, 2));
      console.log(`Timestamp: ${new Date().toISOString()}`);

      if (!resourceId) {
        console.log('❌ No resource ID found in params');
        return res.status(400).json({ message: 'Resource ID required' });
      }

      // Super admin can access everything
      if (user.role === 'super_admin') {
        console.log('✅ Super admin access granted');
        return next();
      }

      let query = '';
      let params = [];

      switch (resourceType) {
        case 'task':
          query = `
            SELECT grade_id, class_id, created_by FROM tasks 
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

      // Execute database query with retry logic
      let result;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          result = await db.query(query, params);
          break;
        } catch (dbError) {
          attempts++;
          console.error(`Database query attempt ${attempts} failed:`, dbError);
          if (attempts >= maxAttempts) {
            throw dbError;
          }
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`Database query result: ${result.rows.length} rows found`);
      if (result.rows.length > 0) {
        console.log('Resource data:', JSON.stringify(result.rows[0], null, 2));
      }
      
      if (result.rows.length === 0) {
        console.log('❌ Resource not found in database');
        return res.status(404).json({ 
          message: 'Resource not found.',
          debug: {
            resourceType,
            resourceId,
            timestamp: new Date().toISOString()
          }
        });
      }

      const resource = result.rows[0];

      // Check access based on user role
      if (user.role === 'admin') {
        // Admins can access everything
        console.log('✅ Admin access granted');
        return next();
      } else if (user.role === 'teacher') {
        // Check if teacher is assigned to this grade/class
        let assignmentResult;
        try {
          assignmentResult = await db.query(`
            SELECT 1 FROM teacher_assignments 
            WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
          `, [user.id, resource.grade_id, resource.class_id]);
        } catch (assignmentError) {
          console.error('Teacher assignment query failed:', assignmentError);
          // Continue with no assignment found
          assignmentResult = { rows: [] };
        }

        console.log('Teacher assignment check:', assignmentResult.rows.length > 0);

        if (assignmentResult.rows.length === 0) {
          console.log('❌ Teacher access denied - not assigned to grade/class');
          return res.status(403).json({ 
            message: 'Access denied. You are not assigned to this grade/class.' 
          });
        }

        console.log('✅ Teacher access granted');

        // For submissions, teachers can only view submissions for tasks they created
        // or tasks in their assigned grades/classes
        if (resourceType === 'submission') {
          // Teachers can view submissions if they created the task or are assigned to the grade/class
          if (resource.task_created_by != user.id && assignmentResult.rows.length === 0) {
            console.log('❌ Teacher submission access denied');
            return res.status(403).json({ 
              message: 'Access denied. You can only view submissions for your tasks or assigned classes.' 
            });
          }
        }

      } else if (user.role === 'student') {
        // Students can only access resources from their grade/class
        // Use parseInt to ensure proper comparison of IDs
        const resourceGradeId = parseInt(resource.grade_id);
        const userGradeId = parseInt(user.grade_id);
        const resourceClassId = parseInt(resource.class_id);
        const userClassId = parseInt(user.class_id);
        
        console.log('Student access check:');
        console.log(`Resource grade: ${resourceGradeId}, User grade: ${userGradeId}`);
        console.log(`Resource class: ${resourceClassId}, User class: ${userClassId}`);
        console.log(`Grade match: ${resourceGradeId === userGradeId}`);
        console.log(`Class match: ${resourceClassId === userClassId}`);
        
        // IMPORTANT: Check if user has grade_id and class_id
        if (!userGradeId || !userClassId) {
          console.log('❌ Student access denied - missing grade/class assignment');
          return res.status(403).json({ 
            message: 'Access denied. Your account is missing grade or class assignment. Please contact the administrator.',
            debug: {
              user_grade: userGradeId,
              user_class: userClassId,
              user_info: user
            }
          });
        }
        
        if (resourceGradeId !== userGradeId || resourceClassId !== userClassId) {
          console.log('❌ Student access denied - grade/class mismatch');
          return res.status(403).json({ 
            message: 'Access denied. You can only access resources from your grade/class.',
            debug: {
              resource_grade: resourceGradeId,
              user_grade: userGradeId,
              resource_class: resourceClassId,
              user_class: userClassId
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
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        code: error.code,
        resourceType,
        resourceId,
        userId: user?.id,
        userRole: user?.role
      });
      res.status(500).json({ 
        message: 'Server error during resource authorization.',
        debug: {
          resourceType,
          resourceId,
          timestamp: new Date().toISOString(),
          error_type: error.name
        }
      });
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
  authenticateFlexible,
  authorize,
  authorizeGradeClass,
  authorizeResourceAccess,
  authorizeTeacherAssignment,
  requireTeacherAssignment
};
