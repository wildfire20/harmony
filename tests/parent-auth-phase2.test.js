/*
 * Phase 2 parent authentication contract tests.
 *
 * These exercise the real Express routers and parentAuth service against an
 * in-memory database double.  No migration or deployment is performed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const Module = require('node:module');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');

process.env.JWT_SECRET = 'phase2-test-secret';
process.env.FRONTEND_URL = 'https://portal.example.test/';
process.env.NODE_ENV = 'production';
process.env.PARENT_SELF_ACTIVATION_ENABLED = 'false';

const original = new Map();
function mock(name, exports) {
  const resolved = require.resolve(name);
  original.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const row = (rows) => ({ rows });
const state = {
  user: null, children: [], tokens: [], sessions: [], queries: [], mail: [],
  nextToken: 1, nextSession: 1,
};
state.user = {
  id: 10, phone_number: '27821234567', email: 'Parent@Example.test',
  first_name: 'Ada', last_name: 'Parent', role: 'parent', is_active: true,
  must_change_password: false, auth_revoked_at: null, password: null,
  parent_account_status: 'pending', parent_activation_state: 'pending',
};

const db = {
  async query(sql, params = []) {
    state.queries.push({ sql, params });
    if (/SELECT u\.id, u\.phone_number/.test(sql)) {
      const phone = String(params[0]); const raw = String(params[1]);
      return row(state.user && state.user.role === 'parent' &&
        [state.user.phone_number, '0821234567'].includes(phone) ||
        state.user && [state.user.phone_number, '0821234567'].includes(raw) ? [state.user] : []);
    }
    if (/FROM parent_students/.test(sql)) return row(state.children);
    if (/INSERT INTO parent_sessions/.test(sql)) {
      const id = state.nextSession++;
      const familyExpires = new Date(params[3]);
      state.sessions.push({ id, user_id: params[0], hash: params[1],
        family_id: params[2], family_expires_at: familyExpires,
        days: params[4], revoked_at: null, replaced_by_hash: null,
        created_at: new Date(Date.now()),
        expires_at: new Date(Math.min(familyExpires.getTime(), Date.now() + Number(params[4]) * 86400000)) });
      return row([{ id }]);
    }
    if (/SELECT s\.\*, u\.id/.test(sql) || /SELECT s\.id AS session_id/.test(sql)) {
      const found = state.sessions.find(s => s.hash === params[0] && s.expires_at > new Date());
      const familyCreatedAt = found && state.sessions
        .filter(s => s.family_id === found.family_id)
        .reduce((earliest, session) => session.created_at < earliest ? session.created_at : earliest, found.created_at);
      return row(found ? [{
        session_id: found.id,
        session_user_id: found.user_id,
        refresh_token_hash: found.hash,
        family_id: found.family_id,
        family_expires_at: found.family_expires_at,
        expires_at: found.expires_at,
        revoked_at: found.revoked_at,
        replaced_by_hash: found.replaced_by_hash,
        created_at: found.created_at,
        family_created_at: familyCreatedAt,
        user_id: state.user.id,
        email: state.user.email,
        role: 'parent',
        is_active: true,
        auth_revoked_at: null,
      }] : []);
    }
    if (/UPDATE parent_sessions SET revoked_at=NOW\(\) WHERE refresh_token_hash/.test(sql)) {
      const found = state.sessions.find(s => s.hash === params[0]); if (found) found.revoked_at = new Date(); return row([]);
    }
    if (/UPDATE parent_sessions SET revoked_at=NOW\(\) WHERE family_id/.test(sql)) {
      state.sessions.filter(s => s.family_id === params[0]).forEach(s => { s.revoked_at = new Date(); }); return row([]);
    }
    if (/UPDATE parent_sessions SET revoked_at=NOW\(\),\s*last_used_at/.test(sql)) {
      const found = state.sessions.find(s => s.id === Number(params[1]) && !s.revoked_at && !s.replaced_by_hash);
      if (!found) return row([]);
      found.revoked_at = new Date();
      found.last_used_at = new Date();
      found.replaced_by_hash = params[0];
      return row([{ id: found.id }]);
    }
    if (/UPDATE parent_sessions SET replaced_by_hash/.test(sql)) {
      const found = state.sessions.find(s => s.id === Number(params[1])); if (found) found.replaced_by_hash = params[0]; return row([]);
    }
    if (/UPDATE parent_sessions SET revoked_at=NOW\(\) WHERE user_id/.test(sql)) {
      state.sessions.filter(s => s.user_id === params[0]).forEach(s => { s.revoked_at = new Date(); }); return row([]);
    }
    if (/UPDATE users SET auth_revoked_at/.test(sql)) { state.user.auth_revoked_at = new Date(); return row([]); }
    if (/SELECT id, first_name, email FROM users/.test(sql)) {
      const email = String(params[0] || '').toLowerCase();
      return row(state.user && state.user.is_active && state.user.email.toLowerCase() === email ? [state.user] : []);
    }
    if (/SELECT id,email,first_name FROM users/.test(sql)) return row([state.user]);
    if (/SELECT t\.id,t\.user_id FROM parent_auth_tokens/.test(sql) ||
        /SELECT t\.id, t\.user_id FROM parent_auth_tokens/.test(sql)) {
      const type = /token_type='activation'/.test(sql) ? 'activation' : 'reset';
      const found = state.tokens.find(t => t.hash === params[0] && t.type === type &&
        !t.used_at && !t.revoked_at && t.expires_at > new Date());
      return row(found ? [{ id: found.id, user_id: found.user_id }] : []);
    }
    if (/SELECT t\.id, t\.user_id FROM parent_auth_tokens/.test(sql)) return row([]);
    if (/UPDATE parent_auth_tokens SET revoked_at/.test(sql)) {
      const userId = Number(params[0]); const type = String(params[1]);
      state.tokens.filter(t => Number(t.user_id) === userId && t.type === type && !t.used_at && !t.revoked_at)
        .forEach(t => { t.revoked_at = new Date(); }); return row([]);
    }
    if (/INSERT INTO parent_auth_tokens/.test(sql)) {
      state.tokens.push({ id: state.nextToken++, user_id: params[0], hash: params[1],
        type: params[2], expires_at: new Date(Date.now() + Number(params[3]) * 3600000),
        used_at: null, revoked_at: null }); return row([]);
    }
    if (/UPDATE parent_auth_tokens SET used_at/.test(sql)) {
      const found = state.tokens.find(t => t.id === Number(params[0]));
      if (found) { found.used_at = new Date(); return row([{ user_id: found.user_id }]); }
      return row([]);
    }
    if (/SELECT id,email,role,student_number,first_name,last_name,phone_number/.test(sql)) {
      return row(state.user && state.user.is_active ? [state.user] : []);
    }
    if (/SELECT id FROM users WHERE id=\$1 AND role=\$2 FOR UPDATE/.test(sql)) {
      return row(state.user && Number(params[0]) === state.user.id && params[1] === 'parent' ? [{ id: state.user.id }] : []);
    }
    if (/UPDATE users SET password=\$1,parent_account_status/.test(sql) ||
        /UPDATE users SET password=\$1,\s*must_change_password/.test(sql)) {
      state.user.password = params[0]; state.user.must_change_password = false;
      state.user.parent_account_status = 'active'; state.user.parent_activation_state = 'active';
      return row([]);
    }
    if (/SELECT id,activated_at,invitation_sent_at,last_login_at/.test(sql)) {
      return row([{ id: state.user.id, activated_at: new Date(), invitation_sent_at: new Date(),
        last_login_at: null, password_changed_at: new Date(), email: state.user.email,
        is_active: state.user.is_active, status: state.user.is_active ? 'ACTIVATED' : 'DISABLED' }]);
    }
    if (/UPDATE users SET is_active=false/.test(sql)) { state.user.is_active = false; return row([]); }
    if (/UPDATE users SET is_active=true/.test(sql)) { state.user.is_active = true; return row([]); }
    return row([]);
  },
  pool: { async connect() { return { query: db.query.bind(db), release() {} }; } },
};
const authMiddleware = {
  authenticate: (req, res, next) => {
    req.user = String(req.headers.authorization || '').includes('admin')
      ? { id: 99, role: 'admin', first_name: 'Admin' } : { ...state.user };
    next();
  },
  authorize: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' }),
};
mock('../config/database', db);
mock('../middleware/auth', authMiddleware);
mock('../utils/auditLogger', { logAudit: async () => {}, getIp: () => '127.0.0.1' });
mock('../services/gmailService', {
  sendEmail: async (...args) => { state.mail.push(args); return { success: true }; },
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
});

const parentAuth = require('../services/parentAuth');
const authRouter = require('../routes/auth');
const parentRouter = require('../routes/parent');
const app = express(); app.use(express.json());
app.use('/api/auth', authRouter); app.use('/api/parent', parentRouter);
const server = http.createServer(app); let base;
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(async () => {
  state.user.password = await bcrypt.hash('CorrectPassword1', 4);
  state.user.is_active = true;
  state.user.auth_revoked_at = null;
  state.user.must_change_password = false;
  state.user.parent_account_status = 'pending';
  state.user.parent_activation_state = 'pending';
  state.children = [];
  state.tokens = [];
  state.sessions = [];
  state.mail = [];
  state.queries = [];
  state.nextToken = 1;
  state.nextSession = 1;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const [name, value] of original) require.cache[name] = value;
});
const json = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
};

test('parent login accepts legacy phone forms, rejects invalid/inactive users, and preserves zero-child compatibility', async () => {
  state.children = [];
  let result = await json('/api/auth/login/parent', { method: 'POST', body: JSON.stringify({ phone_number: '082 123 4567', password: 'CorrectPassword1' }) });
  assert.equal(result.response.status, 200); assert.equal(result.body.children.length, 0); assert.equal(result.body.child, null);
  result = await json('/api/auth/login/parent', { method: 'POST', body: JSON.stringify({ phone_number: '0821234567', password: 'wrong' }) });
  assert.equal(result.response.status, 401); assert.equal(result.body.message, 'Incorrect phone number or password');
  state.user.is_active = false;
  result = await json('/api/auth/login/parent', { method: 'POST', body: JSON.stringify({ phone_number: '0821234567', password: 'CorrectPassword1' }) });
  assert.equal(result.response.status, 401); assert.equal(result.body.message, 'Account is deactivated. Please contact the school.');
  state.user.is_active = true;
});

test('disabled self-activation is isolated from finance and operational tooling', () => {
  assert.equal(process.env.PARENT_SELF_ACTIVATION_ENABLED, 'false');
  for (const file of [
    'services/financeLedger.js',
    'routes/invoices.js',
    'scripts/audit-parent-self-activation.js',
    'scripts/run-parent-self-activation-migration.js',
  ]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /PARENT_SELF_ACTIVATION_ENABLED|isParentSelfActivationEnabled/);
  }
});

test('rememberMe reaches the server and refresh cookies have secure flags with distinct TTLs', async () => {
  state.sessions = []; state.children = [{ id: 101, first_name: 'Kid' }];
  const normal = await json('/api/auth/login/parent', { method: 'POST', body: JSON.stringify({ phone_number: '0821234567', password: 'CorrectPassword1' }) });
  const normalCookie = normal.response.headers.get('set-cookie').split(';')[0];
  assert.match(normal.response.headers.get('set-cookie'), /HttpOnly/); assert.match(normal.response.headers.get('set-cookie'), /Secure/);
  assert.doesNotMatch(normal.response.headers.get('set-cookie'), /Max-Age=/,
    'normal sessions use a browser-session cookie');
  const rotatedNormal = await json('/api/auth/refresh', { method: 'POST', headers: { cookie: normalCookie } });
  assert.equal(rotatedNormal.response.status, 200);
  const normalLoginClaims = require('jsonwebtoken').decode(normal.body.token);
  const normalRefreshClaims = require('jsonwebtoken').decode(rotatedNormal.body.token);
  assert.equal(normalLoginClaims.id, state.user.id);
  assert.equal(normalRefreshClaims.id, normalLoginClaims.id,
    'refresh must preserve the same parent identity claim as login');
  assert.equal(normalRefreshClaims.role, normalLoginClaims.role);
  assert.ok(normalRefreshClaims.session_id);
  assert.doesNotMatch(rotatedNormal.response.headers.get('set-cookie'), /Max-Age=/,
    'rotating a normal session must not make it persistent');
  const remembered = await json('/api/auth/login/parent', { method: 'POST', body: JSON.stringify({ phone_number: '0821234567', password: 'CorrectPassword1', rememberMe: true }) });
  assert.match(remembered.response.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.match(remembered.response.headers.get('set-cookie'), /Expires=/);
  assert.match(remembered.response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.match(remembered.response.headers.get('set-cookie'), /Path=\/api\/auth/);
  assert.equal(remembered.body.sessionMode, 'remembered');
  const rememberedCookie = remembered.response.headers.get('set-cookie').split(';')[0];
  const rotatedRemembered = await json('/api/auth/refresh', {
    method: 'POST',
    headers: { cookie: rememberedCookie },
  });
  assert.equal(rotatedRemembered.response.status, 200);
  const rememberedLoginClaims = require('jsonwebtoken').decode(remembered.body.token);
  const rememberedRefreshClaims = require('jsonwebtoken').decode(rotatedRemembered.body.token);
  assert.equal(rememberedRefreshClaims.id, rememberedLoginClaims.id,
    'remembered verification refresh must preserve the parent identity claim');
  assert.equal(rememberedRefreshClaims.role, 'parent');
  assert.ok(rememberedRefreshClaims.session_id);
  assert.ok(state.sessions.every(s => s.family_expires_at instanceof Date));
  const family = state.sessions[0].family_expires_at.getTime();
  assert.equal(state.sessions[0].family_expires_at.getTime(), family);
});

test('frontend sends rememberMe and does not persist parent login credentials', () => {
  const loginSource = fs.readFileSync('client/src/components/parent/ParentLogin.js', 'utf8');
  assert.match(loginSource, /rememberMe:\s*remember/);
  assert.match(loginSource, /if \(remember\)[\s\S]*await refreshParentAccess\(\)/);
  assert.match(loginSource, /sessionMode !== 'remembered'/);
  assert.doesNotMatch(loginSource, /setItem\(['"](?:parentPhone|parentPassword)/);
  assert.match(loginSource, /const storage = sessionStorage/);
});

test('parent access tokens carry session identity and auth-token issuance locks the parent row', async () => {
  const token = parentAuth.accessToken(state.user, 42);
  const payload = require('jsonwebtoken').decode(token);
  assert.equal(payload.session_id, 42);
  const before = state.queries.length;
  await parentAuth.issueAuthToken(10, 'activation');
  const sql = state.queries.slice(before).map(q => q.sql).join('\n');
  assert.match(sql, /SELECT id FROM users WHERE id=\$1 AND role=\$2 FOR UPDATE/);
  assert.match(sql, /UPDATE parent_auth_tokens SET revoked_at/);
  assert.match(sql, /INSERT INTO parent_auth_tokens/);
  const middleware = fs.readFileSync('middleware/auth.js', 'utf8');
  assert.match(middleware, /role === 'parent' && !decoded\.session_id/);
  assert.match(middleware, /s\.revoked_at IS NULL/);
  assert.match(middleware, /s\.expires_at>NOW\(\)/);
  assert.match(middleware, /s\.family_expires_at>NOW\(\)/);
});

test('remembered mode survives late-family rotations while normal families stay session cookies', async () => {
  const login = await json('/api/auth/login/parent', {
    method: 'POST',
    body: JSON.stringify({ phone_number: '0821234567', password: 'CorrectPassword1', rememberMe: true }),
  });
  assert.equal(login.response.status, 200);
  const originalNow = Date.now;
  const familyOrigin = originalNow();
  const lateFamilyNow = familyOrigin + 29 * 86400000;
  Date.now = () => lateFamilyNow;
  try {
    let cookie = login.response.headers.get('set-cookie').split(';')[0];
    const lateRotation = await json('/api/auth/refresh', { method: 'POST', headers: { cookie } });
    assert.equal(lateRotation.response.status, 200);
    assert.match(lateRotation.response.headers.get('set-cookie'), /Max-Age=\d+/,
      'remembered mode remains persistent near family expiry');
    cookie = lateRotation.response.headers.get('set-cookie').split(';')[0];

    // The successor row is now a late-created rotation. Its cookie must still
    // be persistent because SQL derives mode from the family origin.
    const secondLateRotation = await json('/api/auth/refresh', { method: 'POST', headers: { cookie } });
    assert.equal(secondLateRotation.response.status, 200);
    assert.match(secondLateRotation.response.headers.get('set-cookie'), /Max-Age=\d+/,
      'every remembered rotation preserves persistence');
  } finally {
    Date.now = originalNow;
  }

  const normal = await json('/api/auth/login/parent', {
    method: 'POST',
    body: JSON.stringify({ phone_number: '0821234567', password: 'CorrectPassword1' }),
  });
  assert.equal(normal.response.status, 200);
  assert.doesNotMatch(normal.response.headers.get('set-cookie'), /Max-Age=/,
    'normal families remain browser-session cookies');
});

test('forgot password is enumeration-safe and reset is expiring, one-use, and revokes sessions', async () => {
  state.mail = []; state.tokens = [];
  const missing = await json('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'missing@example.test' }) });
  const present = await json('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: state.user.email }) });
  assert.equal(missing.response.status, 200); assert.deepEqual(missing.body, present.body);
  assert.equal(state.mail.length, 1);
  assert.doesNotMatch(state.mail[0][2], /<script|alert\(1\)/i);
  const token = state.tokens.find(t => t.type === 'reset'); assert.ok(token);
  const raw = 'reset-route-token-with-sufficient-length'; token.hash = parentAuth.hashToken(raw);
  const reset = await json('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: raw, new_password: 'NewPassword1' }) });
  assert.equal(reset.response.status, 200); assert.ok(token.used_at); assert.ok(state.sessions.every(s => s.revoked_at));
  const reused = await json('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: raw, new_password: 'NewPassword2' }) });
  assert.equal(reused.response.status, 400); assert.match(reused.body.message, /Invalid or expired/);
});

test('activation hashes tokens, preserves link safety, supports reissue and revocation', async () => {
  state.tokens = []; state.mail = [];
  const raw = 'activation-route-token';
  state.tokens.push({ id: 77, user_id: 10, hash: parentAuth.hashToken(raw), type: 'activation',
    expires_at: new Date(Date.now() + 3600000), used_at: null, revoked_at: null });
  const activated = await json('/api/parent/activate', { method: 'POST', body: JSON.stringify({ token: raw, password: 'ActivateMe1' }) });
  assert.equal(activated.response.status, 200); assert.ok(state.tokens[0].used_at);
  assert.equal(activated.body.user_id, undefined, 'activation must not disclose identity');
  assert.match(activated.body.token, /^[A-Za-z0-9._-]+$/, 'activation creates an access token');
  assert.match(activated.response.headers.get('set-cookie') || '', /parent_refresh=/,
    'successful activation creates an authenticated session');
  const reused = await json('/api/parent/activate', { method: 'POST', body: JSON.stringify({ token: raw, password: 'ActivateMe2' }) });
  assert.equal(reused.response.status, 400);
  const expired = { id: 78, user_id: 10, hash: parentAuth.hashToken('expired'), type: 'activation',
    expires_at: new Date(Date.now() - 1), used_at: null, revoked_at: null }; state.tokens.push(expired);
  const bad = await json('/api/parent/activate', { method: 'POST', body: JSON.stringify({ token: 'expired', password: 'ActivateMe1' }) });
  assert.equal(bad.response.status, 400);
  assert.deepEqual(Object.keys(bad.body), ['message'], 'invalid activation masks account identity');
  const invite = await json('/api/parent/admin/10/invite', {
    method: 'POST', headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(invite.response.status, 200);
  const activeInvitation = state.tokens.find(t => t.type === 'activation' && !t.used_at && !t.revoked_at);
  assert.ok(activeInvitation);
  const reissue = await json('/api/parent/admin/10/reissue', {
    method: 'POST', headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(reissue.response.status, 200);
  assert.match(reissue.body.activationLink, /^https:\/\/portal\.example\.test\/parent\/activate\?token=/);
  assert.ok(activeInvitation.revoked_at, 'reissue revokes the previous unused invitation');
  assert.ok(state.tokens.some(t => t.type === 'activation' && !t.used_at && !t.revoked_at));
  assert.notEqual(parentAuth.hashToken(raw), raw); // one-way hash never equals the supplied token
});

test('auth email escapes recipient data and migration remains manual/idempotent', async () => {
  state.mail = [];
  await parentAuth.sendParentAuthEmail('safe@example.test', 'a&b?x=1', 'activation', '<script>alert(1)</script>');
  assert.equal(state.mail.length, 1);
  assert.match(state.mail[0][2], /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(state.mail[0][2], /token=a%26b%3Fx%3D1/);
  assert.equal(state.mail[0][3]?.fromName, 'Harmony Parent Portal — powered by AutoM8');
  assert.equal(state.mail[0][3]?.replyTo, 'harmonylearninginstitute@gmail.com');
  const migration = fs.readFileSync('migrations/parent_activation_phase2.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS parent_auth_tokens/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS parent_sessions/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
  assert.doesNotMatch(fs.readFileSync('server.js', 'utf8'), /migrate:parent-activation|run-parent-activation-migration/);
});

test('logout, refresh replay, password change, and admin disable revoke sessions', async () => {
  const login = await json('/api/auth/login/parent', { method: 'POST', body: JSON.stringify({ phone_number: '0821234567', password: 'CorrectPassword1', rememberMe: true }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  state.queries = [];
  const first = await json('/api/auth/refresh', { method: 'POST', headers: { cookie } });
  assert.equal(first.response.status, 200);
  const firstSession = state.sessions.find(s => s.replaced_by_hash);
  const successor = state.sessions.find(s => s.hash !== firstSession?.hash && s.family_id === firstSession?.family_id);
  assert.ok(firstSession && successor);
  assert.equal(successor.family_expires_at.getTime(), firstSession.family_expires_at.getTime());
  assert.ok(Number(first.response.headers.get('set-cookie').match(/Max-Age=(\d+)/)?.[1]) <=
    Math.ceil((firstSession.family_expires_at.getTime() - Date.now()) / 1000));
  const refreshSql = state.queries.map(q => q.sql);
  assert.ok(refreshSql.some(sql => /UPDATE parent_sessions SET revoked_at=NOW\(\),last_used_at/.test(sql)));
  assert.ok(refreshSql.some(sql => /INSERT INTO parent_sessions/.test(sql)));
  assert.ok(refreshSql.some(sql => /replaced_by_hash=\$1/.test(sql)));
  const replay = await json('/api/auth/refresh', { method: 'POST', headers: { cookie } });
  assert.equal(replay.response.status, 401); assert.ok(state.sessions.every(s => s.revoked_at));
  const logout = await json('/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logout.response.status, 200);
  assert.ok(state.sessions.some(s => s.revoked_at), 'logout revokes cookie session without bearer');
  const status = await json('/api/parent/admin/10/status', {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(status.response.status, 200);
  assert.deepEqual(Object.keys(status.body.parent).sort(), [
    'activated_at', 'email', 'id', 'invitation_sent_at', 'is_active',
    'last_login_at', 'password_changed_at', 'status',
  ].sort());
  const disable = await json('/api/parent/admin/10/disable', { method: 'POST', headers: { authorization: 'Bearer admin-token' } });
  assert.equal(disable.response.status, 200); assert.equal(state.user.is_active, false);
  state.user.is_active = true;
});