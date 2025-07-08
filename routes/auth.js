const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      student_number: user.student_number 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// Student login
router.post('/login/student', [
  body('student_number').notEmpty().withMessage('Student number is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { student_number, password } = req.body;

    // Find student by student number
    const result = await db.query(`
      SELECT u.id, u.student_number, u.email, u.password, u.first_name, u.last_name, 
             u.role, u.grade_id, u.class_id, u.is_active,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.student_number = $1 AND u.role = 'student'
    `, [student_number]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      message: 'Login successful',
      token,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Teacher/Admin login
router.post('/login/staff', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find staff member by email
    const result = await db.query(`
      SELECT u.id, u.student_number, u.email, u.password, u.first_name, u.last_name, 
             u.role, u.grade_id, u.class_id, u.is_active,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.email = $1 AND u.role IN ('teacher', 'admin', 'super_admin')
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    // Get teacher assignments if user is a teacher
    let assignments = [];
    if (user.role === 'teacher') {
      const assignmentResult = await db.query(`
        SELECT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
      `, [user.id]);
      assignments = assignmentResult.rows;
    }

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      message: 'Login successful',
      token,
      user: { ...userWithoutPassword, assignments }
    });

  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get current user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    // Get additional user information
    let additionalInfo = {};
    
    if (user.role === 'teacher') {
      const assignmentResult = await db.query(`
        SELECT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
      `, [user.id]);
      additionalInfo.assignments = assignmentResult.rows;
    }
    
    if (user.role === 'student') {
      // Get student's recent submissions
      const submissionResult = await db.query(`
        SELECT s.id, s.score, s.max_score, s.status, s.submitted_at, t.title as task_title
        FROM submissions s
        JOIN tasks t ON s.task_id = t.id
        WHERE s.student_id = $1
        ORDER BY s.submitted_at DESC
        LIMIT 5
      `, [user.id]);
      additionalInfo.recent_submissions = submissionResult.rows;
    }

    res.json({
      user: { ...user, ...additionalInfo }
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

// Change password
router.put('/change-password', [
  authenticate,
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    // Get current password hash
    const result = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Update password
    await db.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, userId]
    );

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Server error changing password' });
  }
});

// Logout (client-side token removal)
router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logout successful' });
});

// Verify token
router.get('/verify', authenticate, (req, res) => {
  res.json({ 
    valid: true, 
    user: req.user 
  });
});

module.exports = router;
