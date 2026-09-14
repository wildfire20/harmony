const express = require('express');
const router = express.Router();
const db = require('../config/database');
const {
  createOneOffFeeNotifications,
  deliverOneOffFeeNotifications,
} = require('../services/parentNotificationService');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, getIp } = require('../utils/auditLogger');

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
  const client = await db.pool.connect();
  try {
    const { name, description, amount, grade_id, due_date } = req.body;
    if (!name || !amount) return res.status(400).json({ message: 'Name and amount are required' });
    if (parseFloat(amount) <= 0) return res.status(400).json({ message: 'Amount must be greater than zero' });

    // Create the fee
    await client.query('BEGIN');
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (idempotencyKey) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Invalid request key' });
      }
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('student-fee-create'), hashtext($1))`,
        [idempotencyKey],
      );
      const existing = await client.query(`
        SELECT f.* FROM audit_logs a
        JOIN student_one_off_fees f ON f.id=a.entity_id
        WHERE a.action='one_off_fee_created' AND a.entity_type='one_off_fee'
          AND a.user_id=$1 AND a.details->>'idempotency_key'=$2
        ORDER BY a.id DESC LIMIT 1
      `, [req.user.id, idempotencyKey]);
      if (existing.rows.length) {
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Fee was already created', fee: existing.rows[0], duplicate: true });
      }
    }
    const feeResult = await client.query(`
      INSERT INTO student_one_off_fees (name, description, amount, grade_id, due_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, description || null, parseFloat(amount).toFixed(2),
        grade_id || null, due_date || null, req.user.id]);

    const fee = feeResult.rows[0];

    // If a grade was specified, auto-assign to all active students in that grade
    let assignedCount = 0;
    if (grade_id) {
      const students = await client.query(`
        SELECT id FROM users WHERE role='student' AND grade_id=$1 AND is_active=true
      `, [grade_id]);

      if (students.rows.length > 0) {
        for (const student of students.rows) {
          await client.query(`
            INSERT INTO student_fee_assignments (fee_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT (fee_id, student_id) DO NOTHING
          `, [fee.id, student.id]);
        }
        assignedCount = students.rows.length;
      }
    }

    // Get grade name for announcement
    let gradeName = null;
    if (grade_id) {
      const gradeRes = await client.query('SELECT name FROM grades WHERE id=$1', [grade_id]);
      gradeName = gradeRes.rows[0]?.name || null;
    }

    // Auto-create announcement for this fee
    try {
      const annTitle = `New Fee: ${name}${gradeName ? ` (${gradeName})` : ''}`;
      const annBody = [
        description || '',
        `Amount: R ${parseFloat(amount).toFixed(2)}`,
        due_date ? `Due: ${new Date(due_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}` : '',
        'Please submit proof of payment via the Fees screen.'
      ].filter(Boolean).join('\n');

      await client.query(`
        INSERT INTO announcements (title, content, priority, grade_id, class_id, target_audience, created_by)
        VALUES ($1, $2, 'high', $3, NULL, 'students', $4)
        RETURNING id, title, priority, grade_id, class_id, target_audience, created_at
      `, [annTitle, annBody, grade_id || null, req.user.id]);
    } catch (notifyErr) {
      console.warn('Fee notification/announcement error:', notifyErr.message);
    }

    const assignedLearners = await client.query(
      'SELECT student_id FROM student_fee_assignments WHERE fee_id=$1 ORDER BY student_id',
      [fee.id],
    );
    const notificationResult = await createOneOffFeeNotifications({
      fee,
      learnerIds: assignedLearners.rows.map((row) => row.student_id),
      executor: client,
    });
    await logAudit({
      executor: client,
      required: true,
      userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'one_off_fee_created',
      entityType: 'one_off_fee',
      entityId: fee.id,
      details: { idempotency_key: idempotencyKey || null, assigned_count: assignedCount },
      ipAddress: getIp(req),
    });
    await client.query('COMMIT');
    await deliverOneOffFeeNotifications({ recipients: notificationResult.createdRecipients });

    res.status(201).json({ message: `Fee created and assigned to ${assignedCount} student(s)`, fee });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Create fee error:', err);
    res.status(500).json({ message: 'Server error creating fee' });
  } finally {
    client.release();
  }
});

// ─── POST /api/student-fees/:id/assign  (admin: assign to specific student) ──
router.post('/:id/assign', requireAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ message: 'student_id is required' });

    await client.query('BEGIN');
    const fee = (await client.query('SELECT * FROM student_one_off_fees WHERE id=$1 AND is_active=true FOR UPDATE', [req.params.id])).rows[0];
    if (!fee) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fee not found' });
    }

    const learner = await client.query(
      `SELECT id FROM users WHERE id=$1 AND role='student' AND is_active=true`,
      [student_id],
    );
    if (!learner.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Active learner not found' });
    }
    const assignment = await client.query(`
      INSERT INTO student_fee_assignments (fee_id, student_id)
      VALUES ($1, $2)
      ON CONFLICT (fee_id, student_id) DO NOTHING
      RETURNING id
    `, [fee.id, student_id]);
    let notificationResult = { createdRecipients: [] };
    if (assignment.rows.length) {
      notificationResult = await createOneOffFeeNotifications({
        fee,
        learnerIds: [student_id],
        executor: client,
      });
    }
    await client.query('COMMIT');
    await deliverOneOffFeeNotifications({ recipients: notificationResult.createdRecipients });
    res.json({ message: assignment.rows.length ? 'Fee assigned to student' : 'Fee was already assigned' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Assign fee error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
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
    if (!childResult.rows.length) {
      if (childId) return res.status(403).json({ message: 'That student is not linked to your account' });
      return res.json({ fees: [], child: null });
    }
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
