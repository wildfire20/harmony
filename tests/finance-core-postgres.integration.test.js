/*
 * Dedicated finance-core PostgreSQL release-gate suite.
 *
 * This file intentionally does not read DATABASE_URL (or any of the
 * development/production PG* variables).  The runner in
 * scripts/run-finance-core-integration.js requires FINANCE_TEST_DATABASE_URL
 * before Node's test runner is started.
 *
 * Residual browser coverage: this release gate deliberately exercises the
 * mounted Express APIs, real command services, PostgreSQL ledger, and the
 * generated Excel workbook rather than starting a browser. Browser-specific
 * rendering/accessibility remains covered by the separate frontend checks.
 *
 * The database supplied to this suite is a disposable test database.  Every
 * run uses a random schema and drops it in the finally block.  No migration
 * is run against public tables and no notification provider is called.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const { Pool } = require('pg');
const { runFinanceCoreAudit } = require('../scripts/audit-finance-core');
const { runFinanceCorePreflight } = require('../scripts/preflight-finance-core');

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;

const request = (server, method, route, body, headers = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = http.request({
    host: '127.0.0.1',
    port: server.address().port,
    path: route,
    method,
    headers: {
      ...(payload ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      } : {}),
      ...headers,
    },
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const contentType = String(res.headers['content-type'] || '');
      let parsed = buffer;
      if (contentType.includes('json') || contentType.includes('text')) {
        const text = buffer.toString('utf8');
        try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
      }
      resolve({ status: res.statusCode, headers: res.headers, body: parsed });
    });
  });
  req.once('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

function readonlyUrlForSchema(url, schema) {
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-csearch_path=${schema}`);
  return scoped.toString();
}

function runFinanceOperatorScript(scriptName, readonlyUrl) {
  const env = {
    ...process.env,
    FINANCE_READONLY_DATABASE_URL: readonlyUrl,
    FINANCE_READONLY_DATABASE_SSL: process.env.FINANCE_TEST_DATABASE_SSL || 'false',
    DATABASE_URL: 'postgresql://wrong:wrong@127.0.0.1:1/wrong_database',
    PGHOST: '127.0.0.1',
    PGPORT: '1',
    PGDATABASE: 'wrong_database',
    PGUSER: 'wrong_user',
    PGPASSWORD: 'wrong_password',
  };
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', scriptName)], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function runWithoutReadonlyUrl(scriptName) {
  const env = { ...process.env };
  delete env.FINANCE_READONLY_DATABASE_URL;
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', scriptName)], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
}

const baseSchema = `
  CREATE TABLE grades (
    id SERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE
  );
  CREATE TABLE users (
    id SERIAL PRIMARY KEY, student_number VARCHAR(50) UNIQUE, email VARCHAR(255),
    password VARCHAR(255) NOT NULL DEFAULT 'test', first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL, role VARCHAR(30) NOT NULL, grade_id INTEGER,
    class_id INTEGER, is_active BOOLEAN NOT NULL DEFAULT true,
    is_boarder BOOLEAN NOT NULL DEFAULT false, uses_transport BOOLEAN NOT NULL DEFAULT false,
    uses_aftercare BOOLEAN NOT NULL DEFAULT false, has_sibling_discount BOOLEAN NOT NULL DEFAULT false,
    has_teacher_discount BOOLEAN NOT NULL DEFAULT false, phone_number VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE parent_students (
    parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, student_id)
  );
  CREATE TABLE invoices (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    student_number VARCHAR(50), amount_due NUMERIC(12,2) NOT NULL,
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    overpaid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_date DATE, status VARCHAR(40) NOT NULL,
    carried_forward_to_invoice_id INTEGER, description TEXT,
    reference_number VARCHAR(255), created_by INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE invoice_line_items (
    id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    line_type VARCHAR(30) NOT NULL DEFAULT 'charge', service_key VARCHAR(80),
    bundle_key VARCHAR(80), label VARCHAR(255), description TEXT,
    quantity NUMERIC(12,2) DEFAULT 1, unit_amount NUMERIC(12,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL, is_included BOOLEAN NOT NULL DEFAULT false,
    discount_assignment_id INTEGER, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE learner_discount_assignments (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    discount_type VARCHAR(40) NOT NULL, calculation_method VARCHAR(30) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0, percentage NUMERIC(6,2),
    applicable_service_key VARCHAR(80), reason TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
    starts_on DATE NOT NULL, ends_on DATE
  );
  CREATE TABLE service_prices (
    id SERIAL PRIMARY KEY, service_key VARCHAR(80) NOT NULL UNIQUE, label VARCHAR(255) NOT NULL,
    description TEXT, amount NUMERIC(12,2) NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
    billing_mode VARCHAR(40) NOT NULL DEFAULT 'standalone', bundle_key VARCHAR(80),
    included_service_keys JSONB NOT NULL DEFAULT '[]'::jsonb
  );
  CREATE TABLE student_fee_assignments (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(255), amount NUMERIC(12,2) DEFAULT 0
  );
  CREATE TABLE student_one_off_fees (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(255), description TEXT, due_date DATE, is_active BOOLEAN DEFAULT true
  );
  CREATE TABLE pending_payments (
    id SERIAL PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES users(id),
    student_id INTEGER NOT NULL REFERENCES users(id), amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL, reference VARCHAR(255), notes TEXT,
    receipt_file_name VARCHAR(255), receipt_file_path VARCHAR(500),
    receipt_s3_key VARCHAR(500), receipt_s3_url VARCHAR(1000), receipt_mime_type VARCHAR(100),
    receipt_data BYTEA, selected_obligations JSONB, status VARCHAR(30) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, payment_date DATE,
    reviewed_by INTEGER, reviewed_at TIMESTAMP, admin_note TEXT
  );
  CREATE TABLE payment_transactions (
    id SERIAL PRIMARY KEY, invoice_id INTEGER REFERENCES invoices(id),
    student_id INTEGER NOT NULL REFERENCES users(id), student_number VARCHAR(50),
    reference_number VARCHAR(255), reference VARCHAR(255), reverses_transaction_id INTEGER,
    amount NUMERIC(12,2) NOT NULL, transaction_date DATE NOT NULL, payment_date DATE,
    description TEXT, payment_method VARCHAR(50), recorded_by INTEGER,
    month INTEGER, year INTEGER, allocation_category VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (reverses_transaction_id)
  );
  CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY, user_id INTEGER, user_name VARCHAR(255), user_role VARCHAR(50),
    action VARCHAR(120) NOT NULL, entity_type VARCHAR(80), entity_id INTEGER,
    details JSONB, ip_address VARCHAR(100), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const seedPrices = `
  INSERT INTO service_prices
    (service_key, label, description, amount, display_order, billing_mode, included_service_keys)
  VALUES
    ('tuition', 'Tuition', 'Monthly tuition', 2350, 1, 'standalone', '[]'),
    ('boarding', 'Boarding', 'Monthly boarding', 1600, 2, 'standalone', '[]'),
    ('transport', 'Transport', 'Monthly transport', 650, 3, 'standalone', '[]'),
    ('aftercare', 'Aftercare', 'Monthly aftercare', 550, 4, 'standalone', '[]');
`;

async function installBaseFinanceDatabase(pool, schema) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    await client.query(baseSchema);
    await client.query(seedPrices);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyFinanceCoreMigration(pool, schema) {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'finance_core_architecture.sql'), 'utf8',
  );
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    await client.query(migration);
  } finally {
    client.release();
  }
}

async function applyFinanceOperationsReadinessMigration(pool, schema) {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'finance_operations_readiness_v3.sql'), 'utf8',
  );
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    await client.query(migration);
  } finally {
    client.release();
  }
}

function scopedDatabase(pool, schema) {
  const connect = async () => {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    return client;
  };
  return {
    pool: { connect },
    query: async (sql, params) => {
      const client = await connect();
      try { return await client.query(sql, params); } finally { client.release(); }
    },
  };
}

async function runSuite() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 12,
    ssl: process.env.FINANCE_TEST_DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false } : false,
  });
  const schema = `finance_gate_${crypto.randomBytes(10).toString('hex')}`;
  let server;
  let database;
  const modulePaths = [];
  try {
    await pool.query('SELECT 1');
    await installBaseFinanceDatabase(pool, schema);
    database = scopedDatabase(pool, schema);
    const operatorUrl = readonlyUrlForSchema(databaseUrl, schema);

    const missingUrl = runWithoutReadonlyUrl('preflight-finance-core.js');
    assert.notEqual(missingUrl.status, 0);
    assert.match(
      missingUrl.stderr,
      /FINANCE_READONLY_DATABASE_URL is required; refusing to infer a database/,
    );

    const operatorPreMigration = runFinanceOperatorScript(
      'preflight-finance-core.js',
      operatorUrl,
    );
    assert.equal(
      operatorPreMigration.status,
      0,
      `${operatorPreMigration.stdout}\n${operatorPreMigration.stderr}`,
    );
    assert.match(operatorPreMigration.stdout, new RegExp(`schema: ${schema}`));
    assert.match(operatorPreMigration.stdout, /transaction_read_only: on/);
    assert.match(operatorPreMigration.stdout, /"ok": true/);

    const preMigrationClient = await database.pool.connect();
    try {
      await preMigrationClient.query('BEGIN READ ONLY');
      const preMigration = await runFinanceCorePreflight(preMigrationClient);
      assert.equal(preMigration.ok, true, JSON.stringify(preMigration.blockers));
      assert.ok(preMigration.checks.targetTables.absent.includes('service_enrollments'));
      assert.deepEqual(preMigration.checks.canonicalMonthlyDuplicates, []);
      await preMigrationClient.query('SELECT 1 AS transaction_still_usable');
      await preMigrationClient.query('ROLLBACK');
    } finally {
      preMigrationClient.release();
    }

    await database.query('CREATE TABLE invoices_canonical_monthly_identity_idx (id integer)');
    const blockerClient = await database.pool.connect();
    try {
      await blockerClient.query('BEGIN READ ONLY');
      const blockedPreMigration = await runFinanceCorePreflight(blockerClient);
      assert.equal(blockedPreMigration.ok, false);
      assert.ok(blockedPreMigration.blockers.some(
        (blocker) => blocker.code === 'conflicting_schema_object',
      ));
      await blockerClient.query('ROLLBACK');
    } finally {
      blockerClient.release();
    }
    await database.query('DROP TABLE invoices_canonical_monthly_identity_idx');

    const strictAuditClient = await database.pool.connect();
    try {
      await strictAuditClient.query('BEGIN READ ONLY');
      const preMigrationAudit = await runFinanceCoreAudit(strictAuditClient, {
        currentPeriod: '2029-01',
      });
      assert.equal(preMigrationAudit.ok, false);
      assert.ok(preMigrationAudit.findings.some(
        (finding) => finding.code === 'missing_table',
      ));
      assert.ok(preMigrationAudit.findings.some(
        (finding) => finding.section === 'schema_version' && finding.code === 'missing_schema',
      ));
      await strictAuditClient.query('SELECT 1 AS transaction_recovered_after_optional_error');
      await strictAuditClient.query('ROLLBACK');
    } finally {
      strictAuditClient.release();
    }

    await applyFinanceCoreMigration(pool, schema);
    await applyFinanceOperationsReadinessMigration(pool, schema);
    const readinessVersion = (await pool.query(`
      SELECT version FROM ${quoteIdentifier(schema)}.finance_schema_versions
      WHERE schema_key = 'finance_operations_readiness'
    `)).rows[0];
    assert.equal(readinessVersion.version, 3);
    const architectureVersion = (await pool.query(`
      SELECT version FROM ${quoteIdentifier(schema)}.finance_schema_versions
      WHERE schema_key = 'finance_core_architecture'
    `)).rows[0];
    assert.equal(architectureVersion.version, 3);

    for (const scriptName of ['audit-finance-core.js', 'preflight-finance-core.js']) {
      const operatorPostMigration = runFinanceOperatorScript(scriptName, operatorUrl);
      assert.equal(
        operatorPostMigration.status,
        0,
        `${operatorPostMigration.stdout}\n${operatorPostMigration.stderr}`,
      );
      assert.match(operatorPostMigration.stdout, new RegExp(`schema: ${schema}`));
      assert.match(operatorPostMigration.stdout, /transaction_read_only: on/);
      assert.match(operatorPostMigration.stdout, /"ok": true/);
    }

    // Make every production service used by the mounted routes point at the
    // disposable schema.  This cache substitution is test-only and is undone
    // before the process exits.
    const databasePath = require.resolve('../config/database');
    const authPath = require.resolve('../middleware/auth');
    const notificationsPath = require.resolve('../services/parentNotificationService');
    const originalModules = new Map();
    [databasePath, authPath, notificationsPath].forEach((modulePath) => {
      originalModules.set(modulePath, require.cache[modulePath]);
    });
    require.cache[databasePath] = {
      id: databasePath, filename: databasePath, loaded: true, exports: database,
    };
    require(authPath);
    require.cache[authPath].exports = {
      authenticate: (req, _res, next) => {
        const isParent = req.headers['x-test-role'] === 'parent';
        req.user = isParent
          ? { id: 2, role: 'parent', first_name: 'Test', last_name: 'Parent' }
          : { id: 1, role: 'admin', first_name: 'Test', last_name: 'Admin' };
        next();
      },
      authorize: () => (_req, _res, next) => next(),
    };
    require(notificationsPath);
    require.cache[notificationsPath].exports = {
      notifyInvoice: async () => ({ sent: false, suppressed: true }),
      notifyPayment: async () => ({ sent: false, suppressed: true }),
    };

    const routes = [
      '../routes/invoices',
      '../routes/paymentProofs',
      '../routes/enhanced-invoices',
    ];
    routes.forEach((route) => {
      const routePath = require.resolve(route);
      modulePaths.push(routePath);
      delete require.cache[routePath];
    });
    const financeCommandPath = require.resolve('../services/financeCommandService');
    const ledgerPath = require.resolve('../services/financeLedger');
    const payablePath = require.resolve('../services/payableObligations');
    const enrollmentPath = require.resolve('../services/serviceEnrollmentRepository');
    [financeCommandPath, ledgerPath, payablePath, enrollmentPath].forEach((modulePath) => {
      modulePaths.push(modulePath);
      delete require.cache[modulePath];
    });
    const financeCommands = require('../services/financeCommandService');
    const financeLedger = require('../services/financeLedger');
    const payable = require('../services/payableObligations');
    const enrollmentRepository = require('../services/serviceEnrollmentRepository');

    await database.query(`
      INSERT INTO grades (name) VALUES ('Grade 2');
      INSERT INTO users (id, student_number, email, first_name, last_name, role, grade_id)
      VALUES
        (1, NULL, 'admin@finance-gate.test', 'Test', 'Admin', 'admin', 1),
        (2, NULL, 'parent@finance-gate.test', 'Test', 'Parent', 'parent', 1),
        (4, NULL, 'second-parent@finance-gate.test', 'Second', 'Parent', 'parent', 1),
        (3, 'FIN-GATE-001', 'learner@finance-gate.test', 'Finance', 'Learner', 'student', 1);
      INSERT INTO users
        (id, student_number, email, first_name, last_name, role, grade_id, is_active)
      VALUES
        (90, 'FIN-GATE-OVERLAP', 'overlap@finance-gate.test',
         'Overlap', 'Learner', 'student', 1, false);
      INSERT INTO parent_students (parent_id, student_id) VALUES (2, 3), (4, 3);
      INSERT INTO learner_discount_assignments
        (student_id, discount_type, calculation_method, amount,
         applicable_service_key, reason, starts_on)
      VALUES
        (3, 'sibling', 'fixed', 100, 'tuition',
         'Approved sibling gate discount', '2029-01-01');
    `);
    await database.query(`
      INSERT INTO service_enrollments
        (student_id, service_key, effective_start, effective_end, state, idempotency_key)
      VALUES (90, 'tuition', '2028-01-01', '2028-12-31', 'ended', 'db-ended-baseline')
    `);
    await assert.rejects(
      database.query(`
        INSERT INTO service_enrollments
          (student_id, service_key, effective_start, effective_end, state, idempotency_key)
        VALUES (90, 'tuition', '2028-06-01', '2029-01-31', 'active', 'db-ended-active-overlap')
      `),
      /overlap/i,
    );
    await assert.rejects(
      database.query(`
        INSERT INTO service_enrollments
          (student_id, service_key, effective_start, effective_end, state, idempotency_key)
        VALUES (90, 'tuition', '2028-06-01', '2028-09-30', 'ended', 'db-ended-ended-overlap')
      `),
      /overlap/i,
    );
    await database.query('DELETE FROM service_enrollments WHERE student_id=90');

    const app = express();
    app.use(express.json());
    app.use('/api/invoices', require('../routes/invoices'));
    app.use('/api/payment-proofs', require('../routes/paymentProofs'));
    app.use('/api/reports', require('../routes/enhanced-invoices'));
    // This small mounted endpoint makes the service-only enrollment read/write
    // path observable over HTTP without inventing a second finance algorithm.
    app.get('/api/finance/:studentId/:period', async (req, res) => {
      try {
        res.json(await enrollmentRepository.listEffectiveEnrollments(
          req.params.studentId, req.params.period, database,
        ));
      } catch (error) {
        res.status(400).json({ message: error.message });
      }
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const enrollments = await Promise.all([
      ['tuition', '2029-01-01', 'gate-tuition'],
      ['boarding', '2029-01-01', 'gate-boarding'],
      ['transport', '2029-01-01', 'gate-transport'],
      ['aftercare', '2029-01-01', 'gate-aftercare'],
    ].map(([serviceKey, effectiveStart, idempotencyKey]) =>
      enrollmentRepository.createEnrollment({
        studentId: 3, serviceKey, effectiveStart, idempotencyKey,
      }, database)));
    assert.deepEqual(enrollments.map((row) => row.service_key), [
      'tuition', 'boarding', 'transport', 'aftercare',
    ]);
    const enrollmentResponse = await request(server, 'GET', '/api/finance/3/2029-01');
    assert.equal(enrollmentResponse.status, 200);
    assert.deepEqual(enrollmentResponse.body.map((row) => row.service_key), [
      'aftercare', 'boarding', 'transport', 'tuition',
    ]);
    assert.deepEqual(enrollmentResponse.body.map((row) => row.effective_start), [
      '2029-01-01', '2029-01-01', '2029-01-01', '2029-01-01',
    ]);
    assert.deepEqual(enrollmentResponse.body.map((row) => row.effective_end), [
      null, null, null, null,
    ]);
    // Ended rows remain historical billing evidence through their inclusive
    // effective_end, while cancelled rows are the only non-effective state.
    const endedHistorical = await enrollmentRepository.createEnrollment({
      studentId: 3,
      serviceKey: 'transport',
      effectiveStart: '2028-10-01',
      effectiveEnd: '2028-12-31',
      state: 'ended',
      idempotencyKey: 'gate-transport-ended',
    }, database);
    assert.equal(endedHistorical.state, 'ended');
    const endedPeriod = await enrollmentRepository.listEffectiveEnrollments(
      3, '2028-12', database,
    );
    assert.ok(endedPeriod.some((row) =>
      row.id === endedHistorical.id && row.effective_end === '2028-12-31'));
    await assert.rejects(
      enrollmentRepository.createEnrollment({
        studentId: 3,
        serviceKey: 'transport',
        effectiveStart: '2028-12-15',
        effectiveEnd: '2029-01-10',
        idempotencyKey: 'gate-transport-overlap-ended',
      }, database),
      /overlaps/i,
    );

    const generated = await request(
      server, 'POST', '/api/invoices/generate-monthly',
      { month: 1, year: 2029 }, { 'x-test-role': 'admin' },
    );
    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    assert.equal(generated.body.summary.invoicesCreated, 1);
    const monthlyInvoice = generated.body.invoices[0];
    const monthlyMetadata = (await database.query(`
      SELECT billing_period::text AS billing_period,
             invoice_kind, invoice_source, finance_origin
      FROM invoices WHERE id=$1
    `, [monthlyInvoice.id])).rows[0];
    assert.equal(monthlyMetadata.billing_period, '2029-01-01');
    assert.equal(monthlyInvoice.billing_period, '2029-01-01');
    assert.equal(monthlyMetadata.invoice_kind, 'monthly');
    assert.equal(monthlyMetadata.invoice_source, 'monthly_generation');
    assert.equal(monthlyMetadata.finance_origin, 'canonical');
    const monthlyLines = await database.query(`
      SELECT id, service_key, line_type, amount, is_included, metadata
      FROM invoice_line_items WHERE invoice_id=$1 ORDER BY id
    `, [monthlyInvoice.id]);
    assert.deepEqual(monthlyLines.rows.map((row) => [row.service_key, row.line_type, Number(row.amount)]), [
      ['tuition', 'charge', 2350],
      ['boarding', 'charge', 1600],
      ['transport', 'charge', 650],
      ['aftercare', 'charge', 550],
      ['tuition', 'discount', 100],
    ]);
    assert.equal(Number(monthlyInvoice.amount_due), 5050);
    // Isolated A-E fixture: exercise each service/bundle/discount combination
    // in one synthetic month while keeping the original release-gate learner
    // above as the persisted multi-service baseline.
    await database.query(`
      UPDATE service_prices
      SET billing_mode='bundle_component', bundle_key='boarding-package'
      WHERE service_key IN ('tuition', 'aftercare');
      UPDATE service_prices
      SET billing_mode='bundle', bundle_key='boarding-package',
          amount=1600, included_service_keys='["tuition","aftercare"]'::jsonb
      WHERE service_key='boarding';
      INSERT INTO users
        (id, student_number, email, first_name, last_name, role, grade_id)
      VALUES
        (10, 'FIN-GATE-A', 'a@finance-gate.test', 'A', 'Tuition', 'student', 1),
        (11, 'FIN-GATE-B', 'b@finance-gate.test', 'B', 'Transport', 'student', 1),
        (12, 'FIN-GATE-C', 'c@finance-gate.test', 'C', 'Boarding', 'student', 1),
        (13, 'FIN-GATE-D', 'd@finance-gate.test', 'D', 'Sibling', 'student', 1),
        (14, 'FIN-GATE-E', 'e@finance-gate.test', 'E', 'Service Discount', 'student', 1);
      INSERT INTO service_enrollments
        (student_id, service_key, effective_start, idempotency_key)
      VALUES
        (10, 'tuition', '2029-02-01', 'synthetic-a-tuition'),
        (11, 'tuition', '2029-02-01', 'synthetic-b-tuition'),
        (11, 'transport', '2029-02-01', 'synthetic-b-transport'),
        (12, 'boarding', '2029-02-01', 'synthetic-c-boarding'),
        (12, 'tuition', '2029-02-01', 'synthetic-c-tuition'),
        (12, 'aftercare', '2029-02-01', 'synthetic-c-aftercare'),
        (12, 'transport', '2029-02-01', 'synthetic-c-transport'),
        (13, 'tuition', '2029-02-01', 'synthetic-d-tuition'),
        (14, 'tuition', '2029-02-01', 'synthetic-e-tuition'),
        (14, 'transport', '2029-02-01', 'synthetic-e-transport');
      INSERT INTO learner_discount_assignments
        (student_id, discount_type, calculation_method, amount,
         applicable_service_key, reason, starts_on)
      VALUES
        (13, 'sibling', 'fixed', 100, 'tuition', 'Synthetic sibling', '2029-02-01'),
        (14, 'custom', 'fixed', 75, 'transport', 'Synthetic transport service discount', '2029-02-01');
    `);
    const synthetic = await financeCommands.generateMonthlyInvoices({
      month: 2, year: 2029, idempotencyKey: 'synthetic-a-to-e-2029-02',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    const syntheticInvoices = (await database.query(`
      SELECT id, student_id, amount_due, billing_period::text AS billing_period,
             invoice_kind, invoice_source, finance_origin
      FROM invoices
      WHERE id = ANY($1::integer[])
      ORDER BY student_id
    `, [synthetic.invoices.map((invoice) => invoice.id)])).rows
      .filter((invoice) => Number(invoice.student_id) >= 10);
    assert.equal(syntheticInvoices.length, 5);
    assert.ok(syntheticInvoices.every((invoice) =>
      invoice.billing_period === '2029-02-01' &&
      invoice.invoice_kind === 'monthly' &&
      invoice.invoice_source === 'monthly_generation' &&
      invoice.finance_origin === 'canonical'));
    assert.deepEqual(syntheticInvoices.map((invoice) => [
      Number(invoice.student_id), Number(invoice.amount_due),
    ]), [
      [10, 2350], [11, 3000], [12, 2250], [13, 2250], [14, 2925],
    ]);
    const syntheticLines = (await database.query(`
      SELECT i.student_id, l.service_key, l.line_type, l.amount, l.is_included,
             l.metadata
      FROM invoices i
      JOIN invoice_line_items l ON l.invoice_id=i.id
      WHERE i.id = ANY($1::integer[])
      ORDER BY i.student_id, l.id
    `, [syntheticInvoices.map((invoice) => invoice.id)])).rows;
    const cLines = syntheticLines.filter((line) => Number(line.student_id) === 12);
    assert.deepEqual(cLines.map((line) => [
      line.service_key, line.line_type, Number(line.amount), line.is_included,
    ]), [
      ['boarding', 'charge', 1600, false],
      ['tuition', 'charge', 0, true],
      ['aftercare', 'charge', 0, true],
      ['transport', 'charge', 650, false],
    ]);
    assert.equal(syntheticLines.filter((line) =>
      Number(line.student_id) === 13 && line.line_type === 'discount').length, 1);
    assert.equal(syntheticLines.filter((line) =>
      Number(line.student_id) === 14 && line.line_type === 'discount' &&
      line.service_key === 'transport').length, 1);
    const syntheticExport = await request(
      server, 'GET', '/api/reports/student-payment-history/FIN-GATE-C?format=excel',
      undefined, { 'x-test-role': 'admin' },
    );
    assert.equal(syntheticExport.status, 200);
    const syntheticWorkbook = new (require('exceljs').Workbook)();
    await syntheticWorkbook.xlsx.load(syntheticExport.body);
    const syntheticExportText = JSON.stringify(
      syntheticWorkbook.getWorksheet('Invoice Breakdown').getSheetValues(),
    );
    assert.match(syntheticExportText, /Boarding/);
    assert.match(syntheticExportText, /Transport/);
    assert.match(syntheticExportText, /Included/);
    // The command-level preflight is authoritative even when the HTTP UX
    // preflight is bypassed: ending tuition after January preserves the
    // historical January service while making February atomic-fail before any
    // invoice write.
    await database.query(`
      UPDATE service_enrollments
      SET state='ended', effective_end='2029-01-31', updated_at=CURRENT_TIMESTAMP
      WHERE student_id=3 AND service_key='tuition' AND effective_start='2029-01-01'
    `);
    await assert.rejects(
      financeCommands.generateMonthlyInvoices({
        month: 2, year: 2029, idempotencyKey: 'command-readiness-block-2029-02',
        actor: { id: 1, name: 'Test Admin', role: 'admin' },
      }),
      (error) => error.status === 409 && /not ready/i.test(error.message),
    );
    await database.query(`
      UPDATE service_enrollments
      SET state='active', effective_end=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE student_id=3 AND service_key='tuition' AND effective_start='2029-01-01'
    `);
    await assert.rejects(
      database.query(`
        INSERT INTO invoices
          (student_id, student_number, amount_due, due_date, billing_period,
           invoice_kind, invoice_source, finance_origin, status, reference_number)
        VALUES (3, 'FIN-GATE-001', 1, '2029-01-31', '2029-01-01',
                'monthly', 'monthly_generation', 'canonical', 'Unpaid', 'DUPLICATE')
      `),
      /duplicate key|unique/i,
    );
    await assert.rejects(
      database.query(`UPDATE invoices SET status='Partial' WHERE id=$1`, [monthlyInvoice.id]),
      /canonical finance command transaction|projection is protected/i,
    );
    const projectionClient = await database.pool.connect();
    try {
      await projectionClient.query('BEGIN');
      await projectionClient.query(
        `SELECT set_config('harmony.finance_command', 'canonical', true)`,
      );
      await projectionClient.query(
        `UPDATE invoices SET status='Unpaid' WHERE id=$1`,
        [monthlyInvoice.id],
      );
      await projectionClient.query('ROLLBACK');
    } finally {
      projectionClient.release();
    }
    await assert.rejects(
      database.query(
        `UPDATE invoice_line_items SET amount=amount+1 WHERE id=$1`,
        [monthlyLines.rows[0].id],
      ),
      /immutable/i,
    );
    const legacyInvoice = (await database.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, due_date, status, reference_number)
      VALUES (3, 'FIN-GATE-001', 10, '2020-01-31', 'Unpaid', 'LEGACY-CORRECTION-GATE')
      RETURNING id
    `)).rows[0];
    const legacyLine = (await database.query(`
      INSERT INTO invoice_line_items
        (invoice_id, line_type, service_key, label, unit_amount, amount, metadata)
      VALUES ($1, 'charge', 'tuition', 'Legacy tuition', 10, 10,
        '{"source":"legacy_invoice_reconciliation","category":"tuition"}'::jsonb)
      RETURNING id
    `, [legacyInvoice.id])).rows[0];
    await database.query(`
      INSERT INTO invoice_line_items
        (invoice_id, line_type, service_key, label, unit_amount, amount, is_included, metadata)
      VALUES ($1, 'charge', 'boarding', 'Corrected legacy classification', 0, 0, true,
        jsonb_build_object(
          'source', 'legacy_classification_correction',
          'target_line_id', $2::text,
          'previous_category', 'tuition',
          'new_category', 'boarding'
        ))
    `, [legacyInvoice.id, legacyLine.id]);

    const oneOffInvoice = (await database.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, due_date, status, reference_number, description)
      VALUES (3, 'FIN-GATE-001', 300, '2029-01-31', 'Unpaid', 'ONEOFF-GATE', 'Activity fee')
      RETURNING id
    `)).rows[0];
    const oneOffLine = (await database.query(`
      INSERT INTO invoice_line_items
        (invoice_id, line_type, service_key, label, description, unit_amount, amount, metadata)
      VALUES ($1, 'charge', 'one_off_fee', 'Activity fee', 'January activity fee', 300, 300,
        '{"category":"one_off","fee_id":77}'::jsonb)
      RETURNING id
    `, [oneOffInvoice.id])).rows[0];

    const initialPayables = await payable.getPayableObligations(3, database, { asOf: '2029-01-15' });
    const originalScenarioInvoiceIds = new Set([
      Number(monthlyInvoice.id), Number(legacyInvoice.id), Number(oneOffInvoice.id),
    ]);
    const originalScenarioPayables = initialPayables.filter((row) =>
      row.is_payable && originalScenarioInvoiceIds.has(Number(row.invoice_id)));
    assert.deepEqual(originalScenarioPayables.map((row) => row.category), [
      'boarding', 'tuition', 'boarding', 'transport', 'aftercare', 'one_off',
    ]);
    assert.equal(originalScenarioPayables.length, 6);
    const tuition = originalScenarioPayables.find((row) => row.category === 'tuition');
    const oneOff = originalScenarioPayables.find((row) => row.category === 'one_off');
    const mixedAmount = Number(tuition.amount_outstanding) + Number(oneOff.amount_outstanding);
    const selection = [
      {
        obligation_id: tuition.obligation_id, invoice_id: tuition.invoice_id,
        invoice_line_item_id: tuition.invoice_line_item_id, category: 'tuition',
        amount: Number(tuition.amount_outstanding),
      },
      {
        obligation_id: oneOff.obligation_id, invoice_id: oneOff.invoice_id,
        invoice_line_item_id: oneOff.invoice_line_item_id, category: 'one_off',
        amount: Number(oneOff.amount_outstanding),
      },
    ];

    const submission = await request(server, 'POST', '/api/payment-proofs', {
      amount: mixedAmount, payment_method: 'eft', reference: 'MIXED-GATE-001',
      child_id: 3, obligations: selection,
    }, { 'x-test-role': 'parent', 'Idempotency-Key': 'mixed-gate-001' });
    assert.equal(submission.status, 201, JSON.stringify(submission.body));
    const duplicate = await request(server, 'POST', '/api/payment-proofs', {
      amount: mixedAmount, payment_method: 'eft', reference: 'MIXED-GATE-001',
      child_id: 3, obligations: selection,
    }, { 'x-test-role': 'parent', 'Idempotency-Key': 'mixed-gate-001' });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    const proofId = submission.body.submission.id;

    const options = await request(
      server, 'GET', `/api/payment-proofs/${proofId}/allocation-options`, undefined,
      { 'x-test-role': 'admin' },
    );
    assert.equal(options.status, 200);
    assert.deepEqual(
      options.body.options.filter((row) => row.category === 'tuition' || row.category === 'one_off')
        .map((row) => [row.invoice_id, row.invoice_line_item_id, row.category]),
      selection.map((row) => [row.invoice_id, row.invoice_line_item_id, row.category]),
    );

    const proposals = await database.query(`
      SELECT proof_id, learner_id, invoice_id, invoice_line_item_id, category, proposed_amount
      FROM payment_proof_allocation_proposals WHERE proof_id=$1 ORDER BY id
    `, [proofId]);
    assert.deepEqual(proposals.rows.map((row) => [
      Number(row.proof_id), Number(row.learner_id), Number(row.invoice_id),
      Number(row.invoice_line_item_id), row.category, Number(row.proposed_amount),
    ]), selection.map((row) => [
      proofId, 3, row.invoice_id, row.invoice_line_item_id, row.category, row.amount,
    ]));

    const approval = await request(
      server, 'POST', `/api/payment-proofs/${proofId}/approve`,
      { admin_note: 'Exact identities verified' }, { 'x-test-role': 'admin' },
    );
    assert.equal(approval.status, 200, JSON.stringify(approval.body));
    assert.equal(approval.body.transaction_ids.length, 2);
    const adminAfterApproval = await request(
      server, 'GET', `/api/payment-proofs/${proofId}/allocation-options`,
      undefined, { 'x-test-role': 'admin' },
    );
    assert.equal(adminAfterApproval.status, 200);
    assert.deepEqual(
      adminAfterApproval.body.options.filter((row) => row.category === 'tuition' || row.category === 'one_off'),
      [],
    );
    const allocations = await database.query(`
      SELECT invoice_id, amount, allocation_category
      FROM payment_transactions WHERE id=ANY($1::integer[]) ORDER BY id
    `, [approval.body.transaction_ids]);
    assert.deepEqual(allocations.rows.map((row) => [
      Number(row.invoice_id), Number(row.amount), row.allocation_category,
    ]), selection.map((row) => [row.invoice_id, row.amount, row.category]));
    await assert.rejects(
      database.query(
        `UPDATE payment_transactions SET description='tampered' WHERE id=$1`,
        [approval.body.transaction_ids[0]],
      ),
      /immutable|append a reversal/i,
    );
    const normalized = await database.query(`
      SELECT proof_id, resolution_state, allocated_amount
      FROM payment_proof_allocations WHERE proof_id=$1 ORDER BY id
    `, [proofId]);
    assert.equal(normalized.rows.length, 2);
    assert.ok(normalized.rows.every((row) => row.resolution_state === 'accepted'));

    const afterApproval = await payable.getPayableObligations(3, database, { asOf: '2029-01-15' });
    assert.equal(afterApproval.find((row) => row.obligation_id === tuition.obligation_id).status, 'PAID');
    assert.equal(afterApproval.find((row) => row.obligation_id === oneOff.obligation_id).status, 'PAID');
    assert.equal(afterApproval.filter((row) =>
      row.is_payable && originalScenarioInvoiceIds.has(Number(row.invoice_id))).length, 4);
    const ledgerResponse = await request(
      server, 'GET', '/api/reports/student-payment-history/FIN-GATE-001',
      undefined, { 'x-test-role': 'admin' },
    );
    assert.equal(ledgerResponse.status, 200);
    assert.equal(Number(ledgerResponse.body.summary.totalPaid), mixedAmount);
    const expectedOutstanding = (await database.query(`
      SELECT COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) AS total
      FROM invoices
      WHERE student_id=3 AND status <> 'Carried Forward'
    `)).rows[0].total;
    assert.equal(
      Number(ledgerResponse.body.summary.totalOutstanding),
      Number(expectedOutstanding),
    );

    const workbookResponse = await request(
      server, 'GET', '/api/reports/student-payment-history/FIN-GATE-001?format=excel',
      undefined, { 'x-test-role': 'admin' },
    );
    assert.equal(workbookResponse.status, 200);
    assert.ok(Buffer.isBuffer(workbookResponse.body));
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookResponse.body);
    assert.ok(workbook.getWorksheet('Monthly School Account'));
    assert.ok(workbook.getWorksheet('One-Off Fees'));
    const exportedBreakdown = [];
    workbook.getWorksheet('Invoice Breakdown').eachRow((row) => {
      exportedBreakdown.push(row.values);
    });
    const exportedText = JSON.stringify(exportedBreakdown);
    assert.match(exportedText, /Tuition/);
    assert.match(exportedText, /Boarding/);
    assert.match(exportedText, /Transport/);
    assert.match(exportedText, /Aftercare/);
    assert.match(exportedText, /Sibling discount/);

    const reversal = await financeCommands.reversePayment({
      transactionId: approval.body.transaction_ids[0],
      idempotencyKey: 'reverse-mixed-gate-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    assert.ok(reversal.reversalId);
    const restored = await payable.getPayableObligations(3, database, { asOf: '2029-01-15' });
    assert.equal(restored.find((row) => row.obligation_id === tuition.obligation_id).status, 'UNPAID');
    assert.equal(restored.find((row) => row.obligation_id === oneOff.obligation_id).status, 'PAID');
    const repeatedReversal = await financeCommands.reversePayment({
      transactionId: approval.body.transaction_ids[0],
      idempotencyKey: 'reverse-mixed-gate-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    assert.equal(repeatedReversal.alreadyReversed, true);

    // Two different Parent accounts may submit the same exact obligation, but
    // only one competing proof can commit after the invoice lock is held.
    const aftercare = restored.find((row) => row.category === 'aftercare');
    const competingProofs = await Promise.all([
      financeCommands.createPaymentProof({
        parentId: 2, learnerId: 3, amount: aftercare.amount_outstanding,
        paymentMethod: 'eft', reference: 'COMPETING-A',
        obligations: [{
          invoice_id: aftercare.invoice_id,
          invoice_line_item_id: aftercare.invoice_line_item_id,
          category: 'aftercare', amount: aftercare.amount_outstanding,
        }],
        actor: { id: 2, name: 'Test Parent', role: 'parent' },
        idempotencyKey: 'competing-proof-a-001',
      }),
      financeCommands.createPaymentProof({
        parentId: 4, learnerId: 3, amount: aftercare.amount_outstanding,
        paymentMethod: 'eft', reference: 'COMPETING-B',
        obligations: [{
          invoice_id: aftercare.invoice_id,
          invoice_line_item_id: aftercare.invoice_line_item_id,
          category: 'aftercare', amount: aftercare.amount_outstanding,
        }],
        actor: { id: 4, name: 'Second Parent', role: 'parent' },
        idempotencyKey: 'competing-proof-b-001',
      }),
    ]);
    const competition = await Promise.allSettled(competingProofs.map((proof) =>
      financeCommands.approveProof({
        proofId: proof.submission.id,
        actor: { id: 1, name: 'Test Admin', role: 'admin' },
      })));
    assert.equal(competition.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(competition.filter((result) => result.status === 'rejected').length, 1);

    const transport = restored.find((row) => row.category === 'transport');
    const manualOne = await financeCommands.recordPayment({
      studentId: 3, amount: 100, paymentDate: '2029-01-15',
      paymentMethod: 'manual_entry', reference: 'MANUAL-GATE-001',
      obligations: [{
        invoice_id: transport.invoice_id, invoice_line_item_id: transport.invoice_line_item_id,
        category: 'transport', amount: 100,
      }],
      idempotencyKey: 'manual-gate-idempotency-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    const manualTwo = await financeCommands.recordPayment({
      studentId: 3, amount: 100, paymentDate: '2029-01-15',
      paymentMethod: 'manual_entry', reference: 'MANUAL-GATE-001',
      obligations: [{
        invoice_id: transport.invoice_id, invoice_line_item_id: transport.invoice_line_item_id,
        category: 'transport', amount: 100,
      }],
      idempotencyKey: 'manual-gate-idempotency-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    assert.equal(manualOne.transactionIds.length, 1);
    assert.equal(manualTwo.idempotent, true);

    // A correction reverses the immutable manual event and records its
    // replacement against a different exact category.
    const boarding = restored.find((row) =>
      row.category === 'boarding' && Number(row.invoice_id) === Number(monthlyInvoice.id));
    const correction = await financeCommands.correctPayment({
      transactionId: manualOne.transactionIds[0], studentId: 3, amount: 100,
      paymentDate: '2029-01-15', paymentMethod: 'manual_entry',
      obligations: [{
        invoice_id: boarding.invoice_id,
        invoice_line_item_id: boarding.invoice_line_item_id,
        category: 'boarding', amount: 100,
      }],
      matchedInvoiceId: boarding.invoice_id,
      reference: 'CORRECTED-MANUAL-GATE-001',
      idempotencyKey: 'correction-gate-key-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    assert.ok(correction.reversal.reversalId);
    assert.ok(correction.allocation.allocations.some((row) => row.invoiceId === boarding.invoice_id));

    // Bank imports use the same command and idempotency authority as manual
    // payments; retrying an import cannot create a second ledger event.
    const bankImport = await financeCommands.recordPayment({
      studentId: 3, amount: 50, paymentDate: '2029-01-16',
      paymentMethod: 'bank_transfer', reference: 'BANK-GATE-001',
      action: 'bank_import_payment',
      obligations: [{
        invoice_id: transport.invoice_id,
        invoice_line_item_id: transport.invoice_line_item_id,
        category: 'transport', amount: 50,
      }],
      idempotencyKey: 'bank-import-gate-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    const duplicateBankImport = await financeCommands.recordPayment({
      studentId: 3, amount: 50, paymentDate: '2029-01-16',
      paymentMethod: 'bank_transfer', reference: 'BANK-GATE-001',
      action: 'bank_import_payment',
      obligations: [{
        invoice_id: transport.invoice_id,
        invoice_line_item_id: transport.invoice_line_item_id,
        category: 'transport', amount: 50,
      }],
      idempotencyKey: 'bank-import-gate-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    assert.equal(bankImport.transactionIds.length, 1);
    assert.equal(duplicateBankImport.idempotent, true);

    const credit = await financeCommands.recordPayment({
      studentId: 3, amount: 25, paymentDate: '2029-01-17',
      paymentMethod: 'manual_entry', reference: 'CREDIT-GATE-001',
      obligations: [], idempotencyKey: 'unallocated-credit-gate-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    const creditSource = credit.transactionIds[0];
    const appliedCredit = await financeCommands.applyCredit({
      sourceTransactionId: creditSource, amount: 25,
      obligations: [{
        invoice_id: transport.invoice_id,
        invoice_line_item_id: transport.invoice_line_item_id,
        category: 'transport', amount: 25,
      }],
      idempotencyKey: 'apply-credit-gate-001',
      actor: { id: 1, name: 'Test Admin', role: 'admin' },
    });
    assert.ok(appliedCredit.allocation.allocations.some(
      (row) => row.invoiceId === transport.invoice_id && Number(row.amount) === 25,
    ));

    const concurrent = await Promise.all([
      financeCommands.recordPayment({
        studentId: 3, amount: 50, paymentDate: '2029-01-15',
        paymentMethod: 'manual_entry', reference: 'CONCURRENT-GATE-001',
        obligations: [{
          invoice_id: transport.invoice_id, invoice_line_item_id: transport.invoice_line_item_id,
          category: 'transport', amount: 50,
        }],
        idempotencyKey: 'concurrent-gate-key-001',
        actor: { id: 1, name: 'Test Admin', role: 'admin' },
      }),
      financeCommands.recordPayment({
        studentId: 3, amount: 50, paymentDate: '2029-01-15',
        paymentMethod: 'manual_entry', reference: 'CONCURRENT-GATE-001',
        obligations: [{
          invoice_id: transport.invoice_id, invoice_line_item_id: transport.invoice_line_item_id,
          category: 'transport', amount: 50,
        }],
        idempotencyKey: 'concurrent-gate-key-001',
        actor: { id: 1, name: 'Test Admin', role: 'admin' },
      }),
    ]);
    assert.equal(concurrent.filter((result) => result.idempotent).length, 1);
    const concurrentRows = await database.query(
      `SELECT COUNT(*)::int AS count FROM payment_transactions WHERE reference_number='CONCURRENT-GATE-001'`,
    );
    assert.equal(concurrentRows.rows[0].count, 1);

    const historicalMismatchRows = await database.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, amount_paid, due_date, status,
         reference_number, finance_origin)
      VALUES
        (3, 'FIN-GATE-001', 10, 10, '2020-02-29', 'Paid', 'HISTORICAL-NULL', NULL),
        (3, 'FIN-GATE-001', 20, 20, '2020-03-31', 'Paid', 'HISTORICAL-LEGACY', 'legacy'),
        (3, 'FIN-GATE-001', 30, 30, '2020-04-30', 'Paid', 'HISTORICAL-UNKNOWN', 'unknown')
      RETURNING id
    `);
    const historicalAuditClient = await database.pool.connect();
    try {
      await historicalAuditClient.query('BEGIN READ ONLY');
      const historicalAudit = await runFinanceCoreAudit(historicalAuditClient, {
        currentPeriod: '2029-01',
      });
      assert.equal(historicalAudit.ok, true, JSON.stringify(historicalAudit.findings));
      assert.deepEqual(historicalAudit.checks.headerVsLedger, {
        totalCount: 3,
        canonicalCount: 0,
        noncanonicalCount: 3,
      });
      const historicalFindings = historicalAudit.findings.filter(
        (finding) => finding.section === 'header_vs_ledger',
      );
      assert.equal(historicalFindings.length, 3);
      assert.ok(historicalFindings.every(
        (finding) => finding.severity === 'warning'
          && finding.code === 'historical_amount_paid_mismatch'
          && finding.classification === 'noncanonical',
      ));
      assert.deepEqual(
        historicalFindings.map((finding) => finding.finance_origin),
        [null, 'legacy', 'unknown'],
      );
      await historicalAuditClient.query('ROLLBACK');
    } finally {
      historicalAuditClient.release();
    }

    const canonicalMismatch = (await database.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, amount_paid, due_date, status,
         reference_number, finance_origin, invoice_kind, invoice_source)
      VALUES
        (3, 'FIN-GATE-001', 40, 40, '2029-02-28', 'Paid',
         'CANONICAL-MISMATCH', 'canonical', 'one_off', 'integration_test')
      RETURNING id
    `)).rows[0];
    const canonicalAuditClient = await database.pool.connect();
    try {
      await canonicalAuditClient.query('BEGIN READ ONLY');
      const canonicalAudit = await runFinanceCoreAudit(canonicalAuditClient, {
        currentPeriod: '2029-01',
      });
      assert.equal(canonicalAudit.ok, false);
      assert.deepEqual(canonicalAudit.checks.headerVsLedger, {
        totalCount: 4,
        canonicalCount: 1,
        noncanonicalCount: 3,
      });
      const canonicalFinding = canonicalAudit.findings.find(
        (finding) => finding.id === canonicalMismatch.id
          && finding.section === 'header_vs_ledger',
      );
      assert.equal(canonicalFinding.severity, 'error');
      assert.equal(canonicalFinding.code, 'canonical_amount_paid_mismatch');
      assert.equal(canonicalFinding.classification, 'canonical');
      await canonicalAuditClient.query('ROLLBACK');
    } finally {
      canonicalAuditClient.release();
    }
    await database.query('DELETE FROM invoices WHERE id=$1', [canonicalMismatch.id]);
    assert.equal(historicalMismatchRows.rows.length, 3);

    const postMigrationClient = await database.pool.connect();
    try {
      await postMigrationClient.query('BEGIN READ ONLY');
      const releaseAudit = await runFinanceCoreAudit(postMigrationClient, { currentPeriod: '2029-01' });
      assert.equal(releaseAudit.readOnly, true);
      assert.equal(
        releaseAudit.findings.filter((finding) => finding.severity === 'error').length,
        0,
        JSON.stringify(releaseAudit.findings),
      );
      const postMigrationPreflight = await runFinanceCorePreflight(postMigrationClient);
      assert.equal(postMigrationPreflight.ok, true, JSON.stringify(postMigrationPreflight.blockers));
      await postMigrationClient.query('SELECT 1 AS transaction_still_usable');
      await postMigrationClient.query('ROLLBACK');
    } finally {
      postMigrationClient.release();
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    // Dropping the schema is the release-gate cleanup assertion: no test data
    // or finance DDL survives this run.
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => {});
    await pool.end();
  }
}

if (databaseUrl) {
  test('Finance core PostgreSQL isolated release-gate scenario', { timeout: 270000 }, runSuite);
} else {
  test('Finance core PostgreSQL integration requires FINANCE_TEST_DATABASE_URL', {
    skip: 'Use the explicit finance integration runner with FINANCE_TEST_DATABASE_URL',
  }, () => {});
}
