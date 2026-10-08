/* Real Admin HTTP routes with synthetic accounts in an explicit disposable DB. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;
test('Admin parent contact saves allow missing email and retain account integrity', {
  skip: databaseUrl ? false : 'Requires explicit disposable FINANCE_TEST_DATABASE_URL',
  timeout: 120000,
}, async (t) => {
  const schema = `parent_contacts_${crypto.randomBytes(8).toString('hex')}`;
  const control = new Pool({ connectionString: databaseUrl, max: 1 });
  const saved = { JWT_SECRET: process.env.JWT_SECRET, FRONTEND_URL: process.env.FRONTEND_URL };
  let db;
  let server;
  const mail = [];
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
    process.env.JWT_SECRET = 'synthetic-parent-contact-test-secret';
    process.env.FRONTEND_URL = 'https://portal.example.test';
    const mailPath = require.resolve('../services/gmailService');
    require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: {
      sendEmail: async (...args) => { mail.push(args); return { success: true }; },
      escapeHtml: value => String(value),
    } };
    await db.query(`
      CREATE TABLE grades (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE users (
        id SERIAL PRIMARY KEY, email TEXT UNIQUE, password TEXT, role TEXT,
        first_name TEXT, last_name TEXT, phone_number TEXT, student_number TEXT,
        is_active BOOLEAN DEFAULT true, must_change_password BOOLEAN DEFAULT true,
        grade_id INTEGER, class_id INTEGER, invitation_sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE parent_students (parent_id INTEGER, student_id INTEGER,
        UNIQUE (parent_id, student_id));
      CREATE TABLE parent_auth_tokens (
        id SERIAL PRIMARY KEY, user_id INTEGER, token_hash TEXT, token_type TEXT,
        expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
        created_by INTEGER
      );
      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY, user_id INTEGER, user_name TEXT, user_role TEXT,
        action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER,
        details JSONB, ip_address TEXT
      );
      INSERT INTO users (id,role,first_name,last_name,phone_number,email,password)
      VALUES (1,'super_admin','Synthetic','Admin',NULL,NULL,'admin-hash'),
        (10,'parent','Synthetic','First',NULL,NULL,'first-parent-hash'),
        (11,'parent','Synthetic','Second','invalid',NULL,'second-parent-hash'),
        (12,'parent','Synthetic','Email','27821234567','existing@example.test','email-parent-hash'),
        (13,'parent','Synthetic','Legacy',NULL,'','legacy-parent-hash'),
        (501,'student','Synthetic','Learner',NULL,NULL,'learner-hash');
      SELECT setval(pg_get_serial_sequence('users','id'),600);
      INSERT INTO parent_students VALUES (10,501),(11,501),(12,501),(13,501);
    `);
    const app = express();
    app.use(express.json());
    app.use('/api/parent', require('../routes/parent'));
    server = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/parent`;
    const admin = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const request = async (path, body, method = 'PUT') => {
      const response = await fetch(`${base}${path}`, {
        method, headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const parent = async id => (await db.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
    const links = async () => (await db.query('SELECT * FROM parent_students ORDER BY parent_id,student_id')).rows;
    const auditCount = async () => (await db.query('SELECT COUNT(*)::integer AS count FROM audit_logs')).rows[0].count;

    await t.test('two missing-email parents can save corrected mobiles despite a legacy empty email', async () => {
      const beforeLinks = await links();
      for (const [id, phone, normalized] of [[10, '0731112200', '27731112200'], [11, '0731112201', '27731112201']]) {
        const before = await parent(id);
        const result = await request(`/admin/${id}`, {
          first_name: before.first_name, last_name: before.last_name, phone_number: phone,
          email: '', add_student_ids: [], remove_student_ids: [],
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const after = await parent(id);
        assert.equal(after.email, null);
        assert.equal(after.phone_number, normalized);
        assert.equal(after.password, before.password);
        assert.equal(after.must_change_password, before.must_change_password);
      }
      assert.equal((await parent(13)).email, '');
      assert.deepEqual(await links(), beforeLinks);
      assert.equal(await auditCount(), 2);
      assert.deepEqual(mail, []);
    });

    await t.test('whitespace and null emails clear safely while omitted email retains a real address', async () => {
      for (const email of ['  \t\n ', null]) {
        assert.equal((await request('/admin/10', { email })).status, 200);
        assert.equal((await parent(10)).email, null);
      }
      assert.equal((await request('/admin/12', { phone_number: '0731112202' })).status, 200);
      assert.equal((await parent(12)).email, 'existing@example.test');
    });

    await t.test('real addresses are trimmed and a true duplicate rolls back with a clear conflict', async () => {
      assert.equal((await request('/admin/10', { email: '  first@example.test  ' })).status, 200);
      assert.equal((await parent(10)).email, 'first@example.test');
      const before = await parent(11);
      const beforeLinks = await links();
      const beforeAudits = await auditCount();
      const result = await request('/admin/11', {
        phone_number: '0731112299', email: 'existing@example.test', remove_student_ids: [501],
      });
      assert.equal(result.status, 409);
      assert.equal(result.body.message, 'This email address is already used by another account.');
      assert.deepEqual(await parent(11), before);
      assert.deepEqual(await links(), beforeLinks);
      assert.equal(await auditCount(), beforeAudits);
    });

    await t.test('creating accounts with blank, whitespace, null or absent email never sends email', async () => {
      for (const [index, email] of ['', '  \t ', null, undefined].entries()) {
        const result = await request('/admin/create', {
          first_name: 'Synthetic', last_name: `New${index}`, phone_number: `073222330${index}`,
          ...(email === undefined ? {} : { email }), student_ids: [501],
        }, 'POST');
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal((await parent(result.body.parentId)).email, null);
        assert.ok(result.body.activationLink.startsWith('https://portal.example.test/parent/activate?token='));
        assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM parent_students WHERE parent_id=$1', [result.body.parentId])).rows[0].count, 1);
      }
      assert.deepEqual(mail, []);
    });

    await t.test('create with a real email still sends the invitation and duplicate create is atomic', async () => {
      const created = await request('/admin/create', {
        first_name: 'Synthetic', last_name: 'WithEmail', phone_number: '0732223340',
        email: '  new@example.test  ', student_ids: [501],
      }, 'POST');
      assert.equal(created.status, 201);
      assert.equal((await parent(created.body.parentId)).email, 'new@example.test');
      assert.equal(mail.length, 1);
      assert.equal(mail[0][0], 'new@example.test');
      const beforeLinks = await links();
      const beforeAudits = await auditCount();
      const beforeTokens = (await db.query('SELECT * FROM parent_auth_tokens ORDER BY id')).rows;
      const result = await request('/admin/create', {
        first_name: 'Synthetic', last_name: 'Duplicate', phone_number: '0732223341',
        email: 'existing@example.test', student_ids: [501],
      }, 'POST');
      assert.equal(result.status, 409);
      assert.equal((await db.query("SELECT id FROM users WHERE phone_number='27732223341'")).rows.length, 0);
      assert.deepEqual(await links(), beforeLinks);
      assert.deepEqual((await db.query('SELECT * FROM parent_auth_tokens ORDER BY id')).rows, beforeTokens);
      assert.equal(await auditCount(), beforeAudits);
      assert.equal(mail.length, 1);
    });

    await t.test('non-text email values return a validation error without altering the account', async () => {
      const before = await parent(11);
      assert.equal((await request('/admin/11', { email: {}, phone_number: '0731112299' })).status, 400);
      assert.deepEqual(await parent(11), before);
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
