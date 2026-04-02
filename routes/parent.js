const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { sendSMS } = require('../services/sms');

const requireParent = [authenticate, authorize('parent')];
const requireAdmin  = [authenticate, authorize('admin', 'super_admin')];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/[\s\-().+]/g, '').replace(/^0/, '27');
}

function generateTempPassword() {
  const words = ['Lion','Tiger','Eagle','River','Stone','Cloud','Flame','Storm'];
  const nums  = Math.floor(100 + Math.random() * 900);
  return words[Math.floor(Math.random() * words.length)] + nums + '!';
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function getChildren(parentId) {
  const result = await db.query(`
    SELECT u.id, u.first_name, u.last_name, u.student_number,
           g.name AS grade_name, c.name AS class_name,
           u.grade_id, u.class_id
    FROM parent_students ps
    JOIN users u  ON u.id  = ps.student_id
    LEFT JOIN grades g  ON g.id = u.grade_id
    LEFT JOIN classes c ON c.id = u.class_id
    WHERE ps.parent_id = $1
    ORDER BY g.name, u.last_name
  `, [parentId]);
  return result.rows;
}

async function resolveChild(parentId, requestedChildId) {
  const children = await getChildren(parentId);
  if (children.length === 0) throw { status: 404, message: 'No child linked to this account' };
  if (requestedChildId) {
    const found = children.find(c => c.id === parseInt(requestedChildId));
    if (!found) throw { status: 403, message: 'That student is not linked to your account' };
    return found;
  }
  return children[0];
}

// ─── GET /api/parent/me ───────────────────────────────────────────────────────
router.get('/me', requireParent, async (req, res) => {
  try {
    const children = await getChildren(req.user.id);
    const childId  = req.query.child_id;
    const child    = childId ? children.find(c => c.id === parseInt(childId)) || children[0] : children[0];
    res.json({ parent: req.user, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent /me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/dashboard ────────────────────────────────────────────────
router.get('/dashboard', requireParent, async (req, res) => {
  try {
    const children = await getChildren(req.user.id);
    if (children.length === 0) {
      return res.json({ children: [], child: null, weekAttendance: {}, recentGrades: [], outstandingBalance: 0, recentAnnouncements: [] });
    }
    const child = req.query.child_id
      ? (children.find(c => c.id === parseInt(req.query.child_id)) || children[0])
      : children[0];

    const [attendanceRes, gradesRes, invoiceRes, announcementsRes] = await Promise.all([
      db.query(`
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
      `, [child.id]),

      db.query(`
        SELECT s.id, s.score, s.max_score, s.status, s.submitted_at,
               t.title AS task_title, t.task_type
        FROM submissions s
        JOIN tasks t ON s.task_id = t.id
        WHERE s.student_id = $1 AND s.score IS NOT NULL
        ORDER BY s.submitted_at DESC LIMIT 5
      `, [child.id]),

      db.query(`
        SELECT COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
        FROM invoices
        WHERE student_id = $1 AND status IN ('Unpaid','Partial')
      `, [child.id]),

      db.query(`
        SELECT id, title, content, created_at
        FROM announcements
        WHERE is_active = true AND (grade_id IS NULL OR grade_id = $1)
        ORDER BY created_at DESC LIMIT 3
      `, [child.grade_id]),
    ]);

    const wa = attendanceRes.rows[0];
    res.json({
      children,
      child,
      weekAttendance: {
        present: parseInt(wa.present), absent: parseInt(wa.absent),
        late: parseInt(wa.late),       excused: parseInt(wa.excused),
        total: parseInt(wa.total),
      },
      recentGrades: gradesRes.rows,
      outstandingBalance: parseFloat(invoiceRes.rows[0].total_outstanding),
      recentAnnouncements: announcementsRes.rows,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent dashboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/attendance ───────────────────────────────────────────────
router.get('/attendance', requireParent, async (req, res) => {
  try {
    const child = await resolveChild(req.user.id, req.query.child_id);
    const { month, year } = req.query;
    let where = 'WHERE student_id = $1';
    const params = [child.id];
    if (month && year) {
      params.push(parseInt(month), parseInt(year));
      where += ` AND EXTRACT(MONTH FROM date)=$${params.length-1} AND EXTRACT(YEAR FROM date)=$${params.length}`;
    } else {
      where += ` AND date >= CURRENT_DATE - INTERVAL '60 days'`;
    }
    const result = await db.query(`SELECT id, date, status, notes FROM attendance ${where} ORDER BY date DESC`, params);
    const summary = result.rows.reduce((acc, r) => { acc[r.status] = (acc[r.status]||0)+1; return acc; }, {});
    const children = await getChildren(req.user.id);
    res.json({ records: result.rows, summary, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/grades ───────────────────────────────────────────────────
router.get('/grades', requireParent, async (req, res) => {
  try {
    const child = await resolveChild(req.user.id, req.query.child_id);
    const children = await getChildren(req.user.id);

    const [submissionsRes, childInfoRes] = await Promise.all([
      db.query(`
        SELECT s.id, s.score, s.max_score, s.status, s.submitted_at, s.feedback,
               t.id AS task_id, t.title AS task_title, t.task_type, t.due_date, t.max_score AS task_max_score
        FROM submissions s
        JOIN tasks t ON s.task_id = t.id
        WHERE s.student_id = $1
        ORDER BY s.submitted_at DESC
      `, [child.id]),
      db.query(`SELECT grade_id, class_id FROM users WHERE id = $1`, [child.id]),
    ]);

    let pending = [];
    const { grade_id, class_id } = childInfoRes.rows[0] || {};
    if (grade_id && class_id) {
      const pendingRes = await db.query(`
        SELECT t.id, t.title, t.task_type, t.due_date, t.max_score
        FROM tasks t
        WHERE t.grade_id=$1 AND t.class_id=$2 AND t.is_active=true
          AND t.id NOT IN (SELECT task_id FROM submissions WHERE student_id=$3)
        ORDER BY t.due_date ASC LIMIT 10
      `, [grade_id, class_id, child.id]);
      pending = pendingRes.rows;
    }
    res.json({ submissions: submissionsRes.rows, pendingTasks: pending, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/announcements ───────────────────────────────────────────
router.get('/announcements', requireParent, async (req, res) => {
  try {
    const child = await resolveChild(req.user.id, req.query.child_id);
    const children = await getChildren(req.user.id);
    const result = await db.query(`
      SELECT a.id, a.title, a.content, a.created_at,
             u.first_name||' '||u.last_name AS author, g.name AS grade_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.grade_id = g.id
      WHERE a.is_active=true AND (a.grade_id IS NULL OR a.grade_id=$1)
      ORDER BY a.created_at DESC LIMIT 50
    `, [child.grade_id]);
    res.json({ announcements: result.rows, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/invoices ─────────────────────────────────────────────────
router.get('/invoices', requireParent, async (req, res) => {
  try {
    const child = await resolveChild(req.user.id, req.query.child_id);
    const children = await getChildren(req.user.id);
    const result = await db.query(`
      SELECT id, amount_due, amount_paid, outstanding_balance, status, due_date,
             COALESCE(description, '') AS description, reference_number
      FROM invoices WHERE student_id=$1 ORDER BY due_date DESC
    `, [child.id]);
    const totals = result.rows.reduce((acc, inv) => {
      acc.totalDue    += parseFloat(inv.amount_due)           || 0;
      acc.totalPaid   += parseFloat(inv.amount_paid)          || 0;
      acc.outstanding += parseFloat(inv.outstanding_balance)  || 0;
      return acc;
    }, { totalDue: 0, totalPaid: 0, outstanding: 0 });
    res.json({ invoices: result.rows, totals, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/parent/change-password ────────────────────────────────────────
// Used for forced first-time password change
router.post('/change-password', requireParent, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  try {
    const hashed = await bcrypt.hash(new_password, 12);
    await db.query(
      `UPDATE users SET password=$1, must_change_password=false, temp_password_plain=NULL, updated_at=NOW() WHERE id=$2`,
      [hashed, req.user.id]
    );
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/parent/admin/list
router.get('/admin/list', requireAdmin, async (req, res) => {
  try {
    // Get all parents with all their linked children
    const parentsRes = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.phone_number, u.email, u.is_active,
             u.must_change_password, u.created_at
      FROM users u
      WHERE u.role = 'parent'
      ORDER BY u.last_name, u.first_name
    `);

    const parents = parentsRes.rows;
    if (parents.length === 0) return res.json({ parents: [] });

    const parentIds = parents.map(p => p.id);
    const childrenRes = await db.query(`
      SELECT ps.parent_id,
             s.id AS child_id, s.first_name||' '||s.last_name AS child_name,
             s.student_number AS child_student_number,
             g.name AS child_grade, c.name AS child_class
      FROM parent_students ps
      JOIN users s ON s.id = ps.student_id
      LEFT JOIN grades g ON g.id = s.grade_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE ps.parent_id = ANY($1)
    `, [parentIds]);

    const childMap = {};
    childrenRes.rows.forEach(r => {
      if (!childMap[r.parent_id]) childMap[r.parent_id] = [];
      childMap[r.parent_id].push(r);
    });

    const result = parents.map(p => ({
      ...p,
      children: childMap[p.id] || [],
      // Backward compat fields
      child_name: childMap[p.id]?.[0]?.child_name,
      child_id:   childMap[p.id]?.[0]?.child_id,
      child_student_number: childMap[p.id]?.[0]?.child_student_number,
      child_grade: childMap[p.id]?.[0]?.child_grade,
    }));

    res.json({ parents: result });
  } catch (err) {
    console.error('Admin parent list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/parent/admin/pending-otps – OTPs for admin when SMS not configured
router.get('/admin/pending-otps', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT phone_number, otp_code, created_at, expires_at
      FROM parent_otps
      WHERE used=false AND expires_at > NOW()
      ORDER BY created_at DESC
    `);
    res.json({ otps: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/parent/admin/create
router.post('/admin/create', requireAdmin, async (req, res) => {
  const { first_name, last_name, phone_number, student_ids, email } = req.body;
  const students = Array.isArray(student_ids) ? student_ids : student_ids ? [student_ids] : [];

  if (!first_name || !last_name || !phone_number) {
    return res.status(400).json({ message: 'first_name, last_name and phone_number are required' });
  }
  if (students.length === 0) {
    return res.status(400).json({ message: 'At least one student must be linked' });
  }

  const normalizedPhone = normalizePhone(phone_number);

  try {
    // Check if parent with this phone already exists
    const existing = await db.query(
      `SELECT id FROM users WHERE phone_number=$1 AND role='parent'`, [normalizedPhone]
    );

    let parentId;
    let tempPassword = null;

    if (existing.rows.length > 0) {
      // Parent exists – just add the new student links
      parentId = existing.rows[0].id;
    } else {
      // Create new parent
      tempPassword = generateTempPassword();
      const hashed = await bcrypt.hash(tempPassword, 12);

      const userResult = await db.query(`
        INSERT INTO users (first_name, last_name, phone_number, email, password, role, is_active, must_change_password, temp_password_plain)
        VALUES ($1, $2, $3, $4, $5, 'parent', true, true, $6)
        RETURNING id, first_name, last_name, phone_number, role, created_at
      `, [first_name, last_name, normalizedPhone, email || null, hashed, tempPassword]);

      parentId = userResult.rows[0].id;
    }

    // Link students (ignore duplicate links)
    const linked = [];
    const failed = [];
    for (const sid of students) {
      const studentCheck = await db.query(
        `SELECT id, first_name, last_name, student_number FROM users WHERE id=$1 AND role='student'`, [sid]
      );
      if (studentCheck.rows.length === 0) { failed.push(sid); continue; }

      try {
        await db.query(`
          INSERT INTO parent_students (parent_id, student_id)
          VALUES ($1, $2)
          ON CONFLICT (parent_id, student_id) DO NOTHING
        `, [parentId, sid]);
        linked.push(studentCheck.rows[0]);
      } catch { failed.push(sid); }
    }

    res.status(201).json({
      success: true,
      message: existing.rows.length > 0 ? 'Students added to existing parent account' : 'Parent account created',
      parentId,
      tempPassword,
      linkedStudents: linked,
      failedStudents: failed,
      isExisting: existing.rows.length > 0,
    });
  } catch (err) {
    console.error('Create parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/parent/admin/:parentId
router.put('/admin/:parentId', requireAdmin, async (req, res) => {
  const { parentId } = req.params;
  const { first_name, last_name, phone_number, email, password, is_active, add_student_ids, remove_student_ids } = req.body;

  try {
    const sets = [];
    const params = [];
    if (first_name  !== undefined) { params.push(first_name);                    sets.push(`first_name=$${params.length}`); }
    if (last_name   !== undefined) { params.push(last_name);                     sets.push(`last_name=$${params.length}`); }
    if (email       !== undefined) { params.push(email);                         sets.push(`email=$${params.length}`); }
    if (is_active   !== undefined) { params.push(is_active);                     sets.push(`is_active=$${params.length}`); }
    if (phone_number !== undefined) { params.push(normalizePhone(phone_number)); sets.push(`phone_number=$${params.length}`); }
    if (password) {
      const hashed = await bcrypt.hash(password, 12);
      params.push(hashed); sets.push(`password=$${params.length}`);
      sets.push(`must_change_password=true`);
    }

    if (sets.length > 0) {
      params.push(parentId);
      await db.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} AND role='parent'`, params
      );
    }

    if (Array.isArray(add_student_ids)) {
      for (const sid of add_student_ids) {
        await db.query(
          `INSERT INTO parent_students(parent_id,student_id) VALUES($1,$2) ON CONFLICT(parent_id,student_id) DO NOTHING`,
          [parentId, sid]
        ).catch(() => {});
      }
    }
    if (Array.isArray(remove_student_ids)) {
      for (const sid of remove_student_ids) {
        await db.query(`DELETE FROM parent_students WHERE parent_id=$1 AND student_id=$2`, [parentId, sid]);
      }
    }

    res.json({ success: true, message: 'Parent account updated' });
  } catch (err) {
    console.error('Update parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/parent/admin/:parentId
router.delete('/admin/:parentId', requireAdmin, async (req, res) => {
  try {
    await db.query(`DELETE FROM parent_students WHERE parent_id=$1`, [req.params.parentId]);
    await db.query(`DELETE FROM users WHERE id=$1 AND role='parent'`, [req.params.parentId]);
    res.json({ success: true, message: 'Parent account deleted' });
  } catch (err) {
    console.error('Delete parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/parent/admin/reset-password/:parentId  – admin resets a parent's password
router.post('/admin/reset-password/:parentId', requireAdmin, async (req, res) => {
  try {
    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);
    await db.query(
      `UPDATE users SET password=$1, must_change_password=true, temp_password_plain=$2, updated_at=NOW() WHERE id=$3 AND role='parent'`,
      [hashed, tempPassword, req.params.parentId]
    );
    res.json({ success: true, tempPassword });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/parent/welcome-password – public endpoint, no auth required
// Returns temp password if phone matches an account that hasn't changed it yet
router.get('/welcome-password', async (req, res) => {
  const rawPhone = (req.query.phone || '').trim();
  if (!rawPhone) return res.status(400).json({ message: 'Phone number is required' });
  const normalized = rawPhone.replace(/[\s\-().+]/g, '').replace(/^0/, '27');

  try {
    const result = await db.query(`
      SELECT first_name, last_name, temp_password_plain, must_change_password
      FROM users
      WHERE (phone_number=$1 OR phone_number=$2) AND role='parent' AND is_active=true
      LIMIT 1
    `, [normalized, rawPhone]);

    if (result.rows.length === 0) {
      return res.json({ found: false });
    }

    const user = result.rows[0];

    if (!user.must_change_password || !user.temp_password_plain) {
      // Account found but password already changed — don't reveal anything
      return res.json({ found: true, already_set: true });
    }

    res.json({
      found: true,
      already_set: false,
      first_name: user.first_name,
      temp_password: user.temp_password_plain,
    });
  } catch (err) {
    console.error('Welcome password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/parent/admin/sync-enrollments – auto-create parents from enrollment data
router.post('/admin/sync-enrollments', requireAdmin, async (req, res) => {
  try {
    // Pull enrollment records that have a parent_phone
    const enrollments = await db.query(`
      SELECT DISTINCT e.parent_phone, e.parent_first_name, e.parent_last_name, e.parent_email,
             u.id AS student_id
      FROM enrollments e
      JOIN users u ON (
        LOWER(u.first_name) = LOWER(e.student_first_name)
        AND LOWER(u.last_name) = LOWER(e.student_last_name)
        AND u.role = 'student'
      )
      WHERE e.parent_phone IS NOT NULL AND e.parent_phone != ''
        AND e.status = 'approved'
    `);

    let created = 0, linked = 0, skipped = 0;

    for (const row of enrollments.rows) {
      const normalizedPhone = normalizePhone(row.parent_phone);
      if (!normalizedPhone) { skipped++; continue; }

      // Check existing parent
      const existing = await db.query(
        `SELECT id FROM users WHERE phone_number=$1 AND role='parent'`, [normalizedPhone]
      );

      let parentId;
      if (existing.rows.length === 0) {
        const tempPass = generateTempPassword();
        const hashed   = await bcrypt.hash(tempPass, 12);
        const pr = await db.query(`
          INSERT INTO users (first_name, last_name, phone_number, email, password, role, is_active, must_change_password)
          VALUES ($1, $2, $3, $4, $5, 'parent', true, true)
          RETURNING id
        `, [row.parent_first_name||'Parent', row.parent_last_name||'', normalizedPhone, row.parent_email||null, hashed]);
        parentId = pr.rows[0].id;
        created++;
      } else {
        parentId = existing.rows[0].id;
      }

      if (row.student_id) {
        const before = await db.query(
          `SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2`, [parentId, row.student_id]
        );
        if (before.rows.length === 0) {
          await db.query(
            `INSERT INTO parent_students(parent_id,student_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [parentId, row.student_id]
          );
          linked++;
        } else { skipped++; }
      }
    }

    res.json({ success: true, created, linked, skipped });
  } catch (err) {
    console.error('Sync enrollments error:', err);
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

module.exports = router;
