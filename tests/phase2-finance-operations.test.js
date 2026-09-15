/*
 * Small Phase 2 regression contracts.  The route tests use disposable in
 * memory query doubles; the finance-core PostgreSQL release gate remains the
 * place for database trigger/constraint coverage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const project = (name) => path.join(__dirname, '..', name);
const originalModules = new Map();

function mock(name, exports) {
  const resolved = require.resolve(name);
  if (!originalModules.has(resolved)) originalModules.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

function restoreModules() {
  for (const [resolved, previous] of originalModules) {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  }
  originalModules.clear();
}

function request(app, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const server = app.listen(0, '127.0.0.1', () => {
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
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          server.close();
          let parsed = {};
          try { parsed = text ? JSON.parse(text) : {}; } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.once('error', (error) => { server.close(); reject(error); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test('Admin service enrollment API authenticates, validates, audits, idempotently retries and rejects overlaps', async () => {
  const state = { enrollments: [], audits: [], overlap: false, nextId: 1 };
  const execute = async (sql, params = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory)/i.test(sql.trim())) return { rows: [] };
    if (/FROM users/.test(sql)) {
      return { rows: state.invalidLearner ? [] : [{ id: 7, student_number: 'L-007' }] };
    }
    if (/audit_logs/.test(sql)) {
      state.audits.push({ action: params[3], entityId: params[5] });
      return { rows: [] };
    }
    if (/WHERE idempotency_key/.test(sql)) {
      const row = state.enrollments.find((item) => item.idempotency_key === params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/WHERE student_id=.*effective_start/.test(sql) && /SELECT id, student_id/.test(sql)) {
      const row = state.enrollments.find((item) =>
        Number(item.student_id) === Number(params[0]) &&
        item.service_key === params[1] &&
        item.effective_start === params[2]);
      return { rows: row ? [row] : [] };
    }
    if (/SELECT id\s+FROM service_enrollments/.test(sql)) {
      return { rows: state.overlap ? [{ id: 88 }] : [] };
    }
    if (/INSERT INTO service_enrollments/.test(sql)) {
      const row = {
        id: state.nextId++, student_id: params[0], service_key: params[1],
        effective_start: params[2], effective_end: params[3] || null,
        state: params[4], idempotency_key: params[5] || null,
      };
      state.enrollments.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  };
  const client = { query: execute, release() {} };
  const database = {
    query: execute,
    pool: { async connect() { return client; } },
  };
  mock('../config/database', database);
  mock('../middleware/auth', {
    authenticate: (req, res, next) => {
      if (!req.headers['x-test-role']) return res.status(401).json({ message: 'Authentication required' });
      req.user = { id: 99, role: req.headers['x-test-role'], first_name: 'A', last_name: 'Admin' };
      next();
    },
    authorize: (...roles) => (req, res, next) => roles.flat().includes(req.user?.role)
      ? next() : res.status(403).json({ message: 'Forbidden' }),
  });
  mock('../utils/auditLogger', {
    logAudit: async (payload) => execute(
      'INSERT INTO audit_logs', [
        payload.userId, payload.userName, payload.userRole, payload.action,
        payload.entityType, payload.entityId,
      ]),
    getIp: () => '127.0.0.1',
  });
  ['../routes/admin', '../services/serviceEnrollmentRepository',
    '../services/serviceEnrollmentService', '../services/monthlyBillingReadiness']
    .forEach((name) => { delete require.cache[require.resolve(name)]; });
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));

    assert.equal((await request(app, 'GET', '/api/admin/service-enrollments')).status, 401);
    let response = await request(app, 'POST', '/api/admin/service-enrollments', {
      student_id: 7, service_key: 'tuition',
    }, { 'x-test-role': 'admin' });
    assert.equal(response.status, 400);

    state.invalidLearner = true;
    response = await request(app, 'POST', '/api/admin/service-enrollments', {
      student_id: 7, service_key: 'tuition', effective_start: '2028-01-01',
    }, { 'x-test-role': 'admin', 'Idempotency-Key': 'enroll-2028-001' });
    assert.equal(response.status, 404);
    state.invalidLearner = false;

    const body = {
      student_id: 7, service_key: 'tuition', effective_start: '2028-01-01',
      effective_end: '2028-01-31',
    };
    response = await request(app, 'POST', '/api/admin/service-enrollments', body, {
      'x-test-role': 'admin', 'Idempotency-Key': 'enroll-2028-001',
    });
    assert.equal(response.status, 201);
    assert.equal(state.enrollments.length, 1);
    assert.equal(state.audits.length, 1);
    response = await request(app, 'POST', '/api/admin/service-enrollments', body, {
      'x-test-role': 'admin', 'Idempotency-Key': 'enroll-2028-001',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.idempotent, true);
    assert.equal(state.enrollments.length, 1);
    assert.equal(state.audits.length, 1);
    response = await request(app, 'POST', '/api/admin/service-enrollments', {
      ...body, effective_end: '2028-02-01',
    }, { 'x-test-role': 'admin', 'Idempotency-Key': 'enroll-2028-001' });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'IDEMPOTENCY_CONFLICT');
    response = await request(app, 'POST', '/api/admin/service-enrollments', {
      ...body, effective_end: '2028-02-01',
    }, { 'x-test-role': 'admin', 'Idempotency-Key': 'enroll-natural-002' });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'IDEMPOTENCY_CONFLICT');
    response = await request(app, 'POST', '/api/admin/service-enrollments', {
      ...body, idempotency_key: 'short',
    }, { 'x-test-role': 'admin' });
    assert.equal(response.status, 400);

    state.overlap = true;
    response = await request(app, 'POST', '/api/admin/service-enrollments', {
      ...body, effective_start: '2028-01-15',
    }, { 'x-test-role': 'super_admin', 'Idempotency-Key': 'enroll-overlap-001' });
    assert.equal(response.status, 409);
    assert.equal(state.enrollments.length, 1);
  } finally {
    restoreModules();
    ['../routes/admin', '../services/serviceEnrollmentRepository',
      '../services/serviceEnrollmentService', '../services/monthlyBillingReadiness']
      .forEach((name) => { delete require.cache[require.resolve(name)]; });
  }
});

test('service enrollment effective-period boundaries are inclusive and dates are explicit', async () => {
  const repository = require('../services/serviceEnrollmentRepository');
  assert.deepEqual(repository.periodBounds('2028-02'), {
    start: '2028-02-01', end: '2028-02-29',
  });
  assert.throws(() => repository.periodBounds('2028-13'), /YYYY-MM/);
  assert.throws(() => repository.normalizeDate('2028-02-30', 'effectiveStart'), /ISO calendar date/);

  const executor = {
    async query(sql, params) {
      assert.match(sql, /effective_start <= \$2::date/);
      assert.deepEqual(params, [7, '2028-02-29', '2028-02-01']);
      return { rows: [{ id: 1, student_id: 7, service_key: 'tuition' }] };
    },
  };
  const rows = await repository.listEffectiveEnrollments(7, '2028-02', executor);
  assert.equal(rows[0].service_key, 'tuition');
});

test('monthly readiness reports hard blockers and monthly generation visibly blocks them', async () => {
  const { getMonthlyBillingReadiness } = require('../services/monthlyBillingReadiness');
  const rows = {
    students: [{
      id: 7, student_number: 'L-007',
      has_sibling_discount: true, has_teacher_discount: false,
    }],
    prices: [{
      service_key: 'tuition', label: 'Tuition', amount: '1000',
      billing_mode: 'standalone', included_service_keys: [],
    }],
    effective: [],
    all: [{
      id: 1, student_id: 7, service_key: 'tuition',
      effective_start: '2028-01-01', effective_end: '2028-03-31',
    }, {
      id: 2, student_id: 7, service_key: 'tuition',
      effective_start: '2028-02-01', effective_end: null,
    }],
    discounts: [],
  };
  let enrollmentQueryCount = 0;
  const executor = {
    async query(sql) {
      if (/FROM users/.test(sql)) return { rows: rows.students };
      if (/FROM service_prices/.test(sql)) return { rows: rows.prices };
      if (/FROM learner_discount_assignments/.test(sql)) return { rows: rows.discounts };
      if (/FROM service_enrollments/.test(sql)) {
        enrollmentQueryCount += 1;
        return { rows: enrollmentQueryCount === 1 ? rows.effective : rows.all };
      }
      return { rows: rows.all };
    },
  };
  const readiness = await getMonthlyBillingReadiness('2028-02', executor);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.hardFailures.some((item) => item.code === 'missing_tuition_enrollment'));
  assert.ok(readiness.hardFailures.some((item) => item.code === 'overlapping_service_enrollments'));
  assert.ok(readiness.hardFailures.some((item) => item.code === 'unresolved_legacy_discount_indicator'));
  const emptyReadiness = await getMonthlyBillingReadiness('2028-02', {
    async query() { return { rows: [] }; },
  });
  assert.equal(emptyReadiness.ready, false);
  assert.ok(emptyReadiness.hardFailures.some((item) => item.code === 'no_active_learners'));

  const invoicesSource = fs.readFileSync(project('routes/invoices.js'), 'utf8');
  assert.match(invoicesSource, /MONTHLY_BILLING_NOT_READY/);
  assert.match(invoicesSource, /getMonthlyBillingReadiness/);
});

test('monthly generation returns a visible server-side readiness block before the command', async () => {
  let commandCalled = false;
  mock('../config/database', {
    async query() { return { rows: [] }; },
    pool: { async connect() {
      throw new Error('generation must not open a write transaction when blocked');
    } },
  });
  mock('../middleware/auth', {
    authenticate: (req, _res, next) => {
      req.user = { id: 9, role: 'admin', first_name: 'A', last_name: 'Admin' };
      next();
    },
    authorize: () => (_req, _res, next) => next(),
  });
  mock('../services/monthlyBillingReadiness', {
    getMonthlyBillingReadiness: async () => ({
      period: '2028-02',
      ready: false,
      hardFailures: [{
        code: 'missing_tuition_enrollment',
        message: 'Learner L-007 has no tuition enrollment.',
      }],
    }),
  });
  mock('../services/financeCommandService', {
    generateMonthlyInvoices: async () => {
      commandCalled = true;
      throw new Error('unexpected command invocation');
    },
  });
  mock('../utils/auditLogger', { logAudit: async () => {}, getIp: () => '127.0.0.1' });
  mock('../services/parentNotificationService', {});
  delete require.cache[require.resolve('../routes/invoices')];
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/invoices', require('../routes/invoices'));
    const response = await request(app, 'POST', '/api/invoices/generate-monthly', {
      month: 2, year: 2028,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'MONTHLY_BILLING_NOT_READY');
    assert.equal(response.body.readiness.hardFailures[0].code, 'missing_tuition_enrollment');
    assert.equal(commandCalled, false);
  } finally {
    restoreModules();
    delete require.cache[require.resolve('../routes/invoices')];
  }
});

test('StudentManagement exposes dated finance services and keeps old flags/discounts explicit', () => {
  const source = fs.readFileSync(project('client/src/components/admin/StudentManagement.js'), 'utf8');
  const api = fs.readFileSync(project('client/src/services/api.js'), 'utf8');
  assert.match(source, /Legacy service indicators \(not billing\)/);
  assert.match(source, /getStudentServiceEnrollments/);
  assert.match(source, /createServiceEnrollment/);
  assert.match(source, /endServiceEnrollment/);
  assert.match(source, /effective_start/);
  assert.match(source, /effective_end/);
  assert.match(source, /no value is inferred/);
  assert.match(api, /getMonthlyBillingReadiness/);
  assert.match(api, /Idempotency-Key/);
});

test('bundle snapshots include tuition and aftercare once while transport remains separate', () => {
  const { buildInvoiceSnapshotLines } = require('../services/financeLedger');
  const prices = [
    { service_key: 'boarding', label: 'Boarding', amount: 1800, billing_mode: 'bundle',
      bundle_key: 'boarding-school-day', included_service_keys: ['tuition', 'aftercare'] },
    { service_key: 'tuition', label: 'Tuition', amount: 1000, billing_mode: 'bundle_component',
      bundle_key: 'boarding-school-day', included_service_keys: [] },
    { service_key: 'aftercare', label: 'Aftercare', amount: 250, billing_mode: 'bundle_component',
      bundle_key: 'boarding-school-day', included_service_keys: [] },
    { service_key: 'transport', label: 'Transport', amount: 300, billing_mode: 'standalone',
      included_service_keys: [] },
  ];
  const lines = buildInvoiceSnapshotLines({}, prices, [], [
    { state: 'active', service_key: 'tuition' },
    { state: 'active', service_key: 'boarding' },
    { state: 'active', service_key: 'aftercare' },
    { state: 'active', service_key: 'transport' },
  ]);
  assert.deepEqual(lines.map((line) => [line.service_key, line.amount, line.is_included]), [
    ['boarding', 1800, false],
    ['tuition', 0, true],
    ['aftercare', 0, true],
    ['transport', 300, false],
  ]);
});

test('bank, proof and manual channels converge on canonical command/ledger paths', () => {
  const source = (name) => fs.readFileSync(project(name), 'utf8');
  const invoices = source('routes/invoices.js');
  const enhanced = source('routes/enhanced-invoices.js');
  const proofs = source('routes/paymentProofs.js');
  const commands = source('services/financeCommandService.js');
  assert.match(invoices, /financeCommands\.(recordPayment|importBankPayment)/);
  assert.match(enhanced, /financeCommands\.(recordPayment|recordManualPayment)/);
  assert.match(proofs, /financeCommands\.(approveProof|recordPayment|applyUnallocated)/);
  assert.match(commands, /allocatePayment\(executor/);
  assert.doesNotMatch(invoices.split("router.post('/process-bank-statement'")[1]
    .split('// Get payment transactions')[0], /INSERT INTO payment_transactions/);
});