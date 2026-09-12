const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { generateKidFriendlyPassword } = require('../utils/passwordGenerator');
const BANKING_DETAILS = require('../config/bankingDetails');
const { logAudit, getIp } = require('../utils/auditLogger');
const {
  issueAuthToken, sendParentAuthEmail, hashToken, randomToken, revokeUserSessions, withTransaction, authenticateSession,
  normalizePhone, parentOtpHash, generateParentOtp, sendParentActivationOtp,
  PARENT_OTP_TTL_MINUTES, PARENT_OTP_MAX_ATTEMPTS,
  PARENT_OTP_RESEND_COOLDOWN_SECONDS, PARENT_OTP_DAILY_RESEND_LIMIT,
} = require('../services/parentAuth');
const { getStudentLedger } = require('../services/financeLedger');

const requireParent = [authenticate, authorize('parent')];
const requireAdmin  = [authenticate, authorize('admin', 'super_admin')];
const activationRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
});
const activationVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});
const activationCompleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
});

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

function parentPortalUrl(pathname, token) {
  const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}${pathname}?token=${encodeURIComponent(token)}`;
}

function generateTempPassword() {
  return generateKidFriendlyPassword();
}

async function getChildren(parentId, executor = db) {
  const result = await executor.query(`
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

    const [attendanceRes, ledger, announcementsRes] = await Promise.all([
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

      getStudentLedger(child.id),

      db.query(`
        SELECT id, title, content, created_at
        FROM announcements
        WHERE is_active = true
          AND (
            target_audience IN ('everyone', 'parents', 'all_parents')
            OR (target_audience = 'grade' AND grade_id = $1)
            OR (target_audience = 'class' AND grade_id = $1 AND class_id = $2)
            OR (target_audience = 'specific_parents' AND target_parent_ids @> to_jsonb($3::int))
          )
        ORDER BY created_at DESC LIMIT 3
      `, [child.grade_id, child.class_id, req.user.id]),
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
      // Parent academic/grade widgets are intentionally disabled.  Staff
      // academic APIs remain available; this endpoint never queries them.
      recentGrades: [],
      outstandingBalance: ledger.totals.outstanding,
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
  return res.status(410).json({
    success: false,
    code: 'PARENT_GRADES_DISABLED',
    message: 'Parent grades are currently unavailable.',
  });
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
        AND (
          a.target_audience IN ('everyone', 'parents', 'all_parents')
          OR (a.target_audience = 'grade' AND a.grade_id = $1)
          OR (a.target_audience = 'class' AND a.grade_id = $1 AND a.class_id = $2)
          OR (a.target_audience = 'specific_parents' AND a.target_parent_ids @> to_jsonb($3::int))
        )
      ORDER BY a.created_at DESC LIMIT 50
    `, [child.grade_id, child.class_id, req.user.id]);
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
    if (!child) return res.json({
      invoices: [],
      transactions: [],
      serviceComponents: [],
      totals: { totalDue: 0, totalPaid: 0, outstanding: 0, overpaid: 0, unallocated: 0, credit: 0, netOutstanding: 0 },
      child: null,
      children,
    });
    const ledger = await getStudentLedger(child.id);
    // The same ledger read model is used by Admin finance endpoints.  In
    // particular, do not apply an enrollment-date filter here: carried-forward
    // arrears are real ledger entries and must reconcile with Admin.
    res.json({
      invoices: ledger.invoices,
      transactions: ledger.transactions,
      serviceComponents: ledger.service_components,
      totals: ledger.totals,
      child,
      children,
    });
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
        AND EXISTS (
          SELECT 1 FROM parent_students ps
          JOIN users child_user ON child_user.id = ps.student_id
          WHERE ps.parent_id = $1
            AND (d.grade_id IS NULL OR child_user.grade_id = d.grade_id)
            AND (d.class_id IS NULL OR child_user.class_id = d.class_id)
            AND child_user.id = $2
            AND (
              d.target_audience IN ('everyone', 'parents', 'all_parents')
              OR (d.target_audience = 'grade' AND d.grade_id = child_user.grade_id)
              OR (d.target_audience = 'class' AND d.grade_id = child_user.grade_id AND d.class_id = child_user.class_id)
              OR (d.target_audience = 'specific_parents' AND d.target_parent_ids @> to_jsonb($1::int))
            )
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
      AND EXISTS (
        SELECT 1 FROM parent_students ps
        JOIN users child_user ON child_user.id = ps.student_id
          WHERE ps.parent_id = $2 AND ps.student_id = $3
          AND (d.grade_id IS NULL OR child_user.grade_id = d.grade_id)
          AND (d.class_id IS NULL OR child_user.class_id = d.class_id)
          AND (
            d.target_audience IN ('everyone', 'parents', 'all_parents')
            OR (d.target_audience = 'grade' AND d.grade_id = child_user.grade_id)
            OR (d.target_audience = 'class' AND d.grade_id = child_user.grade_id AND d.class_id = child_user.class_id)
            OR (d.target_audience = 'specific_parents' AND d.target_parent_ids @> to_jsonb($2::int))
          )
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

// ─── Parent self-activation (OTP) ─────────────────────────────────────────────
// These routes deliberately never create a user or alter parent_students.  The
// school must have created the parent account first.
const genericActivationMessage = 'We could not verify those details. Please contact your school.';
const alreadyActivatedMessage = 'This Parent account is already activated. Please use Forgot Password to regain access.';

function validActivationEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : '';
}

async function matchingParentAccounts(phone) {
  const result = await db.query(`
    SELECT u.id, u.phone_number, u.email, u.first_name, u.last_name,
           u.is_active, u.activated_at, u.parent_account_status
    FROM users u WHERE u.role='parent'
  `);
  return result.rows.filter((parent) => normalizePhone(parent.phone_number) === phone);
}

router.post('/activation/request', activationRequestLimiter, async (req, res) => {
  const phone = normalizePhone(req.body?.phone_number || req.body?.phone);
  const email = validActivationEmail(req.body?.email);
  const confirmation = validActivationEmail(req.body?.email_confirmation);
  if (!phone || !email || confirmation !== email) {
    return res.status(400).json({ message: genericActivationMessage });
  }

  try {
    const matches = await matchingParentAccounts(phone);
    if (matches.length !== 1) {
      // Shared numbers are unsafe, but an anonymous lookup must never change
      // account state or reveal whether zero or multiple records matched.
      return res.status(400).json({ message: genericActivationMessage });
    }

    const parent = matches[0];
    if (!parent.is_active) return res.status(400).json({ message: genericActivationMessage });
    if (parent.activated_at || parent.parent_account_status === 'active') {
      return res.status(200).json({
        message: alreadyActivatedMessage,
        forgotPassword: '/api/auth/forgot-password',
      });
    }
    if (parent.parent_account_status === 'needs_review') {
      return res.status(400).json({ message: genericActivationMessage });
    }

    const otp = generateParentOtp();
    const otpHash = parentOtpHash(otp);
    const challenge = await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id,is_active,activated_at,parent_account_status FROM users
         WHERE id=$1 AND role='parent' FOR UPDATE`, [parent.id],
      );
      if (!locked.rows.length || !locked.rows[0].is_active) {
        throw Object.assign(new Error('not eligible'), { status: 400 });
      }
      if (locked.rows[0].activated_at || locked.rows[0].parent_account_status === 'active') {
        throw Object.assign(new Error('already activated'), { status: 409 });
      }
      const recent = await client.query(
        `SELECT id, last_sent_at FROM parent_activation_challenges
         WHERE user_id=$1 AND invalidated_at IS NULL AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`, [parent.id],
      );
      if (recent.rows.length &&
          (Date.now() - new Date(recent.rows[0].last_sent_at).getTime()) <
            PARENT_OTP_RESEND_COOLDOWN_SECONDS * 1000) {
        throw Object.assign(new Error('cooldown'), { status: 429 });
      }
      const daily = await client.query(
        `SELECT COUNT(*)::int AS count FROM parent_activation_challenges
         WHERE user_id=$1 AND created_at >= CURRENT_DATE`, [parent.id],
      );
      if (Number(daily.rows[0]?.count || 0) >= PARENT_OTP_DAILY_RESEND_LIMIT) {
        throw Object.assign(new Error('daily limit'), { status: 429 });
      }
      await client.query(
        `UPDATE parent_activation_challenges SET invalidated_at=NOW()
         WHERE user_id=$1 AND invalidated_at IS NULL AND consumed_at IS NULL`, [parent.id],
      );
      const inserted = await client.query(
        `INSERT INTO parent_activation_challenges
          (user_id,email,otp_hash,expires_at,attempts,max_attempts,last_sent_at,delivery_confirmed_at)
         VALUES ($1,$2,$3,NOW()+($4 * INTERVAL '1 minute'),0,$5,NOW(),NULL)
         RETURNING id`, [parent.id, email, otpHash, PARENT_OTP_TTL_MINUTES, PARENT_OTP_MAX_ATTEMPTS],
      );
      return { id: inserted.rows[0]?.id };
    });

    try {
      await sendParentActivationOtp(email, otp, parent.first_name);
      const confirmed = await db.query(
        `UPDATE parent_activation_challenges SET delivery_confirmed_at=NOW()
         WHERE id=$1 AND delivery_confirmed_at IS NULL AND consumed_at IS NULL
           AND invalidated_at IS NULL RETURNING id`,
        [challenge.id],
      );
      if (!confirmed.rows.length) throw new Error('challenge delivery confirmation failed');
    } catch (sendError) {
      await db.query(
        `UPDATE parent_activation_challenges SET invalidated_at=NOW()
         WHERE id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [challenge.id],
      ).catch(() => {});
      // Never include provider details or the OTP in a public response.
      console.error('Parent activation email delivery failed:', sendError.message);
      return res.status(503).json({ message: 'We could not send a verification code. Please try again later.' });
    }
    return res.status(200).json({
      message: 'If the details match an eligible Parent account, a verification code has been sent.',
      challenge_id: challenge.id,
    });
  } catch (err) {
    if (err.status === 409) return res.status(200).json({
      message: alreadyActivatedMessage, forgotPassword: '/api/auth/forgot-password',
    });
    if (err.status === 429) return res.status(429).json({ message: 'Please wait before requesting another code.' });
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({ message: 'Parent activation is not yet available.' });
    }
    console.error('Parent activation request error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/activation/verify', activationVerifyLimiter, async (req, res) => {
  const challengeId = Number(req.body?.challenge_id || req.body?.challengeId);
  const otp = String(req.body?.otp || '');
  if (!Number.isSafeInteger(challengeId) || challengeId <= 0 || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: genericActivationMessage });
  }
  try {
    const verification = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT c.id,c.otp_hash,c.attempts,c.max_attempts,c.expires_at,c.verified_at,
                c.delivery_confirmed_at,
                c.consumed_at,c.invalidated_at,u.is_active,u.role,u.activated_at,
                u.parent_account_status
         FROM parent_activation_challenges c JOIN users u ON u.id=c.user_id
         WHERE c.id=$1 AND u.role='parent' FOR UPDATE`, [challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || !challenge.is_active || !challenge.delivery_confirmed_at || challenge.consumed_at ||
          challenge.invalidated_at || challenge.verified_at ||
          challenge.activated_at || challenge.parent_account_status === 'active' ||
          new Date(challenge.expires_at) <= new Date() ||
          Number(challenge.attempts) >= Number(challenge.max_attempts)) {
        throw Object.assign(new Error('invalid challenge'), { status: 400 });
      }
      if (!crypto.timingSafeEqual(
        Buffer.from(parentOtpHash(otp), 'hex'), Buffer.from(String(challenge.otp_hash), 'hex'),
      )) {
        await client.query(
          `UPDATE parent_activation_challenges
           SET attempts=attempts+1,
               invalidated_at=CASE WHEN attempts+1 >= max_attempts THEN NOW() ELSE invalidated_at END
           WHERE id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL`, [challengeId],
        );
        return null;
      }
      const completionToken = randomToken();
      await client.query(
        `UPDATE parent_activation_challenges SET verified_at=NOW(),completion_token_hash=$2
         WHERE id=$1 AND verified_at IS NULL AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [challengeId, hashToken(completionToken)],
      );
      return completionToken;
    });
    if (!verification) return res.status(400).json({ message: genericActivationMessage });
    return res.json({ success: true, challenge_id: challengeId, completion_token: verification });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: genericActivationMessage });
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({ message: 'Parent activation is not yet available.' });
    }
    console.error('Parent activation verification error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/activation/complete', activationCompleteLimiter, async (req, res) => {
  const challengeId = Number(req.body?.challenge_id || req.body?.challengeId);
  const completionToken = String(req.body?.completion_token || req.body?.completionToken || '');
  const password = String(req.body?.password || req.body?.new_password || '');
  if (!Number.isSafeInteger(challengeId) || challengeId <= 0 ||
      !/^[A-Za-z0-9_-]{40,}$/.test(completionToken) ||
      password.length < 8 || password.length > 256) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }
  let completionCookieAttempted = false;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const completed = await withTransaction(async (client) => {
      const found = await client.query(
        `SELECT c.id,c.user_id,c.email,c.verified_at,c.consumed_at,c.invalidated_at,c.expires_at,
                c.completion_token_hash,
                u.id AS parent_id,u.email AS current_email,u.role,u.is_active,u.activated_at,
                u.parent_account_status,u.first_name,u.last_name,u.phone_number
         FROM parent_activation_challenges c JOIN users u ON u.id=c.user_id
         WHERE c.id=$1 AND u.role='parent' FOR UPDATE`, [challengeId],
      );
      const challenge = found.rows[0];
      if (!challenge || challenge.consumed_at ||
          !challenge.verified_at || challenge.consumed_at || challenge.invalidated_at ||
          new Date(challenge.expires_at) <= new Date() || challenge.activated_at ||
          !challenge.completion_token_hash ||
          !crypto.timingSafeEqual(
            Buffer.from(hashToken(completionToken), 'hex'),
            Buffer.from(String(challenge.completion_token_hash), 'hex'),
          )) {
        throw Object.assign(new Error('invalid challenge'), { status: 400 });
      }
      const lockedUser = await client.query(
        `SELECT id,role,is_active,activated_at,parent_account_status FROM users
         WHERE id=$1 AND role='parent' FOR UPDATE`, [challenge.user_id],
      );
      const user = lockedUser.rows[0];
      if (!user || !user.is_active || user.activated_at ||
          ['active', 'needs_review'].includes(user.parent_account_status)) {
        throw Object.assign(new Error('invalid account'), { status: 400 });
      }
      const updated = await client.query(
        `UPDATE users SET password=$1,email=$2,email_verified_at=NOW(),
           must_change_password=false,activated_at=NOW(),parent_account_status='active',
            password_changed_at=NOW(),updated_at=NOW() WHERE id=$3 AND role='parent'
          RETURNING id,email,email_verified_at,role,student_number,first_name,last_name,
                    phone_number,must_change_password`,
        [hashedPassword, challenge.email, challenge.user_id],
      );
      if (!updated.rows.length) {
        throw Object.assign(new Error('invalid account'), { status: 400 });
      }
      const updatedUser = updated.rows[0];
      await client.query(
        `UPDATE parent_activation_challenges
         SET consumed_at=NOW(),invalidated_at=COALESCE(invalidated_at,NOW())
         WHERE user_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL`, [challenge.user_id],
      );
      await client.query(
        `UPDATE parent_auth_tokens SET revoked_at=NOW()
         WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,
        [challenge.user_id],
      );
      await logAudit({
        executor: client, required: true, userId: challenge.user_id,
        userName: `${updatedUser.first_name || ''} ${updatedUser.last_name || ''}`.trim(),
        userRole: 'parent', action: 'parent_self_activation_completed',
        entityType: 'parent', entityId: challenge.user_id, ipAddress: getIp(req),
        details: { email_verified: true },
      });
      const safeUser = { ...updatedUser, is_active: true };
      const children = await getChildren(safeUser.id, client);
      const session = await authenticateSession(req, res, safeUser, true, undefined, client);
      completionCookieAttempted = true;
      return { user: safeUser, children, token: session.token };
    });
    return res.json({
      success: true, message: 'Parent account activated', token: completed.token,
      user: completed.user, children: completed.children, child: completed.children[0] || null,
    });
  } catch (err) {
    if (completionCookieAttempted) {
      res.clearCookie('parent_refresh', { path: '/api/auth' });
    }
    if (err.status === 400) return res.status(400).json({ message: genericActivationMessage });
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({ message: 'Parent activation is not yet available.' });
    }
    console.error('Parent activation completion error:', err.message);
    return res.status(500).json({ message: 'Server error' });
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
