const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = req.user;
    res.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { first_name, last_name, email } = req.body;
    const user = req.user;

    const updateFields = [];
    const params = [];
    let paramCount = 0;

    if (first_name !== undefined) {
      paramCount++;
      updateFields.push(`first_name = $${paramCount}`);
      params.push(first_name);
    }

    if (last_name !== undefined) {
      paramCount++;
      updateFields.push(`last_name = $${paramCount}`);
      params.push(last_name);
    }

    if (email !== undefined && user.role !== 'student') {
      paramCount++;
      updateFields.push(`email = $${paramCount}`);
      params.push(email);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    paramCount++;
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(user.id);

    const result = await db.query(`
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, student_number, email, first_name, last_name, role
    `, params);

    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error updating profile' });
  }
});

// Get teacher assignments (for teachers only)
router.get('/teacher/assignments', [
  authenticate
], async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'teacher') {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Only teachers can access this endpoint.' 
      });
    }

    const result = await db.query(`
      SELECT 
        ta.grade_id, 
        ta.class_id,
        g.name as grade_name,
        c.name as class_name
      FROM teacher_assignments ta
      JOIN grades g ON ta.grade_id = g.id
      JOIN classes c ON ta.class_id = c.id
      WHERE ta.teacher_id = $1
      ORDER BY g.name, c.name
    `, [user.id]);

    res.json({
      success: true,
      assignments: result.rows
    });

  } catch (error) {
    console.error('Get teacher assignments error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching teacher assignments' 
    });
  }
});

module.exports = router;
