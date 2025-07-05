const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess } = require('../middleware/auth');

const router = express.Router();

// Get announcements for a grade/class
router.get('/grade/:gradeId/class/:classId', authenticate, async (req, res) => {
  try {
    const { gradeId, classId } = req.params;
    const user = req.user;

    // Check access permissions
    if (user.role === 'student' && (user.grade_id != gradeId || user.class_id != classId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const result = await db.query(`
      SELECT a.id, a.title, a.content, a.priority, a.created_at, a.updated_at,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      JOIN grades g ON a.grade_id = g.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.grade_id = $1 AND a.class_id = $2 AND a.is_active = true
      ORDER BY a.priority DESC, a.created_at DESC
    `, [gradeId, classId]);

    res.json({ announcements: result.rows });

  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ message: 'Server error fetching announcements' });
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
      SELECT a.id, a.title, a.content, a.priority, a.created_at, a.updated_at,
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
  body('grade_id').isInt().withMessage('Grade ID is required'),
  body('class_id').isInt().withMessage('Class ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, content, priority, grade_id, class_id } = req.body;
    const user = req.user;

    // Check if teacher has access to this grade/class
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, grade_id, class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }

    const result = await db.query(`
      INSERT INTO announcements (title, content, priority, grade_id, class_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, content, priority, grade_id, class_id, created_at
    `, [title, content, priority || 'normal', grade_id, class_id, user.id]);

    res.status(201).json({
      message: 'Announcement created successfully',
      announcement: result.rows[0]
    });

  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ message: 'Server error creating announcement' });
  }
});

// Update announcement
router.put('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('announcement'),
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('content').optional().notEmpty().withMessage('Content cannot be empty'),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']).withMessage('Invalid priority')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, content, priority } = req.body;

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
      RETURNING id, title, content, priority, updated_at
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
      SELECT a.id, a.title, a.content, a.priority, a.created_at,
             u.first_name as author_first_name, u.last_name as author_last_name,
             g.name as grade_name, c.name as class_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      JOIN grades g ON a.grade_id = g.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.is_active = true
    `;

    const params = [];

    if (user.role === 'student') {
      query += ' AND a.grade_id = $1 AND a.class_id = $2';
      params.push(user.grade_id, user.class_id);
    } else if (user.role === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $1 AND ta.grade_id = a.grade_id AND ta.class_id = a.class_id
      )`;
      params.push(user.id);
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

module.exports = router;
