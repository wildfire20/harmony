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

test('student update rejects legacy finance indicators before querying and still permits normal edits', async () => {
  const state = { queries: 0, updates: 0, audits: 0 };
  const database = {
    async query(sql, params = []) {
      state.queries += 1;
      if (/SELECT first_name/.test(sql)) {
        return {
          rows: [{
            id: 7, student_number: 'L-007', first_name: 'Before', last_name: 'Learner',
            grade_id: 1, class_id: 2, is_active: true, is_boarder: true,
            uses_transport: false, uses_aftercare: false,
            has_sibling_discount: false, has_teacher_discount: false,
          }],
        };
      }
      if (/UPDATE users/.test(sql)) {
        state.updates += 1;
        return {
          rows: [{
            id: 7, student_number: 'L-007', first_name: params[0],
            last_name: 'Learner', grade_id: 1, class_id: 2, is_active: true,
            is_boarder: true, uses_transport: false, uses_aftercare: false,
          }],
        };
      }
      return { rows: [] };
    },
  };
  mock('../config/database', database);
  mock('../middleware/auth', {
    authenticate: (req, _res, next) => {
      req.user = { id: 99, role: 'admin', first_name: 'A', last_name: 'Admin' };
      next();
    },
    authorize: () => (_req, _res, next) => next(),
  });
  mock('../utils/auditLogger', {
    logAudit: async () => { state.audits += 1; },
    getIp: () => '127.0.0.1',
  });
  ['../routes/admin', '../services/monthlyBillingReadiness']
    .forEach((name) => { delete require.cache[require.resolve(name)]; });
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));

    for (const field of [
      'is_boarder',
      'uses_transport',
      'uses_aftercare',
      'has_sibling_discount',
      'has_teacher_discount',
    ]) {
      const response = await request(app, 'PUT', '/api/admin/students/7', {
        first_name: 'Blocked',
        [field]: false,
      });
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'LEGACY_FINANCE_INDICATORS_READ_ONLY');
    }
    assert.equal(state.queries, 0);
    assert.equal(state.updates, 0);
    assert.equal(state.audits, 0);

    const response = await request(app, 'PUT', '/api/admin/students/7', {
      first_name: 'Updated',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.student.first_name, 'Updated');
    assert.equal(state.updates, 1);
    assert.equal(state.audits, 1);
  } finally {
    restoreModules();
    ['../routes/admin', '../services/monthlyBillingReadiness']
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

test('Phase 3D finance UI safety contracts prevent implicit finance mutations', () => {
  const studentSource = fs.readFileSync(project('client/src/components/admin/StudentManagement.js'), 'utf8');
  const dashboardSource = fs.readFileSync(project('client/src/components/payments/PaymentDashboard.js'), 'utf8');
  const initialServiceForm = studentSource.match(
    /const \[serviceForm,[\s\S]*?useState\(\{([\s\S]*?)\}\);/,
  )?.[1] || '';
  const editReset = studentSource.match(
    /const handleEdit = \(student\) => \{([\s\S]*?)\n  \};/,
  )?.[1] || '';
  const legacyFields = [
    'is_boarder',
    'uses_transport',
    'uses_aftercare',
    'has_sibling_discount',
    'has_teacher_discount',
  ];

  assert.match(initialServiceForm, /effective_start:\s*''/);
  assert.match(initialServiceForm, /effective_end:\s*''/);
  assert.match(studentSource, /Choose an explicit Finance Service start date\./);
  assert.match(studentSource, /effective_start:\s*'',\s*effective_end:\s*''/);
  assert.match(editReset, /effective_start:\s*''/);
  assert.match(editReset, /effective_end:\s*''/);
  assert.match(studentSource, /YES — recorded/);
  assert.match(studentSource, /NO — not recorded/);
  legacyFields.forEach((field) => {
    assert.doesNotMatch(studentSource, new RegExp(`register\\(['\"]${field}['\"]\\)`));
    assert.doesNotMatch(editReset, new RegExp(`${field}\\s*:`));
  });

  assert.match(dashboardSource, /new AbortController\(\)/);
  assert.match(dashboardSource, /billingReadinessRequestIdRef\.current \+= 1/);
  assert.match(dashboardSource, /isCurrentBillingReadinessResponse/);
  assert.match(dashboardSource, /handleGeneratePeriodChange\('month'/);
  assert.match(dashboardSource, /handleGeneratePeriodChange\('year'/);
  assert.match(dashboardSource, /if \(!billingReadyForSelectedPeriod\)/);
  assert.equal(
    (dashboardSource.match(/onClick=\{closeGenerateModal\}/g) || []).length,
    2,
    'both Generate Invoices modal dismissal controls must invalidate readiness',
  );
  assert.match(
    dashboardSource,
    /disabled=\{uploadLoading \|\| !billingReadyForSelectedPeriod\}/,
  );
});

test('billing readiness response identity rejects stale requests and wrong periods', () => {
  const {
    isBillingReadinessReady,
    isCurrentBillingReadinessResponse,
  } = require(
    '../client/src/components/payments/billingReadinessRequest',
  );
  assert.equal(isCurrentBillingReadinessResponse({
    requestId: 1,
    latestRequestId: 2,
    requestedPeriod: '2026-09',
    responsePeriod: '2026-09',
  }), false);
  assert.equal(isCurrentBillingReadinessResponse({
    requestId: 2,
    latestRequestId: 2,
    requestedPeriod: '2026-10',
    responsePeriod: '2026-09',
  }), false);
  assert.equal(isCurrentBillingReadinessResponse({
    requestId: 2,
    latestRequestId: 2,
    requestedPeriod: '2026-10',
    responsePeriod: '2026-10',
  }), true);
  assert.equal(isBillingReadinessReady({
    readiness: { period: '2026-09', ready: true },
    loading: false,
    selectedPeriod: '2026-10',
  }), false);
  assert.equal(isBillingReadinessReady({
    readiness: { period: '2026-10', ready: true },
    loading: true,
    selectedPeriod: '2026-10',
  }), false);
  assert.equal(isBillingReadinessReady({
    readiness: { period: '2026-10', ready: true },
    loading: false,
    selectedPeriod: '2026-10',
  }), true);
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

test('Phase 4A preview pure policy helpers produce deduped sources, prices, discounts and totals', () => {
  const preview = require('../scripts/preview-finance-service-bootstrap');
  const students = [
    { student_id: 1, student_number: 'B1', first_name: 'Board', last_name: 'Er',
      is_boarder: true, uses_transport: false, uses_aftercare: false,
      has_teacher_discount: true, has_sibling_discount: true },
    { student_id: 2, student_number: 'N2', first_name: 'Non', last_name: 'Board',
      is_boarder: false, uses_transport: true, uses_aftercare: true,
      has_teacher_discount: false, has_sibling_discount: true },
  ];
  const proposals = preview.buildServiceProposals(students, [{
    student_id: 1, service_key: 'tuition', state: 'ended',
  }], '2026-10-01');
  assert.deepEqual(proposals.filter((row) => row.student_id === 1)
    .map((row) => [row.service_key, row.source, row.status]), [
      ['tuition', 'existing_enrollment', 'already_effective'],
      ['boarding', 'boarding_package', 'proposal'],
      ['transport', 'boarding_package', 'proposal'],
      ['aftercare', 'boarding_package', 'proposal'],
    ]);
  assert.deepEqual(proposals.filter((row) => row.student_id === 2)
    .map((row) => row.source), [
    'active_student', 'standalone_legacy_transport', 'standalone_legacy_aftercare',
  ]);
  assert.equal(new Set(proposals.map((row) => `${row.student_id}:${row.service_key}`)).size,
    proposals.length);
  const retained = preview.buildServiceProposals([
    { student_id: 3, student_number: 'E3', first_name: 'Existing', last_name: 'Transport',
      is_boarder: false, uses_transport: false, uses_aftercare: false },
  ], [{ student_id: 3, service_key: 'transport', state: 'ended',
    reason: 'operator-approved historical service' }], '2026-10-01');
  assert.equal(retained.find((row) => row.service_key === 'transport').status, 'already_effective');
  assert.equal(retained.find((row) => row.service_key === 'transport').source, 'existing_enrollment');
  assert.equal(retained.find((row) => row.service_key === 'transport').reason,
    'operator-approved historical service');
  const discounts = preview.buildDiscountPreview(students, [], '2026-10-01');
  assert.deepEqual(discounts.proposals.map((row) => [
    row.student_id, row.discount_type, row.calculation_method, row.amount, row.percentage,
  ]), [[1, 'staff', 'percentage', 0, 50], [2, 'sibling', 'fixed', 100, null]]);
  assert.equal(discounts.suppressed.length, 1);
  assert.equal(discounts.proposals.some((row) => row.student_id === 1 &&
    row.discount_type === 'sibling'), false);
  const explicitStaffLegacySibling = preview.buildDiscountPreview([{
    student_id: 4, student_number: 'S4', first_name: 'Staff', last_name: 'Sibling',
    has_teacher_discount: false, has_sibling_discount: true,
  }], [{ id: 40, student_id: 4, discount_type: 'staff',
    applicable_service_key: 'tuition' }], '2026-10-01');
  assert.equal(explicitStaffLegacySibling.proposals.some((row) => row.discount_type === 'sibling'), false);
  assert.equal(explicitStaffLegacySibling.suppressed.length, 1);
  assert.equal(preview.compareServicePrices([
    { service_key: 'tuition', amount: 2350, billing_mode: 'standalone', included_service_keys: [] },
    { service_key: 'boarding', amount: 1600, billing_mode: 'bundle',
      bundle_key: 'harmony_boarding_package', included_service_keys: ['transport', 'aftercare'] },
    { service_key: 'transport', amount: 650, billing_mode: 'standalone', included_service_keys: [] },
    { service_key: 'aftercare', amount: 550, billing_mode: 'standalone', included_service_keys: [] },
  ]).every((row) => !row.changes_required), true);
  assert.deepEqual(preview.calculatePolicyTotals(), { tuition: 2350, boarding: 1600, gross: 3950 });
  assert.deepEqual(preview.calculatePolicyTotals('staff'), { tuition: 1175, boarding: 1600, gross: 2775 });
  assert.deepEqual(preview.calculatePolicyTotals('sibling'), { tuition: 2250, boarding: 1600, gross: 3850 });
  const previewSource = fs.readFileSync(project('scripts/preview-finance-service-bootstrap.js'), 'utf8');
  assert.match(previewSource, /beginVerifiedReadonlySession/);
  assert.match(previewSource, /await client\.query\('ROLLBACK'\)/);
  const queryTemplates = [...previewSource.matchAll(/client\.query\(`([\s\S]*?)`/g)]
    .map((match) => match[1]);
  queryTemplates.forEach((sql) => {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  });
});

test('Phase 4A readiness blocks incomplete Boarding packages and staff-sibling conflicts', async () => {
  const { getMonthlyBillingReadiness } = require('../services/monthlyBillingReadiness');
  const students = [{
    id: 41,
    student_number: 'POLICY-41',
    has_sibling_discount: false,
    has_teacher_discount: false,
  }];
  const prices = [
    { service_key: 'tuition', amount: 2350, billing_mode: 'standalone', included_service_keys: [] },
    { service_key: 'boarding', amount: 1600, billing_mode: 'bundle',
      bundle_key: 'harmony_boarding_package', included_service_keys: ['transport', 'aftercare'] },
    { service_key: 'transport', amount: 650, billing_mode: 'standalone', included_service_keys: [] },
    { service_key: 'aftercare', amount: 550, billing_mode: 'standalone', included_service_keys: [] },
  ];
  const enrollments = [
    { id: 1, student_id: 41, service_key: 'tuition',
      effective_start: '2026-10-01', effective_end: null, state: 'active' },
    { id: 2, student_id: 41, service_key: 'boarding',
      effective_start: '2026-10-01', effective_end: null, state: 'active' },
  ];
  const assignments = [
    { id: 10, student_id: 41, discount_type: 'staff',
      starts_on: '2026-10-01', ends_on: null },
    { id: 11, student_id: 41, discount_type: 'sibling',
      starts_on: '2026-10-01', ends_on: null },
  ];
  const executor = {
    async query(sql) {
      if (/FROM users/.test(sql)) return { rows: students };
      if (/FROM service_prices/.test(sql)) return { rows: prices };
      if (/FROM service_enrollments/.test(sql)) return { rows: enrollments };
      if (/FROM learner_discount_assignments/.test(sql)) return { rows: assignments };
      return { rows: [] };
    },
  };
  const readiness = await getMonthlyBillingReadiness('2026-10', executor);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.hardFailures
    .filter((failure) => failure.code === 'incomplete_boarding_package').length, 2);
  assert.ok(readiness.hardFailures
    .some((failure) => failure.code === 'conflicting_discount_assignments'));
});

test('Phase 4A UI discount start date is blank/reset and validated before API', () => {
  const source = fs.readFileSync(project('client/src/components/admin/StudentManagement.js'), 'utf8');
  assert.match(source, /starts_on:\s*''/);
  assert.match(source, /approved discount start date \(YYYY-MM-DD\)/);
  assert.match(source, /setDiscountForm\(\(current\) => \(\{ \.\.\.current, starts_on: '' \}\)\)/);
  assert.match(source, /starts_on: '', ends_on: ''/);
});

test('Phase 4A ledger keeps Boarding included evidence zero-valued and gives staff precedence', () => {
  const { buildInvoiceSnapshotLines } = require('../services/financeLedger');
  const prices = [
    { service_key: 'tuition', label: 'Tuition', amount: 2350, billing_mode: 'standalone',
      bundle_key: null, included_service_keys: [] },
    { service_key: 'boarding', label: 'Boarding', amount: 1600, billing_mode: 'bundle',
      bundle_key: 'harmony_boarding_package', included_service_keys: ['transport', 'aftercare'] },
    { service_key: 'transport', label: 'Transport', amount: 650, billing_mode: 'standalone',
      bundle_key: null, included_service_keys: [] },
    { service_key: 'aftercare', label: 'Aftercare', amount: 550, billing_mode: 'standalone',
      bundle_key: null, included_service_keys: [] },
  ];
  const lines = buildInvoiceSnapshotLines({}, prices, [
    { id: 1, discount_type: 'sibling', calculation_method: 'fixed', amount: 100,
      applicable_service_key: 'tuition' },
    { id: 2, discount_type: 'staff', calculation_method: 'percentage', percentage: 50,
      applicable_service_key: 'tuition' },
  ], [
    { state: 'active', service_key: 'tuition' },
    { state: 'active', service_key: 'boarding' },
    { state: 'active', service_key: 'transport' },
    { state: 'active', service_key: 'aftercare' },
  ]);
  assert.deepEqual(lines.filter((line) => line.line_type === 'charge')
    .map((line) => [line.service_key, line.amount, line.is_included]), [
    ['boarding', 1600, false], ['transport', 0, true],
    ['aftercare', 0, true], ['tuition', 2350, false],
  ]);
  assert.deepEqual(lines.filter((line) => line.line_type === 'discount')
    .map((line) => [line.discount_assignment_id, line.amount]), [[2, 1175]]);
});

test('Phase 4A readiness blocks wrong Harmony package pricing but accepts exact policy', async () => {
  const { getMonthlyBillingReadiness } = require('../services/monthlyBillingReadiness');
  const students = [{ id: 8, student_number: 'H8', first_name: 'Harmony', last_name: 'Boarder' }];
  const enrollments = [
    { id: 1, student_id: 8, service_key: 'tuition' },
    { id: 2, student_id: 8, service_key: 'boarding' },
    { id: 3, student_id: 8, service_key: 'transport' },
    { id: 4, student_id: 8, service_key: 'aftercare' },
  ];
  const prices = (boardingMode = 'bundle', bundleKey = 'harmony_boarding_package') => [
    { service_key: 'tuition', amount: 2350, billing_mode: 'standalone',
      bundle_key: null, included_service_keys: [] },
    { service_key: 'boarding', amount: 1600, billing_mode: boardingMode,
      bundle_key: bundleKey, included_service_keys: ['transport', 'aftercare'] },
    { service_key: 'transport', amount: 650, billing_mode: 'standalone',
      bundle_key: null, included_service_keys: [] },
    { service_key: 'aftercare', amount: 550, billing_mode: 'standalone',
      bundle_key: null, included_service_keys: [] },
  ];
  const run = async (priceRows) => {
    let enrollmentQuery = 0;
    return getMonthlyBillingReadiness('2026-10', { async query(sql) {
      if (/FROM users/.test(sql)) return { rows: students };
      if (/FROM service_prices/.test(sql)) return { rows: priceRows };
      if (/FROM learner_discount_assignments/.test(sql)) return { rows: [] };
      if (/FROM service_enrollments/.test(sql)) {
        enrollmentQuery += 1;
        return { rows: enrollmentQuery === 1 ? enrollments : enrollments };
      }
      return { rows: [] };
    } });
  };
  const wrong = await run(prices('standalone', null));
  assert.ok(wrong.hardFailures.some((item) => item.code === 'invalid_harmony_billing_policy'));
  const valid = await run(prices());
  assert.equal(valid.hardFailures.some((item) => item.code === 'invalid_harmony_billing_policy'), false);
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