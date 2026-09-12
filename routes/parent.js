const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { generateKidFriendlyPassword } = require('../utils/passwordGenerator');
const BANKING_DETAILS = require('../config/bankingDetails');
const { logAudit, getIp } = require('../utils/auditLogger');
const { issueAuthToken, sendParentAuthEmail, hashToken, revokeUserSessions, withTransaction, authenticateSession } = require('../services/parentAuth');

const requireParent = [authenticate, authorize('parent')];
const requireAdmin  = [authenticate, authorize('admin', 'super_admin')];

const PARENT_NOTIFICATION_LIMIT = 100;
const safePushEndpoint = (value) => {
  if (typeof value !== 'string' || value.length < 12 || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch (_) {
    return null;
  }
};
const safePushKey = (value) => typeof value === 'string' &&
  value.length >= 16 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
const validatePushSubscription = (subscription) => {
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    return 'Invalid subscription object';
  }
  const endpoint = safePushEndpoint(subscription.endpoint);
  if (!endpoint) return 'Push endpoint must be an HTTPS URL no longer than 2048 characters';
  if (!subscription.keys || typeof subscription.keys !== 'object' ||
      !safePushKey(subscription.keys.p256dh) || !safePushKey(subscription.keys.auth)) {
    return 'Push subscription keys are invalid';
  }
  if (subscription.expirationTime != null &&
      (typeof subscription.expirationTime !== 'number' || !Number.isFinite(subscription.expirationTime))) {
    return 'Push subscription expirationTime is invalid';
  }
  if (Buffer.byteLength(JSON.stringify(subscription), 'utf8') > 8192) {
    return 'Push subscription is too large';
  }
  return null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/[\s\-().+]/g, '').replace(/^0/, '27');
}

function parentPortalUrl(pathname, token) {
  const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}${pathname}?token=${encodeURIComponent(token)}`;
}

function generateTempPassword() {
  return generateKidFriendlyPassword();
}

async function getChildren(parentId) {
  const result = await db.query(`
    SELECT u.id, u.first_name, u.last_name, u.student_number,
           g.name AS grade_name, c.name AS class_name,
           u.grade_id, u.class_id,
           COALESCE(u.is_boarder, false) AS is_boarder,
           COALESCE(u.uses_transport, false) AS uses_transport,
           COALESCE(u.uses_aftercare, false) AS uses_aftercare
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
  if (children.length === 0) {
    if (requestedChildId) throw { status: 403, message: 'That student is not linked to your account' };
    return null;
  }
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
    const child    = childId ? children.find(c => c.id === parseInt(childId)) : children[0] || null;
    if (childId && !child) return res.status(403).json({ message: 'That student is not linked to your account' });
    res.json({ parent: req.user, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent /me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/banking-details', requireParent, (req, res) => {
  res.json({ banking: BANKING_DETAILS });
});

