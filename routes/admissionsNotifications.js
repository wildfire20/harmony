const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch((error) => {
    console.error('Admissions notification request failed:', error.message);
    if (!res.headersSent) {
      res.status(error.code === '42P01' || error.code === '42703' ? 503 : 500).json({
        message: 'Admissions notifications are temporarily unavailable.',
      });
    }
  });
};
const requireAdmin = (req, res, next) => {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(req.user ? 403 : 401).json({ message: 'Admin authentication required.' });
  }
  return next();
};
router.use(authenticate, requireAdmin);
router.use(asyncRoute(async (req, res, next) => {
  const readiness = await db.query(
    "SELECT to_regclass('public.admissions_notifications') IS NOT NULL AS ready",
  );
  if (!readiness.rows[0]?.ready) {
    return res.status(503).json({ message: 'Admissions notifications are temporarily unavailable.' });
  }
  return next();
}));

const mapNotification = (row) => ({
  id: row.id,
  eventType: row.event_type,
  title: row.title,
  summary: row.summary,
  payload: row.payload,
  readAt: row.read_at,
  createdAt: row.created_at,
});

router.get('/notifications', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const result = await db.query(`
    SELECT id, event_type, title, summary, payload, read_at, created_at
    FROM admissions_notifications
    WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT $2
  `, [req.user.id, limit]);
  return res.json({ notifications: result.rows.map(mapNotification) });
}));
router.get('/admissions/activity', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const result = await db.query(`
    SELECT id, event_type, title, summary, payload, read_at, created_at
    FROM admissions_notifications
    WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT $2
  `, [req.user.id, limit]);
  return res.json({ activity: result.rows.map(mapNotification) });
}));
router.get('/notifications/unread-count', asyncRoute(async (req, res) => {
  const result = await db.query(
    'SELECT COUNT(*)::int AS count FROM admissions_notifications WHERE recipient_id = $1 AND read_at IS NULL',
    [req.user.id],
  );
  return res.json({ count: result.rows[0].count });
}));
router.post('/notifications/read-all', asyncRoute(async (req, res) => {
  await db.query(
    'UPDATE admissions_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE recipient_id = $1',
    [req.user.id],
  );
  return res.json({ readAll: true });
}));
router.patch('/notifications/:id/read', asyncRoute(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ message: 'Invalid notification identifier' });
  }
  const result = await db.query(
    'UPDATE admissions_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = $1 AND recipient_id = $2 RETURNING id, read_at',
    [req.params.id, req.user.id],
  );
  if (!result.rows.length) return res.status(404).json({ message: 'Notification not found' });
  return res.json({ notification: result.rows[0] });
}));

module.exports = router;