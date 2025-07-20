const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess, authorizeTeacherAssignment, requireTeacherAssignment } = require('../middleware/auth');

const router = express.Router();

// Get announcements for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    // Build query based on user role
    let query = `
      SELECT a.id, a.title, a.content, a.priority, a.target_audience, a.created_by, a.created_at, a.updated_at,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.grade_id = g.id
      LEFT JOIN classes c ON a.class_id = c.id
      WHERE a.is_active = true
    `;
    
    const params = [];
    
    if (user.role === 'student') {
      // Students see announcements for their grade/class or global announcements for students/everyone
      query += ` AND (
        (a.grade_id = $1 AND a.class_id = $2) OR 
        (a.grade_id IS NULL AND a.class_id IS NULL AND a.target_audience IN ($3, $4))
      )`;
      params.push(user.grade_id, user.class_id, 'everyone', 'students');
    } else if (user.role === 'teacher') {
      // Teachers see announcements for their assigned grade/class or global announcements for staff/everyone
      query += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_assignments ta 
          WHERE ta.teacher_id = $1 AND ta.grade_id = a.grade_id AND ta.class_id = a.class_id
        ) OR 
        (a.grade_id IS NULL AND a.class_id IS NULL AND a.target_audience IN ($2, $3))
      )`;
      params.push(user.id, 'everyone', 'staff');
    } else if (user.role === 'admin' || user.role === 'super_admin') {
      // Admins see all announcements
      query += ' AND a.target_audience IN ($1, $2, $3)';
      params.push('everyone', 'staff', 'students');
    }
    
    query += ' ORDER BY a.priority DESC, a.created_at DESC';
    
    const result = await db.query(query, params);

    res.json({ 
      success: true,
      announcements: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching announcements' 
    });
  }
});

// Get announcements for a grade/class (legacy route)
router.get('/grade/:gradeId/class/:classId', [
  authenticate,
  authorizeTeacherAssignment
], async (req, res) => {
  try {
    const { gradeId, classId } = req.params;

    // Convert to integers for consistency
    const requestedGradeId = parseInt(gradeId, 10);
    const requestedClassId = parseInt(classId, 10);

    if (isNaN(requestedGradeId) || isNaN(requestedClassId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid grade or class ID parameters' 
      });
    }

    // Build query with target audience filtering
    let query = `
      SELECT a.id, a.title, a.content, a.priority, a.target_audience, a.created_by, a.created_at, a.updated_at,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      JOIN grades g ON a.grade_id = g.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.grade_id = $1 AND a.class_id = $2 AND a.is_active = true
    `;
    
    const params = [requestedGradeId, requestedClassId];
    
    // Add target audience filtering based on user role
    if (req.user.role === 'student') {
      query += ' AND (a.target_audience = $3 OR a.target_audience = $4)';
      params.push('everyone', 'students');
    } else if (req.user.role === 'teacher') {
      query += ' AND (a.target_audience = $3 OR a.target_audience = $4)';
      params.push('everyone', 'staff');
    } else if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      // Admins can see all announcements
      query += ' AND a.target_audience IN ($3, $4, $5)';
      params.push('everyone', 'staff', 'students');
    }
    
    query += ' ORDER BY a.priority DESC, a.created_at DESC';
    
    const result = await db.query(query, params);

    res.json({ 
      success: true,
      announcements: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching announcements' 
    });
  }
});

// Get single announcement
router.get('/:id', [
  authenticate,
  authorizeResourceAccess('announcement')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT a.id, a.title, a.content, a.priority, a.target_audience, a.created_by, a.created_at, a.updated_at,
             a.grade_id, a.class_id,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      JOIN grades g ON a.grade_id = g.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.id = $1 AND a.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    res.json({ announcement: result.rows[0] });

  } catch (error) {
    console.error('Get announcement error:', error);
    res.status(500).json({ message: 'Server error fetching announcement' });
  }
});

// Create announcement
router.post('/', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('title').notEmpty().withMessage('Title is required'),
  body('content').notEmpty().withMessage('Content is required'),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']).withMessage('Invalid priority'),
  body('target_audience').optional().isIn(['everyone', 'staff', 'students']).withMessage('Invalid target audience')
], async (req, res) => {
  try {
    console.log('📝 Creating announcement with data:', req.body);
    console.log('👤 User:', { id: req.user.id, role: req.user.role });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { title, content, priority, target_audience } = req.body;
    const user = req.user;

    let gradeId = null;
    let classId = null;

    // For teachers, use their assigned grade/class
    if (user.role === 'teacher') {
      console.log('🏫 Processing teacher announcement...');
      // Get teacher's assignment
      const assignment = await db.query(`
        SELECT grade_id, class_id FROM teacher_assignments 
        WHERE teacher_id = $1 LIMIT 1
      `, [user.id]);

      if (assignment.rows.length === 0) {
        console.log('❌ Teacher not assigned to any grade/class');
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You are not assigned to any grade/class. Please contact an administrator for assignment.' 
        });
      }

      gradeId = assignment.rows[0].grade_id;
      classId = assignment.rows[0].class_id;
      console.log('✅ Teacher assignment found:', { gradeId, classId });
    }
    // For admins, announcements are global (no specific grade/class)
    else if (user.role === 'admin' || user.role === 'super_admin') {
      console.log('👑 Processing admin announcement...');
      // Admin announcements are global, so grade_id and class_id can be null
      gradeId = null;
      classId = null;
    }

    console.log('💾 Inserting announcement with params:', {
      title, content, priority: priority || 'normal', gradeId, classId, target_audience: target_audience || 'everyone', created_by: user.id
    });

    const result = await db.query(`
      INSERT INTO announcements (title, content, priority, grade_id, class_id, target_audience, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, title, content, priority, grade_id, class_id, target_audience, created_at
    `, [title, content, priority || 'normal', gradeId, classId, target_audience || 'everyone', user.id]);

    console.log('✅ Announcement created successfully:', result.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      announcement: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Create announcement error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error creating announcement' 
    });
  }
});

// Update announcement
router.put('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('announcement'),
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('content').optional().notEmpty().withMessage('Content cannot be empty'),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']).withMessage('Invalid priority'),
  body('target_audience').optional().isIn(['everyone', 'staff', 'students']).withMessage('Invalid target audience')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, content, priority, target_audience } = req.body;

    const updateFields = [];
    const params = [];
    let paramCount = 0;

    if (title !== undefined) {
      paramCount++;
      updateFields.push(`title = $${paramCount}`);
      params.push(title);
    }

    if (content !== undefined) {
      paramCount++;
      updateFields.push(`content = $${paramCount}`);
      params.push(content);
    }

    if (priority !== undefined) {
      paramCount++;
      updateFields.push(`priority = $${paramCount}`);
      params.push(priority);
    }

    if (target_audience !== undefined) {
      paramCount++;
      updateFields.push(`target_audience = $${paramCount}`);
      params.push(target_audience);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    paramCount++;
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await db.query(`
      UPDATE announcements 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, title, content, priority, target_audience, updated_at
    `, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    res.json({
      message: 'Announcement updated successfully',
      announcement: result.rows[0]
    });

  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ message: 'Server error updating announcement' });
  }
});

// Delete announcement
router.delete('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('announcement')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      UPDATE announcements 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    res.json({
      message: 'Announcement deleted successfully',
      announcement: result.rows[0]
    });

  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ message: 'Server error deleting announcement' });
  }
});

// Get recent announcements for dashboard
router.get('/recent/:limit?', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const limit = parseInt(req.params.limit) || 5;

    let query = `
      SELECT a.id, a.title, a.content, a.priority, a.target_audience, a.created_by, a.created_at,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      JOIN grades g ON a.grade_id = g.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.is_active = true
    `;

    const params = [];

    // Add target audience filtering
    if (user.role === 'student') {
      query += ' AND a.grade_id = $1 AND a.class_id = $2';
      query += ' AND (a.target_audience = $3 OR a.target_audience = $4)';
      params.push(user.grade_id, user.class_id, 'everyone', 'students');
    } else if (user.role === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $1 AND ta.grade_id = a.grade_id AND ta.class_id = a.class_id
      )`;
      query += ' AND (a.target_audience = $2 OR a.target_audience = $3)';
      params.push(user.id, 'everyone', 'staff');
    } else if (user.role === 'admin' || user.role === 'super_admin') {
      // Admins can see all announcements
      query += ' AND a.target_audience IN ($1, $2, $3)';
      params.push('everyone', 'staff', 'students');
    }

    query += ' ORDER BY a.priority DESC, a.created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await db.query(query, params);

    res.json({ announcements: result.rows });

  } catch (error) {
    console.error('Get recent announcements error:', error);
    res.status(500).json({ message: 'Server error fetching recent announcements' });
  }
});

// Test endpoint to get current user details
router.get('/debug/user', authenticate, async (req, res) => {
  try {
    console.log('🔍 Debug user endpoint called');
    console.log('User from token:', req.user);
    
    // Get fresh user data from database
    const userResult = await db.query(`
      SELECT id, email, first_name, last_name, role, grade_id, class_id, is_active
      FROM users 
      WHERE id = $1
    `, [req.user.id]);
    
    console.log('User from database:', userResult.rows[0]);
    
    // If user is a teacher, get their assignments
    let assignments = null;
    if (req.user.role === 'teacher') {
      assignments = await db.query(`
        SELECT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
      `, [req.user.id]);
      
      console.log('Teacher assignments:', assignments.rows);
    }
    
    res.json({
      success: true,
      user: req.user,
      fresh_user: userResult.rows[0],
      assignments: req.user.role === 'teacher' ? assignments.rows : null
    });
  } catch (error) {
    console.error('Debug user error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