// ─── GET /api/parent/dashboard ────────────────────────────────────────────────
router.get('/dashboard', requireParent, async (req, res) => {
  try {
    const children = await getChildren(req.user.id);
    if (children.length === 0) {
      return res.json({ children: [], child: null, weekAttendance: {}, recentGrades: [], outstandingBalance: 0, recentAnnouncements: [] });
    }
    const child = req.query.child_id
      ? children.find(c => c.id === parseInt(req.query.child_id))
      : children[0];
    if (req.query.child_id && !child) {
      return res.status(403).json({ message: 'That student is not linked to your account' });
    }
    if (!child) {
      return res.json({ children, child: null, weekAttendance: {}, recentGrades: [], outstandingBalance: 0, recentAnnouncements: [] });
    }

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
        WHERE is_active = true
          AND target_audience IN ('everyone', 'students')
          AND (grade_id IS NULL OR grade_id = $1)
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
    if (!child) return res.json({ records: [], summary: {}, child: null, children: [] });
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
    if (!child) return res.json({ submissions: [], pendingTasks: [], child: null, children });

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
    if (!child) return res.json({ announcements: [], child: null, children });
    const result = await db.query(`
      SELECT a.id, a.title, a.content, a.created_at,
             u.first_name||' '||u.last_name AS author, g.name AS grade_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      LEFT JOIN grades g ON a.grade_id = g.id
      WHERE a.is_active = true
        AND a.target_audience IN ('everyone', 'students')
        AND (a.grade_id IS NULL OR a.grade_id = $1)
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
    if (!child) return res.json({ invoices: [], totals: { totalDue: 0, totalPaid: 0, outstanding: 0 }, child: null, children });
    const result = await db.query(`
      SELECT id, amount_due, amount_paid, outstanding_balance, status, due_date,
             COALESCE(description, '') AS description, reference_number
      FROM invoices
      WHERE student_id=$1
        AND due_date >= DATE_TRUNC('month', (SELECT created_at FROM users WHERE id=$1))
      ORDER BY due_date DESC
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

// ─── Parent notification centre (durable inbox) ──────────────────────────────
// All ownership comes from the authenticated Phase 2 session.  Learner rows
// are joined through parent_students on every read, so unlinking a learner
// immediately removes that learner's notifications from the inbox.
router.get('/notifications', requireParent, async (req, res) => {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isSafeInteger(requested)
      ? Math.min(PARENT_NOTIFICATION_LIMIT, Math.max(1, requested))
      : 50;
    const result = await db.query(`
      SELECT n.id, n.event_type, n.title, n.summary, n.deep_link,
             CASE
               WHEN n.event_type LIKE 'attendance_%' THEN 'attendance'
               WHEN n.event_type LIKE 'academic_%' THEN 'grades'
               WHEN n.event_type LIKE 'payment_%' OR n.event_type LIKE 'invoice_%' THEN 'payments'
               WHEN n.event_type LIKE 'document_%' THEN 'documents'
               WHEN n.event_type LIKE 'announcement_%' THEN 'announcements'
               ELSE 'notifications'
             END AS category,
             CASE
               WHEN n.event_type LIKE 'attendance_%' THEN 'attendance'
               WHEN n.event_type LIKE 'academic_%' THEN 'grades'
               WHEN n.event_type LIKE 'payment_%' OR n.event_type LIKE 'invoice_%' THEN 'payments'
               WHEN n.event_type LIKE 'document_%' THEN 'documents'
               WHEN n.event_type LIKE 'announcement_%' THEN 'announcements'
               ELSE 'notifications'
             END AS action,
             n.learner_id, n.created_at, n.important,
             CASE WHEN r.read_at IS NULL THEN false ELSE true END AS read,
             r.read_at,
             CASE WHEN n.learner_id IS NULL THEN NULL
                  ELSE concat_ws(' ', learner.first_name, learner.last_name) END AS learner_name
      FROM parent_notifications n
      LEFT JOIN parent_notification_reads r
        ON r.notification_id = n.id AND r.parent_id = n.parent_id
      LEFT JOIN users learner ON learner.id = n.learner_id
      WHERE n.parent_id = $1
        AND (n.learner_id IS NULL OR EXISTS (
          SELECT 1 FROM parent_students current_link
          WHERE current_link.parent_id = $1 AND current_link.student_id = n.learner_id
        ))
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $2
    `, [req.user.id, limit]);
    res.json({ notifications: result.rows });
  } catch (error) {
    // A not-yet-applied manual migration should not be confused with an
    // authorization failure, but the inbox remains unavailable until applied.
    console.error('Parent notification list error:', error.message);
    res.status(503).json({ message: 'Parent notifications are not yet available.' });
  }
});

router.get('/notifications/unread-count', requireParent, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM parent_notifications n
      LEFT JOIN parent_notification_reads r
        ON r.notification_id = n.id AND r.parent_id = n.parent_id
      WHERE n.parent_id = $1 AND r.read_at IS NULL
        AND (n.learner_id IS NULL OR EXISTS (
          SELECT 1 FROM parent_students current_link
          WHERE current_link.parent_id = $1 AND current_link.student_id = n.learner_id
        ))
    `, [req.user.id]);
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (error) {
    console.error('Parent notification count error:', error.message);
    res.status(503).json({ message: 'Parent notifications are not yet available.' });
  }
});

router.put('/notifications/:id/read', requireParent, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid notification ID' });
    const result = await db.query(`
      INSERT INTO parent_notification_reads (notification_id, parent_id, read_at)
      SELECT n.id, n.parent_id, CURRENT_TIMESTAMP
      FROM parent_notifications n
      WHERE n.id = $1 AND n.parent_id = $2
        AND (n.learner_id IS NULL OR EXISTS (
          SELECT 1 FROM parent_students ps
          WHERE ps.parent_id = $2 AND ps.student_id = n.learner_id
        ))
      ON CONFLICT (notification_id, parent_id)
      DO UPDATE SET read_at = COALESCE(parent_notification_reads.read_at, CURRENT_TIMESTAMP)
      RETURNING notification_id, read_at
    `, [id, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Notification not found' });
    res.json({ success: true, notification_id: result.rows[0].notification_id, read_at: result.rows[0].read_at });
  } catch (error) {
    console.error('Mark parent notification read error:', error.message);
    res.status(503).json({ message: 'Parent notifications are not yet available.' });
  }
});

router.put('/notifications/read-all', requireParent, async (req, res) => {
  try {
    const result = await db.query(`
      INSERT INTO parent_notification_reads (notification_id, parent_id, read_at)
      SELECT n.id, n.parent_id, CURRENT_TIMESTAMP
      FROM parent_notifications n
      WHERE n.parent_id = $1
        AND (n.learner_id IS NULL OR EXISTS (
          SELECT 1 FROM parent_students ps
          WHERE ps.parent_id = $1 AND ps.student_id = n.learner_id
        ))
      ON CONFLICT (notification_id, parent_id)
      DO UPDATE SET read_at = COALESCE(parent_notification_reads.read_at, CURRENT_TIMESTAMP)
      RETURNING notification_id
    `, [req.user.id]);
    res.json({ success: true, marked: result.rowCount || 0 });
  } catch (error) {
    console.error('Mark all parent notifications read error:', error.message);
    res.status(503).json({ message: 'Parent notifications are not yet available.' });
  }
});

// ─── GET /api/parent/vapid-key ───────────────────────────────────────────────
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// ─── POST /api/parent/push/subscribe ─────────────────────────────────────────
router.post('/push/subscribe', requireParent, async (req, res) => {
  try {
    const { subscription } = req.body;
    const validationError = validatePushSubscription(subscription);
    if (validationError) return res.status(400).json({ message: validationError });
    const endpoint = safePushEndpoint(subscription.endpoint);
    const existing = await db.query(
      'SELECT parent_id FROM parent_push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    if (existing.rows.length && Number(existing.rows[0].parent_id) !== Number(req.user.id)) {
      return res.status(409).json({ message: 'This push endpoint is already registered to another parent.' });
    }
    const saved = await db.query(`
      INSERT INTO parent_push_subscriptions (parent_id, endpoint, subscription, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (endpoint) DO UPDATE
        SET subscription = EXCLUDED.subscription, is_active = true, updated_at = CURRENT_TIMESTAMP
        WHERE parent_push_subscriptions.parent_id = EXCLUDED.parent_id
      RETURNING id
    `, [req.user.id, endpoint, JSON.stringify({ ...subscription, endpoint })]);
    if (!saved.rows.length) {
      return res.status(409).json({ message: 'This push endpoint is already registered to another parent.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/parent/push/unsubscribe ───────────────────────────────────────
router.post('/push/unsubscribe', requireParent, async (req, res) => {
  try {
    const { endpoint } = req.body;
    const safeEndpoint = safePushEndpoint(endpoint);
    if (!safeEndpoint) return res.status(400).json({ message: 'A valid HTTPS endpoint is required' });
    await db.query('UPDATE parent_push_subscriptions SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE endpoint = $1 AND parent_id = $2',
      [safeEndpoint, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/parent/documents ───────────────────────────────────────────────
router.get('/documents', requireParent, async (req, res) => {
  try {
    const children = await getChildren(req.user.id);
    if (children.length === 0) {
      return res.json({ documents: [], child: null, children: [] });
    }
    if (!req.query.child_id) {
      return res.status(400).json({ message: 'child_id is required to access school documents' });
    }
    const child = await resolveChild(req.user.id, req.query.child_id);
    if (!child) return res.json({ documents: [], child: null, children });
    const result = await db.query(`
      SELECT d.id, d.title, d.description, d.document_type,
             d.original_file_name, d.file_size, d.uploaded_at,
             d.target_audience,
             u.first_name||' '||u.last_name AS uploaded_by
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      WHERE d.is_active = true
        AND d.target_audience IN ('everyone', 'parents')
        AND EXISTS (
          SELECT 1 FROM parent_students ps
          JOIN users child_user ON child_user.id = ps.student_id
          WHERE ps.parent_id = $1
            AND (d.grade_id IS NULL OR child_user.grade_id = d.grade_id)
            AND (d.class_id IS NULL OR child_user.class_id = d.class_id)
            AND child_user.id = $2
        )
      ORDER BY d.uploaded_at DESC
    `, [req.user.id, child.id]);
    res.json({ documents: result.rows, child, children });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Parent documents error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Parent-only file access. Storage locators are never exposed in JSON.
async function getParentDocument(parentId, documentId, childId) {
  if (!childId) throw Object.assign(new Error('child_id is required'), { status: 400 });
  const result = await db.query(`
    SELECT d.id, d.title, d.original_file_name, d.file_name, d.s3_key, d.file_path
    FROM documents d
    WHERE d.id = $1 AND d.is_active = true
      AND d.target_audience IN ('everyone', 'parents')
      AND EXISTS (
        SELECT 1 FROM parent_students ps
        JOIN users child_user ON child_user.id = ps.student_id
          WHERE ps.parent_id = $2 AND ps.student_id = $3
          AND (d.grade_id IS NULL OR child_user.grade_id = d.grade_id)
          AND (d.class_id IS NULL OR child_user.class_id = d.class_id)
      )
  `, [documentId, parentId, childId]);
  return result.rows[0];
}

async function serveParentDocument(req, res, inline) {
  const document = await getParentDocument(req.user.id, req.params.id, req.query.child_id);
  if (!document) return res.status(404).json({ message: 'Document not found' });
  const name = String(document.original_file_name || document.file_name || 'document')
    .replace(/[\r\n"]/g, '_');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ext = String(name).toLowerCase().split('.').pop();
  const contentTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain' };
  res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  if (document.s3_key) {
    const s3Service = require('../services/s3Service');
    return res.send(await s3Service.getFileContent(document.s3_key));
  }
  if (document.file_path && fs.existsSync(document.file_path)) {
    return fs.createReadStream(document.file_path).pipe(res);
  }
  return res.status(404).json({ message: 'Document file is not available' });
}

router.get('/documents/:id/view', requireParent, async (req, res) => {
  try { return await serveParentDocument(req, res, true); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error('Parent document view error:', err); return res.status(404).json({ message: 'Document file is not available' }); }
});

router.get('/documents/:id/download', requireParent, async (req, res) => {
  try { return await serveParentDocument(req, res, false); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); console.error('Parent document download error:', err); return res.status(404).json({ message: 'Document file is not available' }); }
});

// ─── POST /api/parent/change-password ────────────────────────────────────────
// Used for forced first-time password change
router.post('/change-password', requireParent, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  try {
    const hashed = await bcrypt.hash(new_password, 12);
    await db.query(
      `UPDATE users SET password=$1, must_change_password=false, password_changed_at=NOW(), auth_revoked_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [hashed, req.user.id]
    );
    await revokeUserSessions(req.user.id);
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
              u.must_change_password, u.created_at, u.invitation_sent_at, u.last_login_at,
              CASE WHEN u.is_active=false THEN 'DISABLED'
                WHEN u.activated_at IS NOT NULL THEN 'ACTIVATED'
                WHEN u.invitation_sent_at IS NOT NULL THEN 'INVITE_SENT'
                ELSE 'NOT_INVITED' END AS status
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

router.get('/admin/pending-otps', requireAdmin, (req, res) => {
  res.status(404).json({ message: 'Not found' });
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

  let client;
  try {
    client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const normalizedStudents = [...new Set(students.map(Number))];
      if (normalizedStudents.some(id => !Number.isInteger(id) || id <= 0)) {
        throw Object.assign(new Error('student_ids must contain valid learner IDs'), { status: 400 });
      }
      const validStudents = await client.query(
        `SELECT id, first_name, last_name, student_number FROM users
         WHERE id = ANY($1::int[]) AND role='student'`, [normalizedStudents]);
      if (validStudents.rows.length !== normalizedStudents.length) {
        throw Object.assign(new Error('Every student_id must identify an existing learner'), { status: 400 });
      }
    // Check if parent with this phone already exists
    const existing = await client.query(
      `SELECT id FROM users WHERE phone_number=$1 AND role='parent' FOR UPDATE`, [normalizedPhone]
    );

    let parentId;
    let tempPassword = null;
    let activationLink = null;
    let activationToken = null;

    if (existing.rows.length > 0) {
      // Parent exists – just add the new student links
      parentId = existing.rows[0].id;
    } else {
      // Create new parent
      // New accounts are activated through a one-time link; no password is
      // generated or disclosed to staff.
      tempPassword = null;
      const hashed = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);

      const userResult = await client.query(`
       INSERT INTO users (first_name, last_name, phone_number, email, password, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, 'parent', true, true)
        RETURNING id, first_name, last_name, phone_number, role, created_at
      `, [first_name, last_name, normalizedPhone, email || null, hashed]);

      parentId = userResult.rows[0].id;
    }

    // Link students (ignore duplicate links)
    const linked = [];
    const failed = [];
    for (const sid of students) {
      try {
        await client.query(`
          INSERT INTO parent_students (parent_id, student_id)
          VALUES ($1, $2)
          ON CONFLICT (parent_id, student_id) DO NOTHING
        `, [parentId, sid]);
        linked.push(validStudents.rows.find(s => s.id === Number(sid)));
      } catch { throw Object.assign(new Error(`Unable to link student ${sid}`), { status: 400 }); }
    }

    if (!existing.rows.length) {
      // Keep account creation, links, token revocation/issuance and invitation
      // timestamp in this same transaction. The raw token is retained only
      // in memory and is returned/emailed after COMMIT.
      activationToken = await issueAuthToken(parentId, 'activation', req.user.id, client);
    }

    await logAudit({ executor: client, required: true, userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'parent_create_or_link', entityType: 'parent',
      entityId: parentId, details: { studentIds: students }, ipAddress: getIp(req) });
    await client.query('COMMIT');
    client.release();
    if (!existing.rows.length) {
      activationLink = parentPortalUrl('/parent/activate', activationToken);
      if (email) {
        try { await sendParentAuthEmail(email, activationToken, 'activation', first_name); }
        catch (emailError) { console.error('Parent activation email failed after commit:', emailError.message); }
      }
    }
    res.status(201).json({
      success: true,
      message: existing.rows.length > 0 ? 'Students added to existing parent account' : 'Parent account created',
      parentId,
       tempPassword: null,
       activationLink,
      linkedStudents: linked,
      failedStudents: failed,
      isExisting: existing.rows.length > 0,
    });
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Create parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/parent/admin/:parentId
router.put('/admin/:parentId', requireAdmin, async (req, res) => {
  const { parentId } = req.params;
  const { first_name, last_name, phone_number, email, password, is_active, add_student_ids, remove_student_ids } = req.body;

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const parentCheck = await client.query(`SELECT id FROM users WHERE id=$1 AND role='parent' FOR UPDATE`, [parentId]);
    if (!parentCheck.rows.length) {
      await client.query('ROLLBACK'); client.release();
      return res.status(404).json({ message: 'Parent account not found' });
    }
    const additions = Array.isArray(add_student_ids) ? [...new Set(add_student_ids.map(Number))] : [];
    const removals = Array.isArray(remove_student_ids) ? [...new Set(remove_student_ids.map(Number))] : [];
    const allStudentIds = [...new Set([...additions, ...removals])];
    if (allStudentIds.some(id => !Number.isInteger(id) || id <= 0)) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ message: 'Student IDs must be valid learner IDs' });
    }
    if (allStudentIds.length) {
      const valid = await client.query(`SELECT id FROM users WHERE id=ANY($1::int[]) AND role='student'`, [allStudentIds]);
      if (valid.rows.length !== allStudentIds.length) {
        await client.query('ROLLBACK'); client.release();
        return res.status(400).json({ message: 'Every linked ID must identify an existing learner' });
      }
    }
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
      await client.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} AND role='parent'`, params
      );
    }

    if (Array.isArray(add_student_ids)) {
      for (const sid of add_student_ids) {
        await client.query(
          `INSERT INTO parent_students(parent_id,student_id) VALUES($1,$2) ON CONFLICT(parent_id,student_id) DO NOTHING`,
          [parentId, sid]
        );
      }
    }
    if (Array.isArray(remove_student_ids)) {
      for (const sid of remove_student_ids) {
        await client.query(`DELETE FROM parent_students WHERE parent_id=$1 AND student_id=$2`, [parentId, sid]);
      }
    }

    await logAudit({ executor: client, required: true, userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'parent_update', entityType: 'parent', entityId: parentId,
      details: { addedStudentIds: additions, removedStudentIds: removals }, ipAddress: getIp(req) });
    await client.query('COMMIT');
    client.release();
    res.json({ success: true, message: 'Parent account updated' });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
    }
    console.error('Update parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/parent/admin/:parentId
router.delete('/admin/:parentId', requireAdmin, async (req, res) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const parent = await client.query(`SELECT id FROM users WHERE id=$1 AND role='parent' FOR UPDATE`, [req.params.parentId]);
    if (!parent.rows.length) {
      await client.query('ROLLBACK'); client.release();
      return res.status(404).json({ message: 'Parent account not found' });
    }
    await client.query(`DELETE FROM parent_students WHERE parent_id=$1`, [req.params.parentId]);
    await client.query(`DELETE FROM users WHERE id=$1 AND role='parent'`, [req.params.parentId]);
    await logAudit({ executor: client, required: true, userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'parent_delete', entityType: 'parent', entityId: req.params.parentId, ipAddress: getIp(req) });
    await client.query('COMMIT');
    client.release();
    res.json({ success: true, message: 'Parent account deleted' });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} client.release(); }
    console.error('Delete parent error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/parent/admin/reset-password/:parentId  – admin resets a parent's password
router.post('/admin/reset-password/:parentId', requireAdmin, async (req, res) => {
  try {
    const parent = await db.query(`SELECT id,email,first_name FROM users WHERE id=$1 AND role='parent'`, [req.params.parentId]);
    if (!parent.rows.length) return res.status(404).json({ message: 'Parent account not found' });
    const token = await issueAuthToken(req.params.parentId, 'reset', req.user.id);
    await revokeUserSessions(req.params.parentId);
    const emailed = parent.rows[0].email
      ? await sendParentAuthEmail(parent.rows[0].email, token, 'reset', parent.rows[0].first_name)
      : { success: false, skipped: true };
    res.json({ success: true, emailed: Boolean(emailed.success), resetLink: parentPortalUrl('/parent/reset-password', token) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Token-based activation and recovery never expose a database identifier.
router.get('/activation/validate', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const found = await db.query(`SELECT u.first_name,u.last_name,u.phone_number FROM parent_auth_tokens t
      JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.token_type='activation'
      AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>NOW() AND u.role='parent'`, [hashToken(token)]);
    if (!found.rows.length) return res.status(400).json({ valid: false, message: 'Invalid or expired activation link' });
    const user = found.rows[0];
    const phone = String(user.phone_number || '');
    res.json({ valid: true, identity: { name: `${user.first_name || ''} ${(user.last_name || '').slice(0, 1)}.`, phone: phone.length > 3 ? `${'*'.repeat(Math.max(0, phone.length - 3))}${phone.slice(-3)}` : '***' } });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ valid: false, message: 'Parent authentication is not yet available.' });
    res.status(500).json({ valid: false, message: 'Server error' });
  }
});

router.post('/activate', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const found = await db.query(`SELECT t.id,t.user_id FROM parent_auth_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=$1 AND t.token_type='activation' AND t.used_at IS NULL AND t.revoked_at IS NULL
      AND t.expires_at>NOW() AND u.role='parent'`, [hashToken(token)]);
    if (!found.rows.length) return res.status(400).json({ message: 'Invalid or expired activation link' });
    if (!req.body.password || String(req.body.password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    const hashed = await bcrypt.hash(req.body.password, 12);
    let activatedUser;
    await withTransaction(async (client) => {
      const consumed = await client.query(`UPDATE parent_auth_tokens SET used_at=NOW()
        WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() RETURNING user_id`, [found.rows[0].id]);
      if (!consumed.rows.length) throw Object.assign(new Error('used'), { status: 400 });
      await client.query(`UPDATE users SET password=$1,must_change_password=false,activated_at=NOW(),password_changed_at=NOW(),updated_at=NOW() WHERE id=$2`,
        [hashed, found.rows[0].user_id]);
      const user = await client.query(`SELECT id,email,role,student_number,first_name,last_name,phone_number,must_change_password
        FROM users WHERE id=$1 AND role='parent' AND is_active=true FOR UPDATE`, [found.rows[0].user_id]);
      if (!user.rows.length) throw Object.assign(new Error('inactive'), { status: 400 });
      activatedUser = user.rows[0];
    });
    const session = await authenticateSession(req, res, activatedUser, true);
    const children = await getChildren(activatedUser.id);
    const { password: _, ...safeUser } = activatedUser;
    res.json({ success: true, message: 'Parent account activated', token: session.token,
      user: safeUser, children, child: children[0] || null, must_change_password: false });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: 'Invalid or expired activation link' });
    if (err.code === '42P01' || err.code === '42703') return res.status(503).json({ message: 'Parent authentication is not yet available.' });
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/admin/:parentId/status', requireAdmin, async (req, res) => {
  const result = await db.query(`SELECT id,activated_at,invitation_sent_at,last_login_at,
    password_changed_at,email,is_active, CASE WHEN is_active=false THEN 'DISABLED'
      WHEN activated_at IS NOT NULL THEN 'ACTIVATED'
      WHEN invitation_sent_at IS NOT NULL THEN 'INVITE_SENT' ELSE 'NOT_INVITED' END AS status
    FROM users WHERE id=$1 AND role='parent'`, [req.params.parentId]);
  if (!result.rows.length) return res.status(404).json({ message: 'Parent account not found' });
  res.json({ parent: result.rows[0] });
});

async function adminInvite(req, res) {
  try {
    const parent = await db.query(`SELECT id,email,first_name FROM users WHERE id=$1 AND role='parent'`, [req.params.parentId]);
    if (!parent.rows.length) return res.status(404).json({ message: 'Parent account not found' });
    const token = await issueAuthToken(req.params.parentId, 'activation', req.user.id);
    const link = parentPortalUrl('/parent/activate', token);
    const emailed = req.path.endsWith('/copy-link') ? { success: false, skipped: true }
      : (parent.rows[0].email ? await sendParentAuthEmail(parent.rows[0].email, token, 'activation', parent.rows[0].first_name) : { success: false });
    res.json({ success: true, emailed: Boolean(emailed.success), activationLink: link });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
}
router.post('/admin/:parentId/invite', requireAdmin, adminInvite);
router.post('/admin/:parentId/reissue', requireAdmin, adminInvite);
router.post('/admin/:parentId/copy-link', requireAdmin, async (req, res) => {
  req.params.parentId = req.params.parentId;
  return adminInvite(req, res);
});
router.post('/admin/:parentId/disable', requireAdmin, async (req, res) => {
    await db.query(`UPDATE users SET is_active=false WHERE id=$1 AND role='parent'`, [req.params.parentId]);
  await revokeUserSessions(req.params.parentId); res.json({ success: true });
});
router.post('/admin/:parentId/enable', requireAdmin, async (req, res) => {
  await db.query(`UPDATE users SET is_active=true WHERE id=$1 AND role='parent'`, [req.params.parentId]);
  res.json({ success: true });
});

// Account audit is intentionally aggregate and omits token values, URLs and secrets.
router.get('/admin/:parentId/audit', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT action,entity_type,created_at,ip_address,
      details FROM audit_logs WHERE entity_type='parent' AND entity_id=$1
      ORDER BY created_at DESC LIMIT 100`, [req.params.parentId]);
    res.json({ audit: result.rows });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

router.get('/welcome-password', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Direct admin link. The current enrollment schema stores applicant names and
// contact fields but no durable learner/parent foreign keys, so it cannot prove
// enrollment provenance. Keep that distinction explicit and never infer a link.
router.post('/admin/direct-link', requireAdmin, async (req, res) => {
  const studentId = Number(req.body?.student_id);
  const parentId = Number(req.body?.parent_id);
  if (![studentId, parentId].every(Number.isInteger) || studentId <= 0 || parentId <= 0) {
    return res.status(400).json({ message: 'student_id and parent_id are required learner/account identifiers' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const student = await client.query(`SELECT id FROM users WHERE id=$1 AND role='student' FOR UPDATE`, [studentId]);
    const parent = await client.query(`SELECT id FROM users WHERE id=$1 AND role='parent' FOR UPDATE`, [parentId]);
    if (!student.rows.length || !parent.rows.length) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ message: 'Learner and parent identifiers must exist' });
    }
    const link = await client.query(`
      INSERT INTO parent_students (parent_id, student_id) VALUES ($1, $2)
      ON CONFLICT (parent_id, student_id) DO NOTHING RETURNING id
    `, [parentId, studentId]);
    await logAudit({ executor: client, required: true, userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'parent_direct_link',
      entityType: 'parent_student', entityId: link.rows[0]?.id || null,
      details: { studentId, parentId, directAdminLink: true, created: link.rows.length > 0 },
      ipAddress: getIp(req) });
    await client.query('COMMIT'); client.release();
    return res.status(201).json({ success: true, created: link.rows.length > 0 });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} client.release(); }
    console.error('Explicit enrollment link error:', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Server error' });
  }
});

module.exports = router;
module.exports.validatePushSubscription = validatePushSubscription;
module.exports.safePushEndpoint = safePushEndpoint;
