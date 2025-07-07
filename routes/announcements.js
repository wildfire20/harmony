const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess } = require('../middleware/auth');

const router = express.Router();

// Get announcements - role-based visibility
router.get('/', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    console.log('=== GET ANNOUNCEMENTS ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);
    console.log('User grade_id:', user.grade_id, 'class_id:', user.class_id);

    let query = `
      SELECT a.id, a.title, a.content, a.priority, a.created_at, a.updated_at,
             a.target_grade_id, a.target_class_id, a.is_global,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.target_grade_id = g.id
      LEFT JOIN classes c ON a.target_class_id = c.id
      WHERE a.is_active = true
    `;

    let params = [];
    
    if (user.role === 'student') {
      // Students can only see:
      // 1. Global announcements (is_global = true)
      // 2. Announcements targeted to their specific grade/class
      query += ` AND (
        a.is_global = true 
        OR (a.target_grade_id = $1 AND a.target_class_id = $2)
      )`;
      params = [user.grade_id, user.class_id];
    } else if (user.role === 'teacher') {
      // Teachers can see:
      // 1. Global announcements
      // 2. Announcements for their assigned grades/classes
      // 3. Announcements they created
      query += ` AND (
        a.is_global = true 
        OR a.created_by = $1
        OR (a.target_grade_id, a.target_class_id) IN (
          SELECT ta.grade_id, ta.class_id 
          FROM teacher_assignments ta 
          WHERE ta.teacher_id = $1
        )
      )`;
      params = [user.id];
    }
    // Admins can see all announcements (no additional filters)

    query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    console.log('Query:', query);
    console.log('Params:', params);

    const result = await db.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM announcements a
      WHERE a.is_active = true
    `;
    let countParams = [];

    if (user.role === 'student') {
      countQuery += ` AND (
        a.is_global = true 
        OR (a.target_grade_id = $1 AND a.target_class_id = $2)
      )`;
      countParams = [user.grade_id, user.class_id];
    } else if (user.role === 'teacher') {
      countQuery += ` AND (
        a.is_global = true 
        OR a.created_by = $1
        OR (a.target_grade_id, a.target_class_id) IN (
          SELECT ta.grade_id, ta.class_id 
          FROM teacher_assignments ta 
          WHERE ta.teacher_id = $1
        )
      )`;
      countParams = [user.id];
    }

    const countResult = await db.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total);

    console.log('✅ Found announcements:', result.rows.length);
    console.log('Total count:', totalCount);

    res.json({
      success: true,
      announcements: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('❌ GET ANNOUNCEMENTS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching announcements',
      error: error.message 
    });
  }
});

// Create announcement - role-based permissions
router.post('/', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('title').notEmpty().withMessage('Title is required'),
  body('content').notEmpty().withMessage('Content is required'),
  body('priority').optional().isIn(['low', 'medium', 'high']).withMessage('Priority must be low, medium, or high'),
  body('target_grade_id').optional().isInt().withMessage('Target grade ID must be an integer'),
  body('target_class_id').optional().isInt().withMessage('Target class ID must be an integer'),
  body('is_global').optional().isBoolean().withMessage('is_global must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const user = req.user;
    const { title, content, priority = 'medium', target_grade_id, target_class_id, is_global = false } = req.body;

    console.log('=== CREATE ANNOUNCEMENT ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);
    console.log('Request body:', req.body);

    // Validate permissions based on user role
    if (user.role === 'teacher') {
      // Teachers can only create announcements for their assigned grades/classes
      // They cannot create global announcements
      if (is_global) {
        return res.status(403).json({
          success: false,
          message: 'Teachers cannot create global announcements'
        });
      }

      if (!target_grade_id || !target_class_id) {
        return res.status(400).json({
          success: false,
          message: 'Teachers must specify target grade and class for announcements'
        });
      }

      // Check if teacher is assigned to the target grade/class
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, target_grade_id, target_class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You can only create announcements for your assigned grades/classes'
        });
      }
    }

    // For admins, validate grade/class existence if specified
    if (target_grade_id && target_class_id) {
      const gradeClassCheck = await db.query(`
        SELECT g.name as grade_name, c.name as class_name
        FROM grades g
        JOIN classes c ON c.id = $2
        WHERE g.id = $1
      `, [target_grade_id, target_class_id]);

      if (gradeClassCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid grade or class specified'
        });
      }
    }

    // Create announcement
    const result = await db.query(`
      INSERT INTO announcements (
        title, content, priority, target_grade_id, target_class_id, 
        is_global, created_by, created_at, updated_at, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), true)
      RETURNING id, title, content, priority, target_grade_id, target_class_id, 
                is_global, created_at, updated_at
    `, [
      title, content, priority, target_grade_id, target_class_id, 
      is_global, user.id
    ]);

    const announcement = result.rows[0];

    console.log('✅ Announcement created:', announcement);

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      announcement: announcement
    });

  } catch (error) {
    console.error('❌ CREATE ANNOUNCEMENT ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error creating announcement',
      error: error.message 
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
    const user = req.user;

    console.log('=== GET SINGLE ANNOUNCEMENT ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);
    console.log('Announcement ID:', id);

    const result = await db.query(`
      SELECT a.id, a.title, a.content, a.priority, a.created_at, a.updated_at,
             a.target_grade_id, a.target_class_id, a.is_global,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.target_grade_id = g.id
      LEFT JOIN classes c ON a.target_class_id = c.id
      WHERE a.id = $1 AND a.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    const announcement = result.rows[0];

    // Check if user has permission to view this announcement
    let hasAccess = false;

    if (user.role === 'admin' || user.role === 'super_admin') {
      hasAccess = true;
    } else if (user.role === 'teacher') {
      // Teachers can view if they created it, it's global, or it's for their assigned grade/class
      if (announcement.created_by === user.id || announcement.is_global) {
        hasAccess = true;
      } else if (announcement.target_grade_id && announcement.target_class_id) {
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, announcement.target_grade_id, announcement.target_class_id]);
        
        hasAccess = assignmentCheck.rows.length > 0;
      }
    } else if (user.role === 'student') {
      // Students can view if it's global or targeted to their grade/class
      if (announcement.is_global) {
        hasAccess = true;
      } else if (announcement.target_grade_id && announcement.target_class_id) {
        hasAccess = (
          announcement.target_grade_id === user.grade_id && 
          announcement.target_class_id === user.class_id
        );
      }
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    console.log('✅ Announcement found and accessible');

    res.json({
      success: true,
      announcement: announcement
    });

  } catch (error) {
    console.error('❌ GET SINGLE ANNOUNCEMENT ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching announcement',
      error: error.message 
    });
  }
});

