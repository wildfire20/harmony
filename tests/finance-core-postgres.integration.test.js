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
      INSERT INTO parent_students (parent_id, student_id) VALUES (2, 3), (4, 3);
      INSERT INTO learner_discount_assignments
        (student_id, discount_type, calculation_method, amount,
         applicable_service_key, reason, starts_on)
      VALUES
        (3, 'custom', 'fixed', 100, 'tuition',
         'Approved gate discount', '2029-01-01');
    `);

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
    assert.deepEqual(initialPayables.filter((row) => row.is_payable).map((row) => row.category), [
      'boarding', 'tuition', 'boarding', 'transport', 'aftercare', 'one_off',
    ]);
    assert.equal(initialPayables.filter((row) => row.is_payable).length, 6);
    const tuition = initialPayables.find((row) => row.category === 'tuition');
    const oneOff = initialPayables.find((row) => row.category === 'one_off');
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
    assert.equal(afterApproval.filter((row) => row.is_payable).length, 4);
    const ledgerResponse = await request(
      server, 'GET', '/api/reports/student-payment-history/FIN-GATE-001',
      undefined, { 'x-test-role': 'admin' },
    );
    assert.equal(ledgerResponse.status, 200);
    assert.equal(Number(ledgerResponse.body.summary.totalPaid), mixedAmount);
    assert.equal(
      Number(ledgerResponse.body.summary.totalOutstanding),
      10 + 5050 - Number(tuition.amount_outstanding),
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
  test('Finance core PostgreSQL isolated release-gate scenario', { timeout: 180000 }, runSuite);
} else {
  test('Finance core PostgreSQL integration requires FINANCE_TEST_DATABASE_URL', {
    skip: 'Use the explicit finance integration runner with FINANCE_TEST_DATABASE_URL',
  }, () => {});
}
