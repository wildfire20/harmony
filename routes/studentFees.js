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

/*
 * One-off assignments become ordinary immutable invoice snapshots. This keeps
 * one-off fees in the existing finance ledger rather than maintaining a
 * parallel paid flag or payment calculation. Existing assignments are not
 * reconstructed here; only a newly-created assignment receives a snapshot.
 */
async function createOneOffLedgerInvoice(executor, fee, studentId, assignmentId, createdBy) {
  try {
    const existing = await executor.query(`
      SELECT i.id
      FROM invoices i
      JOIN invoice_line_items li ON li.invoice_id = i.id
      WHERE li.metadata->>'category' = 'one_off'
        AND li.metadata->>'assignment_id' = $1
      LIMIT 1
    `, [String(assignmentId)]);
    if (existing.rows.length) return existing.rows[0].id;

    const dueDate = fee.due_date || new Date().toISOString().slice(0, 10);
    const reference = `ONEOFF-${fee.id}-${studentId}`;
    const invoice = await executor.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, due_date, status,
         reference_number, description, created_by, created_at)
      SELECT u.id, u.student_number, $1, $2, 'Unpaid', $3, $4, $5, CURRENT_TIMESTAMP
      FROM users u
      WHERE u.id = $6 AND u.role = 'student'
      RETURNING id
    `, [
      Number(fee.amount), dueDate, reference, `One-off fee: ${fee.name}`,
      createdBy || null, studentId,
    ]);
    if (!invoice.rows.length) throw new Error('Learner not found while creating one-off ledger obligation');
    await executor.query(`
      INSERT INTO invoice_line_items
        (invoice_id, line_type, service_key, label, description,
         quantity, unit_amount, amount, is_included, metadata)
      VALUES ($1, 'charge', 'one_off_fee', $2, $3, 1, $4, $4, false, $5::jsonb)
    `, [
      invoice.rows[0].id, fee.name, fee.description || null, Number(fee.amount),
      JSON.stringify({
        category: 'one_off',
        fee_id: Number(fee.id),
        assignment_id: Number(assignmentId),
      }),
    ]);
    return invoice.rows[0].id;
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') {
      throw new Error('One-off ledger obligations require migrations/mini_phase1_finance_truth.sql and migrations/finance_multi_allocation.sql');
    }
    throw error;
  }
}

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

// ─── GET /api/student-fees/:id/reconciliation (admin detail) ────────────────
// Counts are projections of invoice balances/payment allocations and pending
// submissions. There is intentionally no editable "paid" flag.
router.get('/:id/reconciliation', requireAdmin, async (req, res) => {
  try {
    const feeResult = await db.query(`
      SELECT f.*, g.name AS grade_name
      FROM student_one_off_fees f
      LEFT JOIN grades g ON g.id = f.grade_id
      WHERE f.id = $1
    `, [req.params.id]);
    if (!feeResult.rows.length) return res.status(404).json({ message: 'Fee not found' });
    const fee = feeResult.rows[0];
    const assignments = await db.query(`
      SELECT fa.id AS assignment_id, fa.student_id,
             u.first_name, u.last_name, u.student_number,
             COALESCE(i.amount_due, f.amount) AS due,
             COALESCE(i.amount_paid, 0) AS paid,
             GREATEST(COALESCE(i.amount_due, f.amount) - COALESCE(i.amount_paid, 0), 0) AS outstanding,
             i.id AS invoice_id, i.status AS invoice_status
      FROM student_fee_assignments fa
      JOIN student_one_off_fees f ON f.id = fa.fee_id
      JOIN users u ON u.id = fa.student_id
      LEFT JOIN LATERAL (
        SELECT i.id, i.amount_due, i.amount_paid, i.status
        FROM invoices i
        JOIN invoice_line_items li ON li.invoice_id = i.id
        WHERE i.student_id = fa.student_id
          AND li.metadata->>'category' = 'one_off'
          AND li.metadata->>'assignment_id' = fa.id::text
        ORDER BY i.id DESC
        LIMIT 1
      ) i ON TRUE
      WHERE fa.fee_id = $1
      ORDER BY u.last_name, u.first_name, fa.id
    `, [req.params.id]);
    let pendingRows = [];
    try {
      const pending = await db.query(`
        SELECT student_id, selected_obligations
        FROM pending_payments
        WHERE status = 'pending'
          AND selected_obligations @> $1::jsonb
      `, [JSON.stringify([{ fee_id: Number(req.params.id) }])]);
      pendingRows = pending.rows;
    } catch (error) {
      if (error.code !== '42P01' && error.code !== '42703') throw error;
    }
    const learners = assignments.rows.map((row) => {
      const pendingForFee = pendingRows
        .filter((item) => Number(item.student_id) === Number(row.student_id))
        .flatMap((item) => Array.isArray(item.selected_obligations) ? item.selected_obligations : [])
        .filter((item) => Number(item.fee_id) === Number(req.params.id));
      const pendingAmount = pendingForFee.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const due = Number(row.due || 0);
      const paid = Number(row.paid || 0);
      const status = paid >= due && due > 0 ? 'PAID'
        : pendingForFee.length ? 'PENDING_REVIEW'
          : paid > 0 ? 'PARTIALLY_PAID'
            : row.invoice_id ? 'UNPAID' : 'UNTRACKED';
      return {
        ...row,
        due, paid,
        outstanding: Math.max(0, due - paid),
        pending_amount: pendingAmount,
        status,
      };
    });
    const summary = {
      assigned: learners.length,
      paid: learners.filter((row) => row.status === 'PAID').length,
      pending_review: learners.filter((row) => row.status === 'PENDING_REVIEW').length,
      partially_paid: learners.filter((row) => row.status === 'PARTIALLY_PAID').length,
      unpaid: learners.filter((row) => row.status === 'UNPAID' || row.status === 'UNTRACKED').length,
      expected: learners.reduce((sum, row) => sum + row.due, 0),
      confirmed_collected: learners.reduce((sum, row) => sum + row.paid, 0),
      pending: learners.reduce((sum, row) => sum + row.pending_amount, 0),
      outstanding: learners.reduce((sum, row) => sum + row.outstanding, 0),
    };
    res.json({ fee, summary, learners });
  } catch (error) {
    console.error('One-off reconciliation error:', error);
    res.status(503).json({ message: 'One-off reconciliation is unavailable until the finance-truth schema is applied' });
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
          const assignment = await client.query(`
            INSERT INTO student_fee_assignments (fee_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT (fee_id, student_id) DO NOTHING
            RETURNING id
          `, [fee.id, student.id]);
          if (assignment.rows.length) {
            await createOneOffLedgerInvoice(client, fee, student.id, assignment.rows[0].id, req.user.id);
          }
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
    if (assignment.rows.length) {
      await createOneOffLedgerInvoice(client, fee, student_id, assignment.rows[0].id, req.user.id);
      await logAudit({
        executor: client,
        required: true,
        userId: req.user.id,
        userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        userRole: req.user.role,
        action: 'one_off_fee_assigned',
        entityType: 'one_off_fee',
        entityId: fee.id,
        details: {
          student_id: Number(student_id),
          assignment_id: assignment.rows[0].id,
          invoice_created: true,
        },
        ipAddress: getIp(req),
      });
    }
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
      SELECT f.*, fa.id AS assignment_id,
             i.id AS ledger_invoice_id, i.amount_due AS ledger_amount_due,
             i.amount_paid AS ledger_amount_paid, i.status AS ledger_status,
             GREATEST(i.amount_due - COALESCE(i.amount_paid, 0), 0) AS remaining_amount,
             CASE
               WHEN i.id IS NULL THEN 'UNTRACKED'
               WHEN i.amount_paid >= i.amount_due THEN 'PAID'
               WHEN i.amount_paid > 0 THEN 'PARTIALLY_PAID'
               ELSE 'UNPAID'
             END AS payment_status
      FROM student_one_off_fees f
      JOIN student_fee_assignments fa ON fa.fee_id = f.id
      LEFT JOIN LATERAL (
        SELECT i.id, i.amount_due, i.amount_paid, i.status
        FROM invoices i
        JOIN invoice_line_items li ON li.invoice_id = i.id
        WHERE i.student_id = fa.student_id
          AND li.metadata->>'category' = 'one_off'
          AND li.metadata->>'assignment_id' = fa.id::text
        ORDER BY i.id DESC
        LIMIT 1
      ) i ON TRUE
      WHERE fa.student_id = $1 AND f.is_active = true
      ORDER BY f.created_at DESC
    `, [child.id]);

    // A pending proof is not an allocation and therefore does not change the
    // ledger status. It is still exposed as unavailable for a second payment
    // when the selected obligation is present in the submission proposal.
    let pendingRows = [];
    try {
      const pending = await db.query(`
        SELECT selected_obligations
        FROM pending_payments
        WHERE student_id = $1 AND status = 'pending'
      `, [child.id]);
      pendingRows = pending.rows;
    } catch (error) {
      if (error.code !== '42P01' && error.code !== '42703') throw error;
    }
    const fees = result.rows.map((fee) => {
      const pending = pendingRows.some((row) => Array.isArray(row.selected_obligations) &&
        row.selected_obligations.some((item) => Number(item.fee_id || item.id) === Number(fee.id)));
      const status = pending && fee.payment_status !== 'PAID'
        ? 'PENDING_REVIEW' : fee.payment_status;
      const remaining = fee.remaining_amount == null ? Number(fee.amount) : Number(fee.remaining_amount);
      return {
        ...fee,
        payment_status: status,
        remaining_amount: Math.max(0, remaining),
        is_payable: status === 'UNPAID' || status === 'PARTIALLY_PAID' || status === 'REJECTED',
      };
    });
    res.json({ fees, child });
  } catch (err) {
    console.error('Parent fees error:', err);
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({ message: 'Parent fee lifecycle is unavailable until the finance-truth schema is applied' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