// Update announcement
router.put('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('content').optional().notEmpty().withMessage('Content cannot be empty'),
  body('priority').optional().isIn(['low', 'medium', 'high']).withMessage('Priority must be low, medium, or high'),
  body('target_grade_id').optional().isInt().withMessage('Target grade ID must be an integer'),
  body('target_class_id').optional().isInt().withMessage('Target class ID must be an integer'),
  body('is_global').optional().isBoolean().withMessage('is_global must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { id } = req.params;
    const user = req.user;
    const { title, content, priority, target_grade_id, target_class_id, is_global } = req.body;

    console.log('=== UPDATE ANNOUNCEMENT ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);
    console.log('Announcement ID:', id);

    // Get current announcement
    const currentResult = await db.query(`
      SELECT * FROM announcements WHERE id = $1 AND is_active = true
    `, [id]);

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    const currentAnnouncement = currentResult.rows[0];

    // Check permissions
    if (user.role === 'teacher') {
      // Teachers can only update their own announcements
      if (currentAnnouncement.created_by !== user.id) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own announcements'
        });
      }

      // Teachers cannot make announcements global
      if (is_global !== undefined && is_global) {
        return res.status(403).json({
          success: false,
          message: 'Teachers cannot create global announcements'
        });
      }

      // If changing target grade/class, check teacher assignment
      if (target_grade_id !== undefined && target_class_id !== undefined) {
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, target_grade_id, target_class_id]);

        if (assignmentCheck.rows.length === 0) {
          return res.status(403).json({
            success: false,
            message: 'You can only assign announcements to your assigned grades/classes'
          });
        }
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updateFields.push(`title = $${paramIndex}`);
      updateValues.push(title);
      paramIndex++;
    }

    if (content !== undefined) {
      updateFields.push(`content = $${paramIndex}`);
      updateValues.push(content);
      paramIndex++;
    }

    if (priority !== undefined) {
      updateFields.push(`priority = $${paramIndex}`);
      updateValues.push(priority);
      paramIndex++;
    }

    if (target_grade_id !== undefined) {
      updateFields.push(`target_grade_id = $${paramIndex}`);
      updateValues.push(target_grade_id);
      paramIndex++;
    }

    if (target_class_id !== undefined) {
      updateFields.push(`target_class_id = $${paramIndex}`);
      updateValues.push(target_class_id);
      paramIndex++;
    }

    if (is_global !== undefined) {
      updateFields.push(`is_global = $${paramIndex}`);
      updateValues.push(is_global);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    const updateQuery = `
      UPDATE announcements 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND is_active = true
      RETURNING id, title, content, priority, target_grade_id, target_class_id, 
                is_global, created_at, updated_at
    `;

    const result = await db.query(updateQuery, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    console.log('✅ Announcement updated:', result.rows[0]);

    res.json({
      success: true,
      message: 'Announcement updated successfully',
      announcement: result.rows[0]
    });

  } catch (error) {
    console.error('❌ UPDATE ANNOUNCEMENT ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error updating announcement',
      error: error.message 
    });
  }
});

