const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const requireParent = [authenticate, authorize('parent')];
const requireAdmin = [authenticate, authorize('admin', 'super_admin')];

// ─── Helper: get child student_id for a parent ───────────────────────────────
async function getChildId(parentId) {
  const result = await db.query(
    `SELECT student_id FROM parent_students WHERE parent_id = $1 LIMIT 1`,
    [parentId]
  );
  if (result.rows.length === 0) throw { status: 404, message: 'No child linked to this account' };
  return result.rows[0].student_id;
}

// ─── GET /api/parent/me ───────────────────────────────────────────────────────
// Returns the parent's linked child info
router.get('/me', requireParent, async (req, res) => {
  try {
    const childId = await getChildId(req.user.id);
    const child = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number,
             g.name AS grade_name, c.name AS class_name,
             u.grade_id, u.class_id
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id = $1
    `, [childId]);
    res.json({ parent: req.user, child: child.rows[0] || null });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent /me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/dashboard ────────────────────────────────────────────────
// Aggregated summary for the dashboard home screen
router.get('/dashboard', requireParent, async (req, res) => {
  try {
    const childId = await getChildId(req.user.id);

    // Child profile
    const childResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number,
             g.name AS grade_name, c.name AS class_name,
             u.grade_id, u.class_id
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id = $1
    `, [childId]);
    const child = childResult.rows[0];

    // This week's attendance (Mon–Sun)
    const attendanceResult = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'present') AS present,
        COUNT(*) FILTER (WHERE status = 'absent')  AS absent,
        COUNT(*) FILTER (WHERE status = 'late')    AS late,
        COUNT(*) FILTER (WHERE status = 'excused') AS excused,
        COUNT(*) AS total
      FROM attendance
      WHERE student_id = $1
        AND date >= date_trunc('week', CURRENT_DATE)
        AND date <= CURRENT_DATE
    `, [childId]);
    const weekAttendance = attendanceResult.rows[0];

    // Recent 5 graded submissions
    const gradesResult = await db.query(`
      SELECT s.id, s.score, s.max_score, s.status, s.submitted_at,
             t.title AS task_title, t.task_type
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.student_id = $1 AND s.score IS NOT NULL
      ORDER BY s.submitted_at DESC
      LIMIT 5
    `, [childId]);

    // Outstanding invoice balance
    const invoiceResult = await db.query(`
      SELECT COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
      FROM invoices
      WHERE student_id = $1 AND status IN ('Unpaid', 'Partial')
    `, [childId]);

    // Latest 3 announcements
    const announcementsResult = await db.query(`
      SELECT id, title, content, created_at
      FROM announcements
      WHERE is_active = true
        AND (grade_id IS NULL OR grade_id = $1)
      ORDER BY created_at DESC
      LIMIT 3
    `, [child.grade_id]);

    res.json({
      child,
      weekAttendance: {
        present: parseInt(weekAttendance.present),
        absent:  parseInt(weekAttendance.absent),
        late:    parseInt(weekAttendance.late),
        excused: parseInt(weekAttendance.excused),
        total:   parseInt(weekAttendance.total),
      },
      recentGrades: gradesResult.rows,
      outstandingBalance: parseFloat(invoiceResult.rows[0].total_outstanding),
      recentAnnouncements: announcementsResult.rows,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent dashboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/attendance ───────────────────────────────────────────────
// Full attendance history, optional ?month=4&year=2026 filter
router.get('/attendance', requireParent, async (req, res) => {
  try {
    const childId = await getChildId(req.user.id);
    const { month, year } = req.query;

    let whereClause = 'WHERE student_id = $1';
    const params = [childId];

    if (month && year) {
      params.push(parseInt(month), parseInt(year));
      whereClause += ` AND EXTRACT(MONTH FROM date) = $${params.length - 1}
                      AND EXTRACT(YEAR  FROM date) = $${params.length}`;
    } else {
      // default: last 60 days
      whereClause += ` AND date >= CURRENT_DATE - INTERVAL '60 days'`;
    }

    const result = await db.query(`
      SELECT id, date, status, notes
      FROM attendance
      ${whereClause}
      ORDER BY date DESC
    `, params);

    // Summary counts
    const summary = result.rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    res.json({ records: result.rows, summary });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent attendance error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/grades ───────────────────────────────────────────────────
// All graded submissions grouped by task
router.get('/grades', requireParent, async (req, res) => {
  try {
    const childId = await getChildId(req.user.id);

    const result = await db.query(`
      SELECT s.id, s.score, s.max_score, s.status, s.submitted_at, s.feedback,
             t.id AS task_id, t.title AS task_title, t.task_type, t.due_date,
             t.max_score AS task_max_score
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.student_id = $1
      ORDER BY s.submitted_at DESC
    `, [childId]);

    // Also get outstanding (not-yet-submitted) tasks for the child's class
    const childInfo = await db.query(
      `SELECT grade_id, class_id FROM users WHERE id = $1`, [childId]
    );
    const { grade_id, class_id } = childInfo.rows[0] || {};

    let pending = [];
    if (grade_id && class_id) {
      const pendingResult = await db.query(`
        SELECT t.id, t.title, t.task_type, t.due_date, t.max_score
        FROM tasks t
        WHERE t.grade_id = $1 AND t.class_id = $2 AND t.is_active = true
          AND t.id NOT IN (
            SELECT task_id FROM submissions WHERE student_id = $3
          )
        ORDER BY t.due_date ASC
        LIMIT 10
      `, [grade_id, class_id, childId]);
      pending = pendingResult.rows;
    }

    res.json({ submissions: result.rows, pendingTasks: pending });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent grades error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/announcements ───────────────────────────────────────────
// School-wide and grade-specific announcements
router.get('/announcements', requireParent, async (req, res) => {
  try {
    const childId = await getChildId(req.user.id);
    const childInfo = await db.query(
      `SELECT grade_id FROM users WHERE id = $1`, [childId]
    );
    const gradeId = childInfo.rows[0]?.grade_id;

    const result = await db.query(`
      SELECT a.id, a.title, a.content, a.created_at,
             u.first_name || ' ' || u.last_name AS author,
             g.name AS grade_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.grade_id = g.id
      WHERE a.is_active = true
        AND (a.grade_id IS NULL OR a.grade_id = $1)
      ORDER BY a.created_at DESC
      LIMIT 50
    `, [gradeId]);

    res.json({ announcements: result.rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent announcements error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/invoices ─────────────────────────────────────────────────
// Billing history
router.get('/invoices', requireParent, async (req, res) => {
  try {
    const childId = await getChildId(req.user.id);

    const result = await db.query(`
      SELECT id, amount_due, amount_paid, outstanding_balance,
             status, due_date, description, reference_number
      FROM invoices
      WHERE student_id = $1
      ORDER BY due_date DESC
    `, [childId]);

    const totals = result.rows.reduce((acc, inv) => {
      acc.totalDue   += parseFloat(inv.amount_due)           || 0;
      acc.totalPaid  += parseFloat(inv.amount_paid)          || 0;
      acc.outstanding += parseFloat(inv.outstanding_balance) || 0;
      return acc;
    }, { totalDue: 0, totalPaid: 0, outstanding: 0 });

    res.json({ invoices: result.rows, totals });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent invoices error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES – manage parent accounts
// ═══════════════════════════════════════════════════════════════════════════════

const bcrypt = require('bcryptjs');

// GET /api/parent/admin/list – all parent accounts with linked child
router.get('/admin/list', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.is_active, u.created_at,
             s.first_name  || ' ' || s.last_name  AS child_name,
             s.student_number AS child_student_number,
             s.id AS child_id,
             g.name AS child_grade, c.name AS child_class
      FROM users u
      LEFT JOIN parent_students ps ON ps.parent_id = u.id
      LEFT JOIN users s ON s.id = ps.student_id
      LEFT JOIN grades g ON s.grade_id = g.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE u.role = 'parent'
      ORDER BY u.last_name, u.first_name
    `);
    res.json({ parents: result.rows });
  } catch (err) {
    console.error('Admin parent list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/parent/admin/create – create parent account + link to student
router.post('/admin/create', requireAdmin, async (req, res) => {
  const { first_name, last_name, email, password, student_id } = req.body;

  if (!first_name || !last_name || !email || !password || !student_id) {
    return res.status(400).json({ message: 'first_name, last_name, email, password and student_id are required' });
  }

  try {
    // Check email is unique
    const existing = await db.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'A user with this email already exists' });
    }

    // Verify student exists
    const studentCheck = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id = $1 AND role = 'student'`, [student_id]
    );
    if (studentCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Student not found' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create parent user
    const userResult = await db.query(`
      INSERT INTO users (first_name, last_name, email, password, role, is_active)
      VALUES ($1, $2, $3, $4, 'parent', true)
      RETURNING id, first_name, last_name, email, role, created_at
    `, [first_name, last_name, email, hashedPassword]);

    const parent = userResult.rows[0];

    // Link to student
    await db.query(`
      INSERT INTO parent_students (parent_id, student_id)
      VALUES ($1, $2)
      ON CONFLICT (parent_id) DO UPDATE SET student_id = $2
    `, [parent.id, student_id]);

    res.status(201).json({
      success: true,
      message: 'Parent account created',
      parent,
      child: studentCheck.rows[0],
    });
  } catch (err) {
    console.error('Create parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/parent/admin/:parentId – update parent details / re-link child
router.put('/admin/:parentId', requireAdmin, async (req, res) => {
  const { parentId } = req.params;
  const { first_name, last_name, email, password, student_id, is_active } = req.body;

  try {
    const sets = [];
    const params = [];

    if (first_name !== undefined) { params.push(first_name); sets.push(`first_name = $${params.length}`); }
    if (last_name  !== undefined) { params.push(last_name);  sets.push(`last_name = $${params.length}`);  }
    if (email      !== undefined) { params.push(email);      sets.push(`email = $${params.length}`);      }
    if (is_active  !== undefined) { params.push(is_active);  sets.push(`is_active = $${params.length}`); }
    if (password) {
      const hashed = await bcrypt.hash(password, 12);
      params.push(hashed); sets.push(`password = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(parentId);
      await db.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} AND role = 'parent'`,
        params
      );
    }

    if (student_id) {
      await db.query(`
        INSERT INTO parent_students (parent_id, student_id)
        VALUES ($1, $2)
        ON CONFLICT (parent_id) DO UPDATE SET student_id = $2
      `, [parentId, student_id]);
    }

    res.json({ success: true, message: 'Parent account updated' });
  } catch (err) {
    console.error('Update parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/parent/admin/:parentId – remove parent account
router.delete('/admin/:parentId', requireAdmin, async (req, res) => {
  const { parentId } = req.params;
  try {
    await db.query(`DELETE FROM parent_students WHERE parent_id = $1`, [parentId]);
    await db.query(`DELETE FROM users WHERE id = $1 AND role = 'parent'`, [parentId]);
    res.json({ success: true, message: 'Parent account deleted' });
  } catch (err) {
    console.error('Delete parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
