const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { sendEmail, escapeHtml } = require('./gmailService');

const ACCESS_SECONDS = 10 * 60;
const REMEMBERED_DAYS = 30;
const NORMAL_DAYS = 1;
const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const secureCookie = (req) => process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';

function accessToken(user, sessionId) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, session_id: sessionId },
    process.env.JWT_SECRET, { expiresIn: `${ACCESS_SECONDS}s` });
}

async function issueRefresh(req, user, remember = false, familyId = crypto.randomUUID(), familyExpiresAt) {
  const raw = randomToken();
  const days = remember ? REMEMBERED_DAYS : NORMAL_DAYS;
  const familyExpiry = familyExpiresAt ? new Date(familyExpiresAt) : new Date(Date.now() + days * 86400000);
  const expiresIn = Math.max(1, Math.ceil((familyExpiry.getTime() - Date.now()) / 1000));
  const inserted = await db.query(`INSERT INTO parent_sessions
    (user_id, refresh_token_hash, family_id, family_expires_at, expires_at, user_agent, ip_address)
    VALUES ($1,$2,$3,$4,LEAST($4,NOW()+($5 * INTERVAL '1 day')),$6,$7) RETURNING id`,
    [user.id, hashToken(raw), familyId, familyExpiry, days, req.get('user-agent') || null, req.ip || null]);
  return { raw, id: inserted.rows?.[0]?.id, familyId, familyExpiresAt: familyExpiry, remember, expiresIn };
}

function setRefreshCookie(req, res, raw, maxAge) {
  res.cookie('parent_refresh', raw, {
    httpOnly: true, secure: secureCookie(req), sameSite: 'lax',
    maxAge: maxAge * 1000, path: '/api/auth',
  });
}

async function authenticateSession(req, res, user, remember = false, familyId) {
  const refresh = await issueRefresh(req, user, remember, familyId);
  setRefreshCookie(req, res, refresh.raw, refresh.expiresIn);
  return { token: accessToken(user, refresh.id), refresh };
}

async function revokeUserSessions(userId) {
  await db.query('UPDATE parent_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
  await db.query('UPDATE users SET auth_revoked_at=NOW() WHERE id=$1', [userId]);
}

async function issueAuthToken(userId, type, createdBy = null, executor = null) {
  const raw = randomToken();
  const hours = type === 'activation' ? 72 : 1;
  const work = async (client) => {
    const parent = await client.query('SELECT id FROM users WHERE id=$1 AND role=$2 FOR UPDATE', [userId, 'parent']);
    if (!parent.rows.length) throw Object.assign(new Error('Parent account not found'), { status: 404 });
    await client.query(`UPDATE parent_auth_tokens SET revoked_at=NOW()
    WHERE user_id=$1 AND token_type=$2 AND used_at IS NULL AND revoked_at IS NULL`, [userId, type]);
    await client.query(`INSERT INTO parent_auth_tokens
    (user_id, token_hash, token_type, expires_at, created_by)
    VALUES ($1,$2,$3,NOW()+($4 * INTERVAL '1 hour'),$5)`,
      [userId, hashToken(raw), type, hours, createdBy]);
    if (type === 'activation') {
      await client.query('UPDATE users SET invitation_sent_at=NOW() WHERE id=$1 AND role=$2', [userId, 'parent']);
    }
  };
  if (executor) await work(executor);
  else await withTransaction(work);
  return raw;
}

async function withTransaction(work) {
  const client = await db.pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; }
  finally { client.release(); }
}

async function sendParentAuthEmail(email, token, type, name = '') {
  const base = process.env.FRONTEND_URL || process.env.PUBLIC_URL || '';
  const link = `${base.replace(/\/$/, '')}/parent/${type === 'activation' ? 'activate' : 'reset-password'}?token=${encodeURIComponent(token)}`;
  const title = type === 'activation' ? 'Activate your Parent Portal account' : 'Reset your Parent Portal password';
  return sendEmail(email, `Harmony Parent Portal — ${title}`, `<!doctype html><html><body>
    <h2>Harmony Parent Portal</h2><p>Dear ${escapeHtml(name)},</p><p>${escapeHtml(title)}.</p>
    <p><a href="${escapeHtml(link)}">Continue securely</a></p><p>This link expires soon and can only be used once. If you did not request this, you can ignore this email.</p>
    <hr><p>Harmony Learning Institute</p><p>Powered by AutoM8</p></body></html>`,
    { fromName: 'Harmony Parent Portal — powered by AutoM8', replyTo: 'harmonylearninginstitute@gmail.com' });
}

module.exports = {
  ACCESS_SECONDS, hashToken, randomToken, accessToken, authenticateSession, withTransaction,
  setRefreshCookie, revokeUserSessions, issueAuthToken, sendParentAuthEmail, secureCookie,
};