/*
 * Real HTTP routes, database module, token/session service and required audit.
 * Synthetic accounts only, in an isolated schema in an explicit disposable DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;
test('email-free Admin activation and Reset Access preserve token/session safeguards', {
  skip: databaseUrl ? false : 'Requires explicit disposable FINANCE_TEST_DATABASE_URL',
  timeout: 120000,
}, async (t) => {
  const schema = `parent_links_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ connectionString: databaseUrl, max: 1 });
  let db;
  let server;
  const saved = {};
  for (const key of ['JWT_SECRET', 'FRONTEND_URL', 'PARENT_SELF_ACTIVATION_ENABLED', 'BCRYPT_ROUNDS']) saved[key] = process.env[key];
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('options', `-csearch_path=${schema}`);
    db = require('../config/database');
    assert.equal(db.pool.totalCount, 0);
    db.pool.options.connectionString = scoped.toString();
    db.pool.options.ssl = process.env.FINANCE_TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
    db.pool.options.max = 2;
    db.pool.options.connectionTimeoutMillis = 10000;
    db.pool.options.query_timeout = 15000;
    process.env.JWT_SECRET = 'synthetic-parent-activation-test-secret';
    process.env.FRONTEND_URL = 'https://portal.example.test';
    process.env.PARENT_SELF_ACTIVATION_ENABLED = 'false';
    process.env.BCRYPT_ROUNDS = '4';
    // Refuse any mail attempt, rather than merely avoiding real recipients.
    const mailPath = require.resolve('../services/gmailService');
    require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: {
      sendEmail: async () => { throw new Error('This test must never send email'); },
      escapeHtml: value => String(value),
    } };
    await db.query(`
      CREATE TABLE grades (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, email TEXT, password TEXT, role TEXT,
        first_name TEXT, last_name TEXT, phone_number TEXT, student_number TEXT,
        is_active BOOLEAN DEFAULT true, must_change_password BOOLEAN DEFAULT true,
        grade_id INTEGER, class_id INTEGER, is_boarder BOOLEAN DEFAULT false,
        uses_transport BOOLEAN DEFAULT false, uses_aftercare BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE parent_students (parent_id INTEGER, student_id INTEGER);
      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY, user_id INTEGER, user_name TEXT, user_role TEXT,
        action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER,
        details JSONB, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO users (id,role,first_name,last_name,phone_number,email)
      VALUES (1,'super_admin','Synthetic','Admin',NULL,NULL),
        (10,'parent','Ada','Parent','27821234567',NULL),
        (501,'student','Synthetic','Learner',NULL,NULL);
      INSERT INTO parent_students VALUES (10,501);
    `);
    await db.query(fs.readFileSync('migrations/parent_activation_phase2.sql', 'utf8'));
    const app = express();
    app.use(express.json());
    app.use('/api/parent', require('../routes/parent'));
    app.use('/api/auth', require('../routes/auth'));
    server = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const admin = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const request = async (path, body, administrator = false) => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(administrator ? { authorization: `Bearer ${admin}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const copyLink = async () => {
      const result = await request('/api/parent/admin/10/copy-link', {}, true);
      assert.equal(result.status, 200);
      assert.equal(result.body.emailed, false);
      return new URL(result.body.activationLink).searchParams.get('token');
    };
    const validate = raw => request(`/api/parent/activation/validate?token=${encodeURIComponent(raw)}`);
    const activate = raw => request('/api/parent/activate', { token: raw, password: 'SecurePassword1', password_confirmation: 'SecurePassword1' });
    const { hashToken } = require('../services/parentAuth');
    let used;

    await t.test('Admin copy link validates masked identity, activates and signs in with phone/password without email', async () => {
      used = await copyLink();
      const stored = (await db.query('SELECT * FROM parent_auth_tokens')).rows[0];
      assert.equal(stored.token_hash, hashToken(used));
      assert.notEqual(stored.token_hash, used);
      const valid = await validate(used);
      assert.equal(valid.status, 200);
      assert.equal(valid.headers.get('cache-control'), 'no-store');
      assert.deepEqual(valid.body, { valid: true, identity: { name: 'Ada P.', phone: '********567' } });
      const activated = await activate(used);
      assert.equal(activated.status, 200);
      assert.equal(activated.body.user.email, null);
      assert.equal(activated.body.user.password, undefined);
      assert.deepEqual(activated.body.children.map(c => c.id), [501]);
      assert.ok(activated.body.token);
      assert.match(activated.headers.get('set-cookie'), /parent_refresh=.*HttpOnly/);
      const parent = (await db.query('SELECT * FROM users WHERE id=10')).rows[0];
      assert.equal(parent.email, null);
      assert.ok(await bcrypt.compare('SecurePassword1', parent.password));
      assert.ok(parent.activated_at);
      const audit = (await db.query('SELECT * FROM audit_logs')).rows;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, 'parent_admin_email_link_activated');
      assert.equal(audit[0].details.email_verified, false);
      assert.doesNotMatch(JSON.stringify(audit), new RegExp(`${used}|SecurePassword1`));
      const login = await request('/api/auth/login/parent', { phone_number: '0821234567', password: 'SecurePassword1' });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.email, null);
      assert.deepEqual(login.body.children.map(c => c.id), [501]);
    });

    await t.test('expired, revoked, reused and disabled links fail both validation and activation without changes', async () => {
      const revoked = await copyLink();
      const expired = await copyLink(); // revokes previous unused link
      await db.query('UPDATE parent_auth_tokens SET expires_at=NOW()-INTERVAL \'1 second\' WHERE token_hash=$1', [hashToken(expired)]);
      const disabled = await copyLink();
      const before = (await db.query('SELECT password,activated_at FROM users WHERE id=10')).rows;
      const count = (await db.query('SELECT COUNT(*) FROM parent_sessions')).rows;
      for (const raw of [used, revoked, expired, disabled]) {
        await db.query('UPDATE users SET is_active=$1 WHERE id=10', [raw !== disabled]);
        const result = await validate(raw);
        assert.equal(result.status, 400);
        assert.deepEqual(result.body, { valid: false, message: 'Invalid or expired activation link' });
        assert.equal((await activate(raw)).status, 400);
      }
      assert.deepEqual((await db.query('SELECT password,activated_at FROM users WHERE id=10')).rows, before);
      assert.deepEqual((await db.query('SELECT COUNT(*) FROM parent_sessions')).rows, count);
      assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM audit_logs')).rows[0].count, 1);
      await db.query('UPDATE users SET is_active=true WHERE id=10');
    });

    await t.test('Admin Reset Access without email revokes sessions and issues a one-use password-reset link', async () => {
      const reset = await request('/api/parent/admin/reset-password/10', {}, true);
      assert.equal(reset.status, 200);
      assert.equal(reset.body.emailed, false);
      assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM parent_sessions WHERE revoked_at IS NULL')).rows[0].count, 0);
      const raw = new URL(reset.body.resetLink).searchParams.get('token');
      const result = await request('/api/auth/reset-password', { token: raw, new_password: 'ResetPassword1' });
      assert.equal(result.status, 200);
      assert.equal((await request('/api/auth/reset-password', { token: raw, new_password: 'ResetPassword2' })).status, 400);
      const login = await request('/api/auth/login/parent', { phone_number: '0821234567', password: 'ResetPassword1' });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.email, null);
      assert.deepEqual((await db.query('SELECT * FROM parent_students')).rows, [{ parent_id: 10, student_id: 501 }]);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.pool.end();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.end();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
