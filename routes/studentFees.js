const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const requireAdmin = [authenticate, authorize('admin', 'super_admin')];
const requireParent = [authenticate, authorize('parent')];

// ─── GET /api/student-fees  (admin: list all) ────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT f.*,
             g.name AS grade_name,
             c.first_name AS created_by_first_name, c.last_name AS created_by_last_name,
             COUNT(DISTINCT fa.id) AS assignment_count
      FROM student_one_off_fees f
      LEFT JOIN grades g ON g.id = f.grade_id
      LEFT JOIN users c ON c.id = f.created_by
      LEFT JOIN student_fee_assignments fa ON fa.fee_id = f.id
      WHERE f.is_active = true
      GROUP BY f.id, g.name, c.first_name, c.last_name
      ORDER BY f.created_at DESC
    `);
    res.json({ fees: result.rows });
  } catch (err) {
    console.error('List fees error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/student-fees  (admin: create fee) ─────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, amount, grade_id, due_date } = req.body;
    if (!name || !amount) return res.status(400).json({ message: 'Name and amount are required' });
    if (parseFloat(amount) <= 0) return res.status(400).json({ message: 'Amount must be greater than zero' });

    // Create the fee
    const feeResult = await db.query(`
      INSERT INTO student_one_off_fees (name, description, amount, grade_id, due_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, description || null, parseFloat(amount).toFixed(2),
        grade_id || null, due_date || null, req.user.id]);

    const fee = feeResult.rows[0];

    // If a grade was specified, auto-assign to all active students in that grade
    let assignedCount = 0;
    if (grade_id) {
      const students = await db.query(`
        SELECT id FROM users WHERE role='student' AND grade_id=$1 AND is_active=true
      `, [grade_id]);

      if (students.rows.length > 0) {
        for (const student of students.rows) {
          await db.query(`
            INSERT INTO student_fee_assignments (fee_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT (fee_id, student_id) DO NOTHING
          `, [fee.id, student.id]);
        }
        assignedCount = students.rows.length;
      }
    }

    res.status(201).json({ message: `Fee created and assigned to ${assignedCount} student(s)`, fee });
  } catch (err) {
    console.error('Create fee error:', err);
    res.status(500).json({ message: 'Server error creating fee' });
  }
});

// ─── POST /api/student-fees/:id/assign  (admin: assign to specific student) ──
router.post('/:id/assign', requireAdmin, async (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ message: 'student_id is required' });

    const fee = (await db.query('SELECT * FROM student_one_off_fees WHERE id=$1 AND is_active=true', [req.params.id])).rows[0];
    if (!fee) return res.status(404).json({ message: 'Fee not found' });

    await db.query(`
      INSERT INTO student_fee_assignments (fee_id, student_id)
      VALUES ($1, $2)
      ON CONFLICT (fee_id, student_id) DO NOTHING
    `, [fee.id, student_id]);

    res.json({ message: 'Fee assigned to student' });
  } catch (err) {
    console.error('Assign fee error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── DELETE /api/student-fees/:id  (admin: deactivate fee) ───────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE student_one_off_fees SET is_active=false WHERE id=$1 RETURNING id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Fee not found' });
    res.json({ message: 'Fee removed' });
  } catch (err) {
    console.error('Delete fee error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/student-fees/for-child  (parent: get fees for their child) ─────
router.get('/for-child', requireParent, async (req, res) => {
  try {
    const childId = req.query.child_id;
    const q = childId
      ? `SELECT u.* FROM users u JOIN parent_students ps ON ps.student_id=u.id WHERE ps.parent_id=$1 AND u.id=$2 LIMIT 1`
      : `SELECT u.* FROM users u JOIN parent_students ps ON ps.student_id=u.id WHERE ps.parent_id=$1 LIMIT 1`;
    const params = childId ? [req.user.id, childId] : [req.user.id];
    const childResult = await db.query(q, params);
    if (!childResult.rows.length) return res.status(404).json({ message: 'Child not found' });
    const child = childResult.rows[0];

    const result = await db.query(`
      SELECT f.*, fa.id AS assignment_id
      FROM student_one_off_fees f
      JOIN student_fee_assignments fa ON fa.fee_id = f.id
      WHERE fa.student_id = $1 AND f.is_active = true
      ORDER BY f.created_at DESC
    `, [child.id]);

    res.json({ fees: result.rows, child });
  } catch (err) {
    console.error('Parent fees error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
