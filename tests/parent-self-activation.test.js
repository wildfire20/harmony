/*
 * Endpoint-level Parent self-activation regression tests.
 *
 * This uses the real Express router and service code.  The database double
 * models aliases/locking/transaction boundaries used by the production SQL;
 * it does not run a migration or create an account on behalf of a caller.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'parent-self-activation-test-secret';
process.env.PARENT_OTP_SECRET = 'parent-self-activation-otp-secret';
process.env.PARENT_SELF_ACTIVATION_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'https://portal.example.test/';

const originalCache = new Map();
function mock(name, exports) {
  const resolved = require.resolve(name);
  originalCache.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const clone = value => JSON.parse(JSON.stringify(value));
const state = {
  parents: [],
  links: [],
  challenges: [],
  tokens: [],
  sessions: [],
  audits: [],
  mail: [],
  queries: [],
  nextChallenge: 1,
  nextSession: 1,
  failMail: false,
  failInvalidation: false,
  failAudit: false,
  failSession: false,
  failChildren: false,
};

function parent(id = 10, phone = '27731234567') {
  return {
    id, phone_number: phone, email: null, first_name: `Parent${id}`,
    last_name: 'Test', role: 'parent', is_active: true,
    activated_at: null, parent_account_status: 'pending',
    must_change_password: true, password: 'old-password-hash',
    email_verified_at: null,
  };
}

function reset(next = parent()) {
  delete process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS;
  state.parents = [next];
  state.links = [{ id: 501, first_name: 'Learner', last_name: 'One', student_number: 'L-1' }];
  state.challenges = [];
  state.tokens = [{ id: 70, user_id: next.id, token_type: 'activation',
    token_hash: 'legacy-token-hash', expires_at: new Date(Date.now() + 3600000).toISOString(),
    used_at: null, revoked_at: null },
  { id: 72, user_id: next.id, token_type: 'reset',
    token_hash: 'legacy-reset-hash', expires_at: new Date(Date.now() + 3600000).toISOString(),
    used_at: null, revoked_at: null }];
  state.sessions = [];
  state.audits = [];
  state.mail = [];
  state.queries = [];
  state.nextChallenge = 1;
  state.nextSession = 1;
  state.failMail = false;
  state.failInvalidation = false;
  state.failAudit = false;
  state.failSession = false;
  state.failChildren = false;
}
reset();

function copyState(target, source) {
  for (const key of ['parents', 'links', 'challenges', 'tokens', 'sessions', 'audits']) {
    target[key] = clone(source[key]);
  }
  target.nextChallenge = source.nextChallenge;
  target.nextSession = source.nextSession;
}

function userFields(user) {
  return {
    id: user.id, phone_number: user.phone_number, email: user.email,
    first_name: user.first_name, last_name: user.last_name,
    role: user.role, is_active: user.is_active,
    activated_at: user.activated_at, parent_account_status: user.parent_account_status,
  };
}

function challengeFor(tx, id) {
  const challenge = tx.challenges.find(item => Number(item.id) === Number(id));
  if (!challenge) return null;
  const user = tx.parents.find(item => item.id === challenge.user_id);
  return { challenge, user };
}

async function execute(tx, sql, params = []) {
  state.queries.push({ sql, params });
  if (state.failAudit && /INSERT INTO audit_logs/.test(sql)) throw new Error('audit unavailable');
  if (state.failInvalidation &&
      /UPDATE parent_activation_challenges SET invalidated_at=NOW\(\)/.test(sql) &&
      /WHERE id=\$1/.test(sql)) throw new Error('challenge invalidation unavailable');

  if (/SELECT u\.id, u\.phone_number/.test(sql)) {
    return { rows: tx.parents.map(userFields) };
  }
  if (/SELECT id,is_active,activated_at,parent_account_status FROM users/.test(sql)) {
    const user = tx.parents.find(item => item.id === Number(params[0]));
    return { rows: user ? [{ id: user.id, is_active: user.is_active,
      activated_at: user.activated_at, parent_account_status: user.parent_account_status }] : [] };
  }
  if (/SELECT id, last_sent_at FROM parent_activation_challenges/.test(sql)) {
    const rows = tx.challenges
      .filter(item => item.user_id === Number(params[0]) && !item.invalidated_at && !item.consumed_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: rows.slice(0, 1) };
  }
  if (/SELECT COUNT\(\*\)::int AS count FROM parent_activation_challenges/.test(sql)) {
    const today = new Date().toISOString().slice(0, 10);
    const count = tx.challenges.filter(item => item.user_id === Number(params[0]) &&
      String(item.created_at).slice(0, 10) === today).length;
    return { rows: [{ count }] };
  }
  if (/UPDATE parent_activation_challenges SET invalidated_at=NOW\(\)/.test(sql)) {
    if (/WHERE id=\$1/.test(sql)) {
      const item = tx.challenges.find(challenge => challenge.id === Number(params[0]));
      if (item && !item.consumed_at && !item.invalidated_at) item.invalidated_at = new Date().toISOString();
    } else {
      tx.challenges.filter(item => item.user_id === Number(params[0]) &&
        !item.consumed_at && !item.invalidated_at)
        .forEach(item => { item.invalidated_at = new Date().toISOString(); });
    }
    return { rows: [] };
  }
  if (/INSERT INTO parent_activation_challenges/.test(sql)) {
    const item = {
      id: tx.nextChallenge++, user_id: Number(params[0]), email: params[1],
      otp_hash: params[2], expires_at: new Date(Date.now() + Number(params[3]) * 60000).toISOString(),
      attempts: 0, max_attempts: Number(params[4]), last_sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(), verified_at: null, consumed_at: null,
      invalidated_at: null, delivery_confirmed_at: null, completion_token_hash: null,
    };
    tx.challenges.push(item);
    return { rows: [{ id: item.id }] };
  }
  if (/UPDATE parent_activation_challenges SET delivery_confirmed_at=NOW\(\)/.test(sql)) {
    const item = tx.challenges.find(challenge => challenge.id === Number(params[0]));
    if (!item || item.consumed_at || item.invalidated_at) return { rows: [] };
    item.delivery_confirmed_at = new Date().toISOString();
    return { rows: [{ id: item.id }] };
  }
  if (/SELECT c\.id,c\.user_id,c\.otp_hash/.test(sql) ||
      /SELECT c\.id,c\.user_id,c\.email/.test(sql)) {
    const found = challengeFor(tx, params[0]);
    if (!found) return { rows: [] };
    const { challenge, user } = found;
    if (/c\.user_id,c\.email/.test(sql)) {
      return { rows: [{
        id: challenge.id, user_id: user.id, email: challenge.email,
        verified_at: challenge.verified_at, consumed_at: challenge.consumed_at,
        invalidated_at: challenge.invalidated_at, expires_at: challenge.expires_at,
        completion_token_hash: challenge.completion_token_hash,
        parent_id: user.id, current_email: user.email, role: user.role,
        is_active: user.is_active, activated_at: user.activated_at,
        parent_account_status: user.parent_account_status,
        first_name: user.first_name, last_name: user.last_name, phone_number: user.phone_number,
      }] };
    }
    return { rows: [{
      id: challenge.id, user_id: challenge.user_id, otp_hash: challenge.otp_hash, attempts: challenge.attempts,
      max_attempts: challenge.max_attempts, expires_at: challenge.expires_at,
      verified_at: challenge.verified_at, delivery_confirmed_at: challenge.delivery_confirmed_at,
      consumed_at: challenge.consumed_at,
      invalidated_at: challenge.invalidated_at, is_active: user.is_active,
      role: user.role, activated_at: user.activated_at,
      parent_account_status: user.parent_account_status,
    }] };
  }
  if (/UPDATE parent_activation_challenges\s+SET attempts=attempts\+1/.test(sql)) {
    const item = tx.challenges.find(challenge => challenge.id === Number(params[0]));
    if (item && !item.consumed_at && !item.invalidated_at) {
      item.attempts += 1;
      if (item.attempts >= item.max_attempts) item.invalidated_at = new Date().toISOString();
    }
    return { rows: [] };
  }
  if (/UPDATE parent_activation_challenges SET verified_at=NOW\(\)/.test(sql)) {
    const item = tx.challenges.find(challenge => challenge.id === Number(params[0]));
    if (item && !item.verified_at && !item.consumed_at && !item.invalidated_at) {
      item.verified_at = new Date().toISOString();
      item.completion_token_hash = params[1];
    }
    return { rows: [] };
  }
  if (/SELECT id,role,is_active,activated_at,parent_account_status FROM users/.test(sql)) {
    const user = tx.parents.find(item => item.id === Number(params[0]));
    return { rows: user ? [{ id: user.id, role: user.role, is_active: user.is_active,
      activated_at: user.activated_at, parent_account_status: user.parent_account_status }] : [] };
  }
  if (/UPDATE users SET password=\$1,email=\$2,email_verified_at=NOW/.test(sql)) {
    const user = tx.parents.find(item => item.id === Number(params[2]));
    if (!user || user.role !== 'parent' || !user.is_active) return { rows: [] };
    user.password = params[0]; user.email = params[1];
    user.email_verified_at = new Date().toISOString();
    user.must_change_password = false; user.activated_at = new Date().toISOString();
    user.parent_account_status = 'active';
    return { rows: [{
      id: user.id, email: user.email, email_verified_at: user.email_verified_at,
      role: user.role, student_number: user.student_number || null,
      first_name: user.first_name, last_name: user.last_name,
      phone_number: user.phone_number, must_change_password: false,
    }] };
  }
  if (/UPDATE parent_activation_challenges\s+SET consumed_at=NOW/.test(sql)) {
    tx.challenges.filter(item => item.user_id === Number(params[0]) &&
      !item.consumed_at && !item.invalidated_at)
      .forEach(item => { item.consumed_at = new Date().toISOString(); item.invalidated_at = new Date().toISOString(); });
    return { rows: [] };
  }
  if (/UPDATE parent_auth_tokens SET revoked_at=NOW/.test(sql)) {
    tx.tokens.filter(item => item.user_id === Number(params[0]) &&
      !item.used_at && !item.revoked_at).forEach(item => { item.revoked_at = new Date().toISOString(); });
    return { rows: [] };
  }
  if (/INSERT INTO audit_logs/.test(sql)) {
    tx.audits.push({ action: params[3], entity_id: params[5] });
    return { rows: [] };
  }
  if (/INSERT INTO parent_sessions/.test(sql)) {
    if (state.failSession) throw new Error('session unavailable');
    const id = tx.nextSession++;
    tx.sessions.push({ id, user_id: Number(params[0]), refresh_token_hash: params[1] });
    return { rows: [{ id }] };
  }
  if (/FROM parent_students/.test(sql)) {
    if (state.failChildren) throw new Error('children unavailable');
    return { rows: tx.links.map(item => ({ ...item })) };
  }
  return { rows: [] };
}

const db = {
  query: (sql, params) => execute(state, sql, params),
  pool: {
    async connect() {
      const tx = clone(state);
      return {
        query: async (sql, params = []) => {
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'COMMIT') { copyState(state, tx); return { rows: [] }; }
          if (sql === 'ROLLBACK') return { rows: [] };
          return execute(tx, sql, params);
        },
        release() {},
      };
    },
  },
};

mock('../config/database', db);
mock('../middleware/auth', {
  authenticate: (req, res, next) => { req.user = { id: 999, role: 'parent' }; next(); },
  authorize: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' }),
});
mock('../utils/auditLogger', {
  logAudit: async options => options.executor.query(
    'INSERT INTO audit_logs (user_id,user_name,user_role,action,entity_type,entity_id,details,ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [options.userId, options.userName, options.userRole, options.action,
      options.entityType, options.entityId, JSON.stringify(options.details), options.ipAddress],
  ),
  getIp: () => '127.0.0.1',
});
mock('../services/gmailService', {
  sendEmail: async (...args) => {
    if (state.failMail) throw new Error('mail provider failed');
    state.mail.push(args);
    return { success: true };
  },
  escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char])),
});
mock('../services/financeLedger', { getStudentLedger: async () => ({ totals: { outstanding: 0 } }) });

const parentAuth = require('../services/parentAuth');
const parentRouter = require('../routes/parent');
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/parent', parentRouter);
const server = http.createServer(app);
let base;
let requestNumber = 0;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const [name, value] of originalCache) require.cache[name] = value;
});

test.beforeEach(() => {
  reset();
  requestNumber += 1;
});

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${requestNumber++}`,
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

test('disabled self-activation fails closed before database or email work', async () => {
  const previous = process.env.PARENT_SELF_ACTIVATION_ENABLED;
  process.env.PARENT_SELF_ACTIVATION_ENABLED = 'false';
  state.queries = [];
  state.mail = [];
  try {
    for (const path of [
      '/api/parent/activation/request',
      '/api/parent/activation/verify',
      '/api/parent/activation/complete',
    ]) {
      const result = await json(path, { method: 'POST', body: JSON.stringify({}) });
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.body, { message: 'Parent self-activation is not available yet.' });
    }
    assert.equal(state.queries.length, 0);
    assert.equal(state.mail.length, 0);
  } finally {
    if (previous === undefined) delete process.env.PARENT_SELF_ACTIVATION_ENABLED;
    else process.env.PARENT_SELF_ACTIVATION_ENABLED = previous;
  }
});

const activationInput = (phone = '073 123 4567') => ({
  phone_number: phone,
  email: 'new.parent@example.test',
  email_confirmation: 'new.parent@example.test',
});

async function requestCode(phone) {
  const result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput(phone)),
  });
  assert.equal(result.response.status, 200);
  const challenge = state.challenges.find(item => item.id === result.body.challenge_id);
  assert.ok(challenge);
  assert.ok(challenge.delivery_confirmed_at);
  const otp = state.mail.at(-1)[2].match(/code is <strong>(\d{6})<\/strong>/)[1];
  return { challenge, otp, responseBody: result.body };
}

async function verifyCode(flow) {
  const result = await json('/api/parent/activation/verify', {
    method: 'POST', body: JSON.stringify({ challenge_id: flow.challenge.id, otp: flow.otp }),
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.completion_token, /^[A-Za-z0-9_-]{40,}$/);
  const stored = state.challenges.find(item => item.id === flow.challenge.id);
  assert.equal(stored.completion_token_hash,
    parentAuth.hashToken(result.body.completion_token));
  assert.doesNotMatch(JSON.stringify(state.challenges), new RegExp(result.body.completion_token));
  flow.challenge = stored;
  flow.completionToken = result.body.completion_token;
  return result;
}

test('accepts common South African mobile formats without creating accounts or links', async () => {
  const formats = ['0731234567', '073 123 4567', '073-123-4567', '+27731234567', '27731234567'];
  for (const phone of formats) {
    reset(parent(10, '27731234567'));
    const beforeParents = clone(state.parents);
    const beforeLinks = clone(state.links);
    const result = await json('/api/parent/activation/request', {
      method: 'POST', body: JSON.stringify(activationInput(phone)),
    });
    assert.equal(result.response.status, 200, phone);
    assert.deepEqual(state.parents, beforeParents);
    assert.deepEqual(state.links, beforeLinks);
  }
});

test('duplicate phones fail generically without changing either Parent account', async () => {
  reset(parent(10, '0731234567'));
  state.parents.push(parent(11, '+27731234567'));
  const parentsBefore = clone(state.parents);
  const result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('073 123 4567')),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.message, 'We could not verify those details. Please contact your school.');
  assert.deepEqual(state.parents, parentsBefore);
  assert.equal(state.challenges.length, 0);
});

test('missing and ambiguous mobiles return the same public failure without sending email', async () => {
  reset(parent(10, '0731234567'));
  state.parents = [];
  state.links = [];
  state.tokens = [];
  const missing = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('073 123 4567')),
  });

  reset(parent(10, '0731234567'));
  state.parents.push(parent(11, '+27731234567'));
  const ambiguous = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('073 123 4567')),
  });
  assert.equal(missing.response.status, ambiguous.response.status);
  assert.deepEqual(missing.body, ambiguous.body);
  assert.equal(state.mail.length, 0);
});

test('pilot Parent is allowed while a non-pilot Parent is generically rejected', async () => {
  reset(parent(433, '0731234567'));
  process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS = '433,434';
  const allowed = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(allowed.response.status, 200);
  assert.equal(state.challenges.length, 1);

  reset(parent(435, '0731234567'));
  process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS = '433,434';
  const rejected = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.message, 'We could not verify those details. Please contact your school.');
  assert.equal(state.challenges.length, 0);
  assert.equal(state.mail.length, 0);
});

test('removing the pilot restriction allows an ordinary eligible Parent', async () => {
  reset(parent(435, '0731234567'));
  delete process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS;
  const result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(result.response.status, 200);
  assert.equal(state.challenges.length, 1);
});

test('an already activated account cannot self-activate and is directed to password recovery', async () => {
  const activated = parent();
  activated.activated_at = new Date().toISOString();
  activated.parent_account_status = 'active';
  reset(activated);
  const result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('073 123 4567')),
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.message, /already activated/i);
  assert.equal(result.body.forgotPassword, '/api/auth/forgot-password');
  assert.equal(state.challenges.length, 0);
  assert.equal(state.mail.length, 0);
});

test('OTP is six digits, response-free, HMAC stored, and mail failure invalidates it', async () => {
  const first = await requestCode('0731234567');
  assert.match(first.otp, /^\d{6}$/);
  assert.doesNotMatch(JSON.stringify(first.responseBody), new RegExp(first.otp));
  assert.equal(first.challenge.otp_hash, parentAuth.parentOtpHash(first.otp));
  assert.notEqual(first.challenge.otp_hash, first.otp);
  state.failMail = true;
  state.challenges[0].last_sent_at = new Date(Date.now() - 120000).toISOString();
  const result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(result.response.status, 503);
  assert.ok(state.challenges.every(item => item.invalidated_at));
});

test('a Gmail failure is unusable even when its cleanup invalidation fails', async () => {
  state.failMail = true;
  state.failInvalidation = true;
  const result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(result.response.status, 503);
  assert.equal(state.challenges.length, 1);
  assert.equal(state.challenges[0].delivery_confirmed_at, null);
  state.failMail = false;
  const verify = await json('/api/parent/activation/verify', {
    method: 'POST', body: JSON.stringify({ challenge_id: state.challenges[0].id, otp: '000000' }),
  });
  assert.equal(verify.response.status, 400);
  assert.equal(state.parents[0].parent_account_status, 'pending');
});

test('wrong OTP attempts persist and max attempts invalidate the challenge', async () => {
  const { challenge } = await requestCode('0731234567');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await json('/api/parent/activation/verify', {
      method: 'POST', body: JSON.stringify({ challenge_id: challenge.id, otp: '000000' }),
    });
    assert.equal(result.response.status, 400);
    assert.equal(state.challenges[0].attempts, attempt);
  }
  assert.ok(state.challenges[0].invalidated_at);
});

test('resend cooldown, daily limits, and replacement challenge invalidation are enforced', async () => {
  const first = await requestCode('0731234567');
  let result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(result.response.status, 429);
  state.challenges[0].last_sent_at = new Date(Date.now() - 120000).toISOString();
  const second = await requestCode('0731234567');
  assert.ok(state.challenges.find(item => item.id === first.challenge.id).invalidated_at);
  assert.equal(state.challenges.filter(item => !item.invalidated_at && !item.consumed_at).length, 1);

  state.challenges.forEach(item => { item.invalidated_at = new Date().toISOString(); });
  for (let i = state.challenges.length; i < 5; i += 1) {
    state.challenges.push({
      id: state.nextChallenge++, user_id: 10, email: 'old@example.test',
      otp_hash: 'x'.repeat(64), expires_at: new Date(Date.now() + 600000).toISOString(),
      attempts: 0, max_attempts: 5, last_sent_at: new Date(Date.now() - 120000).toISOString(),
      created_at: new Date().toISOString(), verified_at: null, consumed_at: null, invalidated_at: new Date().toISOString(),
    });
  }
  state.challenges[0].invalidated_at = new Date().toISOString();
  result = await json('/api/parent/activation/request', {
    method: 'POST', body: JSON.stringify(activationInput('0731234567')),
  });
  assert.equal(result.response.status, 429);
  assert.equal(state.challenges.filter(item => !item.invalidated_at).length, 0);
  assert.ok(second.otp);
});

test('expired, replayed, and unverified challenges cannot complete activation', async () => {
  const first = await requestCode('0731234567');
  state.challenges[0].expires_at = new Date(Date.now() - 1).toISOString();
  let result = await json('/api/parent/activation/verify', {
    method: 'POST', body: JSON.stringify({ challenge_id: first.challenge.id, otp: first.otp }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(state.parents[0].parent_account_status, 'pending');

  state.challenges[0].last_sent_at = new Date(Date.now() - 120000).toISOString();
  const fresh = await requestCode('0731234567');
  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({ challenge_id: fresh.challenge.id, password: 'SecurePassword1' }),
  });
  assert.equal(result.response.status, 400);
  await verifyCode(fresh);
  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: fresh.challenge.id, completion_token: fresh.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 200);
  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: fresh.challenge.id, completion_token: fresh.completionToken,
      password: 'SecurePassword2',
    }),
  });
  assert.equal(result.response.status, 400);
});

test('completion requires its own verified challenge token, not only an ID or another parent token', async () => {
  reset(parent(10, '27731234567'));
  state.parents.push(parent(11, '27821234567'));
  state.tokens.push({ id: 71, user_id: 11, token_type: 'activation',
    token_hash: 'second-legacy-token-hash', expires_at: new Date(Date.now() + 3600000).toISOString(),
    used_at: null, revoked_at: null });
  const first = await requestCode('0731234567');
  const second = await requestCode('0821234567');
  await verifyCode(first);
  await verifyCode(second);

  let result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: first.challenge.id, password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 400);
  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: first.challenge.id, completion_token: second.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(state.parents[0].parent_account_status, 'pending');

  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: first.challenge.id, completion_token: first.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(state.parents[0].parent_account_status, 'active');
  assert.equal(state.parents[1].parent_account_status, 'pending');
});

test('multi-child pilot completion preserves all links and issues an identity session', async () => {
  process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS = '10';
  state.links.push({ id: 502, first_name: 'Learner', last_name: 'Two', student_number: 'L-2' });
  const beforeLinks = clone(state.links);
  const flow = await requestCode('0731234567');
  await verifyCode(flow);
  const { challenge } = flow;

  state.failAudit = true;
  let result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: challenge.id, completion_token: flow.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 500);
  assert.equal(state.parents[0].parent_account_status, 'pending');
  assert.equal(state.challenges[0].consumed_at, null);
  state.failAudit = false;

  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: challenge.id, completion_token: flow.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(state.parents.length, 1);
  assert.equal(state.parents[0].email, 'new.parent@example.test');
  assert.ok(state.parents[0].email_verified_at);
  assert.equal(state.parents[0].parent_account_status, 'active');
  assert.equal(await bcrypt.compare('SecurePassword1', state.parents[0].password), true);
  assert.deepEqual(state.links, beforeLinks);
  assert.ok(state.challenges[0].consumed_at);
  assert.ok(state.challenges[0].invalidated_at);
  assert.ok(state.tokens.filter(token => token.user_id === 10 && !token.used_at)
    .every(token => token.revoked_at));
  assert.equal(state.audits.length, 1);
  assert.equal(state.sessions[0].user_id, 10);
  assert.equal(jwt.decode(result.body.token).id, 10);
  assert.equal(jwt.decode(result.body.token).role, 'parent');
  assert.deepEqual(result.body.children, beforeLinks);
  assert.equal(result.body.user.id, 10);
  assert.equal(result.body.user.password, undefined);
  assert.deepEqual(Object.keys(result.body.user).sort(), [
    'email', 'email_verified_at', 'first_name', 'id', 'is_active',
    'last_name', 'must_change_password', 'phone_number', 'role', 'student_number',
  ].sort());
});

test('session or learner loading failure rolls back the complete activation transaction', async () => {
  const flow = await requestCode('0731234567');
  await verifyCode(flow);
  state.failSession = true;
  let result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: flow.challenge.id, completion_token: flow.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 500);
  assert.equal(state.parents[0].parent_account_status, 'pending');
  assert.equal(state.challenges[0].consumed_at, null);
  assert.equal(state.sessions.length, 0);

  state.failSession = false;
  state.failChildren = true;
  result = await json('/api/parent/activation/complete', {
    method: 'POST', body: JSON.stringify({
      challenge_id: flow.challenge.id, completion_token: flow.completionToken,
      password: 'SecurePassword1',
    }),
  });
  assert.equal(result.response.status, 500);
  assert.equal(state.parents[0].parent_account_status, 'pending');
  assert.equal(state.challenges[0].consumed_at, null);
  assert.equal(state.sessions.length, 0);
});