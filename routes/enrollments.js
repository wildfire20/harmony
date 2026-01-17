const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { sendEnrollmentNotification } = require('../services/gmailService');

const initializeEnrollmentsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        parent_first_name VARCHAR(100) NOT NULL,
        parent_last_name VARCHAR(100) NOT NULL,
        parent_email VARCHAR(255) NOT NULL,
        parent_phone VARCHAR(50) NOT NULL,
        student_first_name VARCHAR(100) NOT NULL,
        student_last_name VARCHAR(100) NOT NULL,
        student_date_of_birth DATE NOT NULL,
        grade_applying VARCHAR(50) NOT NULL,
        boarding_option BOOLEAN DEFAULT false,
        previous_school VARCHAR(255),
        additional_notes TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'waitlisted')),
        admin_notes TEXT,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments(status);
      CREATE INDEX IF NOT EXISTS idx_enrollments_email ON enrollments(parent_email);
      CREATE INDEX IF NOT EXISTS idx_enrollments_created ON enrollments(created_at);
    `);
    
    console.log('✅ Enrollments table initialized');
  } catch (error) {
    console.error('❌ Enrollments table initialization failed:', error.message);
  }
};

initializeEnrollmentsTable();

const enrollmentValidation = [
  body('parentFirstName').trim().isLength({ min: 2 }).withMessage('Parent first name must be at least 2 characters'),
  body('parentLastName').trim().isLength({ min: 2 }).withMessage('Parent last name must be at least 2 characters'),
  body('parentEmail').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('parentPhone').trim().isLength({ min: 10 }).withMessage('Please enter a valid phone number'),
  body('studentFirstName').trim().isLength({ min: 2 }).withMessage('Student first name must be at least 2 characters'),
  body('studentLastName').trim().isLength({ min: 2 }).withMessage('Student last name must be at least 2 characters'),
  body('studentDateOfBirth').isISO8601().withMessage('Please enter a valid date of birth'),
  body('gradeApplying').trim().notEmpty().withMessage('Please select a grade'),
];

router.post('/', enrollmentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      parentFirstName,
      parentLastName,
      parentEmail,
      parentPhone,
      studentFirstName,
      studentLastName,
      studentDateOfBirth,
      gradeApplying,
      boardingOption,
      previousSchool,
      additionalNotes
    } = req.body;

    const result = await db.query(`
      INSERT INTO enrollments (
        parent_first_name, parent_last_name, parent_email, parent_phone,
        student_first_name, student_last_name, student_date_of_birth,
        grade_applying, boarding_option, previous_school, additional_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      parentFirstName,
      parentLastName,
      parentEmail,
      parentPhone,
      studentFirstName,
      studentLastName,
      studentDateOfBirth,
      gradeApplying,
      boardingOption || false,
      previousSchool || null,
      additionalNotes || null
    ]);

    const enrollment = result.rows[0];

    try {
      const emailResult = await sendEnrollmentNotification({
        parent_first_name: parentFirstName,
        parent_last_name: parentLastName,
        parent_email: parentEmail,
        parent_phone: parentPhone,
        student_first_name: studentFirstName,
        student_last_name: studentLastName,
        student_date_of_birth: studentDateOfBirth,
        grade_applying: gradeApplying,
        boarding_option: boardingOption || false,
        previous_school: previousSchool,
        additional_notes: additionalNotes
      });
      
      if (emailResult.success) {
        console.log('✅ Enrollment notification email sent successfully');
      } else {
        console.log('⚠️ Enrollment saved but email notification failed:', emailResult.error);
      }
    } catch (emailError) {
      console.error('⚠️ Email notification error (enrollment still saved):', emailError.message);
    }

    res.status(201).json({
      message: 'Enrollment application submitted successfully',
      enrollment: enrollment
    });
  } catch (error) {
    console.error('Enrollment submission error:', error);
    res.status(500).json({ message: 'Failed to submit enrollment application' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM enrollments';
    const params = [];
    
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    const countQuery = status 
      ? 'SELECT COUNT(*) FROM enrollments WHERE status = $1'
      : 'SELECT COUNT(*) FROM enrollments';
    const countResult = await db.query(countQuery, status ? [status] : []);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      enrollments: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ message: 'Failed to fetch enrollments' });
  }
});

router.get('/stats', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'waitlisted') as waitlisted,
        COUNT(*) as total
      FROM enrollments
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching enrollment stats:', error);
    res.status(500).json({ message: 'Failed to fetch enrollment statistics' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { id } = req.params;
    const result = await db.query('SELECT * FROM enrollments WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching enrollment:', error);
    res.status(500).json({ message: 'Failed to fetch enrollment' });
  }
});

router.put('/:id/status', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['pending', 'approved', 'rejected', 'waitlisted'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const result = await db.query(`
      UPDATE enrollments 
      SET status = $1, admin_notes = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `, [status, adminNotes || null, req.user.id, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    res.json({
      message: `Enrollment ${status}`,
      enrollment: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating enrollment status:', error);
    res.status(500).json({ message: 'Failed to update enrollment status' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { id } = req.params;
    const result = await db.query('DELETE FROM enrollments WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    res.json({ message: 'Enrollment deleted successfully' });
  } catch (error) {
    console.error('Error deleting enrollment:', error);
    res.status(500).json({ message: 'Failed to delete enrollment' });
  }
});

module.exports = router;