// Delete announcement
router.delete('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    console.log('=== DELETE ANNOUNCEMENT ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);
    console.log('Announcement ID:', id);

    // Get current announcement
    const currentResult = await db.query(`
      SELECT * FROM announcements WHERE id = $1 AND is_active = true
    `, [id]);

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    const currentAnnouncement = currentResult.rows[0];

    // Check permissions
    if (user.role === 'teacher' && currentAnnouncement.created_by !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own announcements'
      });
    }

    // Soft delete
    const result = await db.query(`
      UPDATE announcements 
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING id, title
    `, [id]);

    console.log('✅ Announcement deleted:', result.rows[0]);

    res.json({
      success: true,
      message: 'Announcement deleted successfully'
    });

  } catch (error) {
    console.error('❌ DELETE ANNOUNCEMENT ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error deleting announcement',
      error: error.message 
    });
  }
});

// Get available grades and classes for announcement creation
router.get('/meta/targets', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const user = req.user;

    console.log('=== GET ANNOUNCEMENT TARGETS ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);

    let availableTargets = [];

    if (user.role === 'teacher') {
      // Teachers can only see their assigned grades/classes
      const assignmentsResult = await db.query(`
        SELECT DISTINCT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
        ORDER BY g.name, c.name
      `, [user.id]);

      availableTargets = assignmentsResult.rows;
    } else {
      // Admins can see all grades/classes
      const allTargetsResult = await db.query(`
        SELECT g.id as grade_id, c.id as class_id, g.name as grade_name, c.name as class_name
        FROM grades g
        CROSS JOIN classes c
        WHERE g.is_active = true AND c.is_active = true
        ORDER BY g.name, c.name
      `);

      availableTargets = allTargetsResult.rows;
    }

    console.log('✅ Available targets:', availableTargets.length);

    res.json({
      success: true,
      targets: availableTargets,
      canCreateGlobal: user.role === 'admin' || user.role === 'super_admin'
    });

  } catch (error) {
    console.error('❌ GET ANNOUNCEMENT TARGETS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching announcement targets',
      error: error.message 
    });
  }
});

// Debug endpoint - get all announcements with full details
router.get('/debug/all', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const user = req.user;

    console.log('=== DEBUG ALL ANNOUNCEMENTS ===');
    console.log('User:', `${user.first_name} ${user.last_name} (${user.role})`);

    const result = await db.query(`
      SELECT a.*, 
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.target_grade_id = g.id
      LEFT JOIN classes c ON a.target_class_id = c.id
      ORDER BY a.created_at DESC
    `);

    console.log('✅ Debug announcements:', result.rows.length);

    res.json({
      success: true,
      total: result.rows.length,
      announcements: result.rows
    });

  } catch (error) {
    console.error('❌ DEBUG ANNOUNCEMENTS ERROR:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error in debug endpoint',
      error: error.message 
    });
  }
});

module.exports = router;
