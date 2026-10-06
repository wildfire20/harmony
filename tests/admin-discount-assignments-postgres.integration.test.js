/*
 * Real Admin button endpoints, database module, authentication and required
 * audit helper. Only the explicit disposable Finance test URL is used.
 * No database/auth/audit module doubles and no public-schema migrations.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;
const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

function post(server, route, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: `/api/admin${route}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Admin request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function runScenario(t) {
  const schema = `admin_discounts_${crypto.randomBytes(8).toString('hex')}`;
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  let db;
  let server;
  const oldJwtSecret = process.env.JWT_SECRET;
  try {
    await adminPool.query(`CREATE SCHEMA ${quote(schema)}`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('options', `-csearch_path=${schema}`);

    // Retain the actual exported object: no connect export is fabricated.
    // Pool options are scoped before the first connection is opened.
    db = require('../config/database');
    assert.equal(db.connect, undefined);
    assert.equal(typeof db.query, 'function');
    assert.equal(typeof db.pool.connect, 'function');
    assert.equal(db.pool.totalCount, 0);
    db.pool.options.connectionString = scoped.toString();
    db.pool.options.ssl = process.env.FINANCE_TEST_DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false } : false;
    db.pool.options.max = 1;
    db.pool.options.connectionTimeoutMillis = 10000;
    db.pool.options.query_timeout = 15000;

    await db.query(`
      CREATE TABLE grades (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, student_number VARCHAR(50), email TEXT,
        first_name TEXT, last_name TEXT, role VARCHAR(30), grade_id INTEGER,
        class_id INTEGER, is_active BOOLEAN DEFAULT true
      );
      INSERT INTO users (id,first_name,last_name,role)
      VALUES (1,'Synthetic','Administrator','super_admin'),
             (7,'Synthetic','Learner','student');
      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        user_name VARCHAR(255), user_role VARCHAR(50),
        action VARCHAR(100) NOT NULL, entity_type VARCHAR(50),
        entity_id INTEGER, details JSONB, ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const migration = fs.readFileSync('migrations/mini_phase1_finance_truth.sql', 'utf8');
    const start = migration.indexOf('CREATE TABLE IF NOT EXISTS learner_discount_assignments');
    const end = migration.indexOf('CREATE INDEX IF NOT EXISTS learner_discount_assignments_student_idx');
    assert.ok(start >= 0 && end > start);
    await db.query(migration.slice(start, end));

    process.env.JWT_SECRET = 'disposable-admin-discount-regression-secret';
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const app = express();
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const body = {
      student_id: 7, discount_type: 'custom', calculation_method: 'fixed',
      amount: 125, starts_on: '2026-10-01', reason: 'Synthetic approved assignment',
    };
    const snapshots = async () => ({
      assignments: (await db.query('SELECT * FROM learner_discount_assignments ORDER BY id')).rows,
      audits: (await db.query('SELECT * FROM audit_logs ORDER BY id')).rows,
    });
    const assertReleased = () => {
      assert.equal(db.pool.totalCount, 1);
      assert.equal(db.pool.idleCount, 1, 'transaction connection must be released');
      assert.equal(db.pool.waitingCount, 0);
    };
    let created;

    await t.test('Add approved assignment commits the assignment and required audit', async () => {
      const response = await post(server, '/discount-assignments', body, token);
      assert.equal(response.status, 201);
      assert.equal(response.body.success, true);
      created = response.body.assignment.id;
      const { assignments, audits } = await snapshots();
      assert.equal(assignments.length, 1);
      assert.equal(assignments[0].id, created);
      assert.equal(assignments[0].approved_by, 1);
      assert.equal(assignments[0].is_active, true);
      assert.equal(assignments[0].amount, '125.00');
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, 'discount_assignment_created');
      assert.equal(audits[0].entity_id, created);
      assert.equal(audits[0].user_id, 1);
      assertReleased();
    });

    await t.test('Deactivate commits inactive state and required audit', async () => {
      const response = await post(server, `/discount-assignments/${created}/deactivate`, {}, token);
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      const { assignments, audits } = await snapshots();
      assert.equal(assignments[0].is_active, false);
      assert.equal(assignments[0].deactivated_by, 1);
      assert.ok(assignments[0].deactivated_at);
      assert.equal(audits.length, 2);
      assert.equal(audits[1].action, 'discount_assignment_deactivated');
      assert.equal(audits[1].entity_id, created);
      assertReleased();
    });

    // Existing audit rows are retained; only new audit inserts are rejected.
    await db.query(`
      ALTER TABLE audit_logs ADD CONSTRAINT reject_new_discount_audits
      CHECK (action NOT IN ('discount_assignment_created','discount_assignment_deactivated'))
      NOT VALID
    `);
    await t.test('Add rolls back when the required audit INSERT fails', async () => {
      const before = await snapshots();
      const response = await post(server, '/discount-assignments', body, token);
      assert.equal(response.status, 500);
      assert.equal(response.body.success, false);
      assert.deepEqual(await snapshots(), before);
      assertReleased();
    });
    await db.query('ALTER TABLE audit_logs DROP CONSTRAINT reject_new_discount_audits');
    const second = await post(server, '/discount-assignments', body, token);
    assert.equal(second.status, 201);
    await db.query(`
      ALTER TABLE audit_logs ADD CONSTRAINT reject_new_discount_audits
      CHECK (action NOT IN ('discount_assignment_created','discount_assignment_deactivated'))
      NOT VALID
    `);
    await t.test('Deactivate rolls back state and timestamps when required audit INSERT fails', async () => {
      const before = await snapshots();
      const response = await post(server, `/discount-assignments/${second.body.assignment.id}/deactivate`, {}, token);
      assert.equal(response.status, 500);
      assert.equal(response.body.success, false);
      assert.deepEqual(await snapshots(), before);
      assertReleased();
    });
    await db.query('ALTER TABLE audit_logs DROP CONSTRAINT reject_new_discount_audits');
    await t.test('Missing active assignment returns 404 and releases the transaction connection', async () => {
      const before = await snapshots();
      const response = await post(server, `/discount-assignments/${created}/deactivate`, {}, token);
      assert.equal(response.status, 404);
      assert.deepEqual(await snapshots(), before);
      assertReleased();
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
    await adminPool.end();
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldJwtSecret;
  }
}

test('Admin discount buttons use the actual database module and atomic required audit', {
  skip: databaseUrl ? false : 'Requires explicit disposable FINANCE_TEST_DATABASE_URL',
  timeout: 120000,
}, runScenario);
