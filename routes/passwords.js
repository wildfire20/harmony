const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { generatePasswordForUser, generateKidFriendlyPassword } = require('../utils/passwordGenerator');

router.get('/students', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { search, grade_id, class_id } = req.query;
    
    let query = `
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, 
             u.display_password, u.grade_id, u.class_id, u.is_active,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student' AND u.is_active = true
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (u.first_name ILIKE $${paramIndex} OR u.last_name ILIKE $${paramIndex} OR u.student_number ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (grade_id) {
      query += ` AND u.grade_id = $${paramIndex}`;
      params.push(grade_id);
      paramIndex++;
    }

    if (class_id) {
      query += ` AND u.class_id = $${paramIndex}`;
      params.push(class_id);
      paramIndex++;
    }

    query += ' ORDER BY u.first_name, u.last_name';

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: {
        students: result.rows
      }
    });
  } catch (error) {
    console.error('Error fetching student passwords:', error);
    res.status(500).json({ success: false, message: 'Error fetching students' });
  }
});

router.get('/teachers', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = `
      SELECT id, first_name, last_name, email, display_password, role, is_active
      FROM users
      WHERE role = 'teacher' AND is_active = true
    `;
    const params = [];

    if (search) {
      query += ` AND (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY first_name, last_name';

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: {
        teachers: result.rows
      }
    });
  } catch (error) {
    console.error('Error fetching teacher passwords:', error);
    res.status(500).json({ success: false, message: 'Error fetching teachers' });
  }
});

router.post('/reset/:userId', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { customPassword } = req.body;

    const userResult = await pool.query('SELECT id, first_name, role FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userResult.rows[0];

    if (user.role === 'super_admin' || user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Cannot reset admin passwords through this portal. Admins must reset their own passwords.' });
    }

    let newPassword;
    if (customPassword && customPassword.trim()) {
      newPassword = customPassword.trim();
    } else {
      newPassword = generatePasswordForUser(user.first_name);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password = $1, display_password = $2, updated_at = NOW() WHERE id = $3',
      [hashedPassword, newPassword, userId]
    );

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        newPassword: newPassword
      }
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: 'Error resetting password' });
  }
});

router.post('/bulk-reset', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No users selected' });
    }

    const results = [];

    for (const userId of userIds) {
      try {
        const userResult = await pool.query('SELECT id, first_name, last_name, role, student_number FROM users WHERE id = $1', [userId]);
        
        if (userResult.rows.length === 0) continue;
        
        const user = userResult.rows[0];
        
        if (user.role === 'super_admin' || user.role === 'admin') continue;

        const newPassword = generatePasswordForUser(user.first_name);
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
          'UPDATE users SET password = $1, display_password = $2, updated_at = NOW() WHERE id = $3',
          [hashedPassword, newPassword, userId]
        );

        results.push({
          id: user.id,
          name: `${user.first_name} ${user.last_name}`,
          studentNumber: user.student_number,
          newPassword: newPassword
        });
      } catch (err) {
        console.error(`Error resetting password for user ${userId}:`, err);
      }
    }

    res.json({
      success: true,
      message: `Reset passwords for ${results.length} users`,
      data: { results }
    });
  } catch (error) {
    console.error('Error bulk resetting passwords:', error);
    res.status(500).json({ success: false, message: 'Error resetting passwords' });
  }
});

router.get('/generate', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { firstName } = req.query;
    
    let password;
    if (firstName) {
      password = generatePasswordForUser(firstName);
    } else {
      password = generateKidFriendlyPassword();
    }

    res.json({
      success: true,
      data: { password }
    });
  } catch (error) {
    console.error('Error generating password:', error);
    res.status(500).json({ success: false, message: 'Error generating password' });
  }
});

module.exports = router;
