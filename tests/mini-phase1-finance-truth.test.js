const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  configuredBillableLines,
  configuredComponents,
  calculateApprovedDiscounts,
  invoiceStatus,
  buildInvoiceBreakdown,
  getStudentLedger,
  getFinanceSummary,
} = require('../services/financeLedger');
const { parseInvoiceListQuery } = require('../utils/invoiceQuery');
const {
  verifyMiniPhase1FinanceSchema,
} = require('../scripts/mini-phase1-finance-schema-verifier');

const prices = [
  { service_key: 'tuition', label: 'Tuition', amount: 2350, billing_mode: 'bundle_component' },
  {
    service_key: 'boarding', label: 'Boarding package', amount: 1600,
    billing_mode: 'standalone', bundle_key: 'boarding-package',
    included_service_keys: ['tuition', 'aftercare'],
  },
  { service_key: 'aftercare', label: 'Aftercare', amount: 500, billing_mode: 'bundle_component' },
  { service_key: 'transport', label: 'Transport', amount: 650, billing_mode: 'standalone' },
];

test('boarding bundle creates zero included snapshot lines and keeps transport separate', () => {
  const lines = configuredBillableLines({
    is_boarder: true, uses_transport: true, uses_aftercare: true,
  }, prices);
  assert.deepEqual(lines.map((line) => [line.service_key, line.amount, line.is_included]), [
    ['boarding', 1600, false],
    ['tuition', 0, true],
    ['aftercare', 0, true],
    ['transport', 650, false],
  ]);
  assert.equal(lines.filter((line) => !line.is_included).reduce((sum, line) => sum + line.amount, 0), 2250);
  assert.equal(lines.filter((line) => line.is_included).length, 2);
  // Generation persists every returned line, including zero included rows.
  const generation = fs.readFileSync(path.join(__dirname, '..', 'routes/invoices.js'), 'utf8');
  assert.match(generation, /INSERT INTO invoice_line_items/);
  assert.match(generation, /line\.is_included/);
  assert.doesNotMatch(generation, /has_teacher_discount/);
  assert.doesNotMatch(generation, /has_sibling_discount/);
  assert.match(generation, /amountDue is obsolete/);
  assert.match(generation, /pg_advisory_xact_lock/);
  assert.match(generation, /lockedExistingResult/);
  assert.match(generation, /BEGIN/);
});

test('ledger keeps top-level services enrollment-only and reports bundle truth on invoice lines', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{
        id: 8, student_number: 'HAR008', first_name: 'B', last_name: 'Boarder',
        is_boarder: true, uses_transport: true, uses_aftercare: true,
        has_sibling_discount: false, has_teacher_discount: false,
      }] };
      if (sql.includes('FROM invoices')) return { rows: [{
        id: 80, student_id: 8, amount_due: 2250, amount_paid: 0,
        outstanding_balance: 2250, overpaid_amount: 0, due_date: '2026-01-31',
        status: 'Unpaid',
      }] };
      if (sql.includes('FROM payment_transactions')) return { rows: [] };
      if (sql.includes('FROM service_prices')) return { rows: prices };
      if (sql.includes('FROM invoice_line_items')) return { rows: [
        { id: 1, invoice_id: 80, line_type: 'charge', service_key: 'boarding', bundle_key: 'boarding-package', label: 'Boarding package', amount: 1600, is_included: false },
        { id: 2, invoice_id: 80, line_type: 'charge', service_key: 'tuition', bundle_key: 'boarding-package', label: 'Tuition', amount: 0, is_included: true },
        { id: 3, invoice_id: 80, line_type: 'charge', service_key: 'aftercare', bundle_key: 'boarding-package', label: 'Aftercare', amount: 0, is_included: true },
        { id: 4, invoice_id: 80, line_type: 'charge', service_key: 'transport', label: 'Transport', amount: 650, is_included: false },
      ] };
      throw new Error(`Unexpected model query: ${sql}`);
    },
  };
  const ledger = await getStudentLedger(8, executor);
  assert.equal(ledger.service_components.find((line) => line.key === 'tuition').billing_state, undefined);
  assert.equal(ledger.invoices[0].line_items.find((line) => line.service_key === 'tuition').included, true);
  assert.equal(ledger.invoices[0].line_items.find((line) => line.service_key === 'aftercare').included, true);
  assert.equal(ledger.invoices[0].line_items.find((line) => line.service_key === 'transport').included, false);
});

test('fixed, percentage and service-scoped assignments are cumulative and capped', () => {
  const charges = [
    { line_type: 'charge', service_key: 'tuition', amount: 100 },
    { line_type: 'charge', service_key: 'boarding', amount: 50 },
  ];
  const discounts = calculateApprovedDiscounts([
    { id: 1, discount_type: 'staff', calculation_method: 'fixed', amount: 80, applicable_service_key: 'tuition', reason: 'staff' },
    { id: 2, discount_type: 'sibling', calculation_method: 'percentage', percentage: 50, applicable_service_key: 'tuition', reason: 'sibling' },
    { id: 3, discount_type: 'custom', calculation_method: 'fixed', amount: 100, applicable_service_key: 'boarding', reason: 'custom' },
  ], charges);
  assert.deepEqual(discounts.map((line) => [line.label, line.amount]), [
    ['Staff discount', 80],
    ['Sibling discount', 20],
    ['Custom approved discount', 50],
  ]);
  assert.ok(discounts.reduce((sum, line) => sum + line.amount, 0) <= 150);
});

test('legacy boolean discount flags remain informational and do not alter charges', () => {
  const withLegacyFlags = configuredComponents({
    is_boarder: false, uses_transport: false, uses_aftercare: false,
    has_teacher_discount: true, has_sibling_discount: true,
  }, [{ service_key: 'tuition', label: 'Tuition', amount: 1000 }]);
  assert.equal(withLegacyFlags.discount, 0);
  assert.equal(withLegacyFlags.configuredTotal, 1000);
  assert.equal(withLegacyFlags.discountLabel, null);
});

test('zero-net invoices are Paid and positive payment makes them Overpaid', () => {
  assert.equal(invoiceStatus(0, 0, 'Unpaid'), 'Paid');
  assert.equal(invoiceStatus(0, 25, 'Paid'), 'Overpaid');
  assert.equal(invoiceStatus(100, 100, 'Unpaid'), 'Paid');
});

test('invoice breakdown preserves persisted lines and marks legacy snapshots unavailable', () => {
  const snapshot = buildInvoiceBreakdown(
    { id: 1, amount_due: 90, amount_paid: 100, status: 'Unpaid' },
    [
      { id: 1, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 100, is_included: false },
      { id: 2, invoice_id: 1, line_type: 'charge', service_key: 'aftercare', label: 'Aftercare', amount: 0, is_included: true },
      { id: 3, invoice_id: 1, line_type: 'discount', label: 'Approved staff discount', amount: 10, is_included: false },
    ],
    [{ type: 'transaction_month_mismatch' }],
  );
  assert.equal(snapshot.gross_charges, 100);
  assert.equal(snapshot.discount_total, 10);
  assert.equal(snapshot.net_due, 90);
  assert.equal(snapshot.status, 'Overpaid');
  assert.equal(snapshot.line_items[1].included, true);
  assert.equal(snapshot.review_required, true);
  assert.equal(buildInvoiceBreakdown({ amount_due: 500, amount_paid: 0 }, []).snapshot_available, false);
});

test('HAR049 month mismatch is review-only and invoice amount_paid remains authoritative', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{
        id: 49, student_number: 'HAR049', first_name: 'H', last_name: 'Learner',
        is_boarder: false, uses_transport: false, uses_aftercare: false,
        has_sibling_discount: true, has_teacher_discount: true,
      }] };
      if (sql.includes('FROM invoices')) return { rows: [{
        id: 4901, student_id: 49, amount_due: 1175, amount_paid: 1175,
        outstanding_balance: 0, overpaid_amount: 0, due_date: '2026-03-31',
        status: 'Paid',
      }] };
      if (sql.includes('FROM payment_transactions')) return { rows: [{
        id: 4902, invoice_id: 4901, amount: 1175, month: 2, year: 2026,
      }] };
      if (sql.includes('FROM service_prices')) return { rows: [] };
      throw new Error(`Unexpected model query: ${sql}`);
    },
  };
  const ledger = await getStudentLedger(49, executor);
  assert.equal(ledger.invoices[0].amount_paid, 1175);
  assert.equal(ledger.invoices[0].outstanding_balance, 0);
  assert.equal(ledger.invoices[0].review_required, true);
  assert.equal(ledger.invoices[0].payment_review_flags[0].type, 'transaction_month_mismatch');
  assert.equal(ledger.totals.totalPaid, 1175);
});

test('unallocated payments are review credit, not paid months', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{
        id: 7, student_number: 'HAR007', first_name: 'A', last_name: 'Learner',
        is_boarder: false, uses_transport: false, uses_aftercare: false,
      }] };
      if (sql.includes('FROM invoices')) return { rows: [{
        id: 1, student_id: 7, amount_due: 100, amount_paid: 0,
        outstanding_balance: 100, overpaid_amount: 0, due_date: '2026-01-31',
        status: 'Unpaid',
      }] };
      if (sql.includes('FROM payment_transactions')) return { rows: [{
        id: 2, invoice_id: null, amount: 50,
      }] };
      if (sql.includes('FROM service_prices')) return { rows: [] };
      throw new Error(`Unexpected model query: ${sql}`);
    },
  };
  const ledger = await getStudentLedger(7, executor);
  assert.equal(ledger.invoices[0].amount_paid, 0);
  assert.equal(ledger.invoices[0].status, 'Unpaid');
  assert.equal(ledger.totals.credit, 50);
  assert.equal(ledger.transactions[0].review_required, true);
});

test('migration is additive and does not rewrite invoices or payments', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mini_phase1_finance_truth.sql'), 'utf8');
  assert.doesNotMatch(migration, /\bUPDATE\s+invoices\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+payment_transactions\b/i);
  assert.doesNotMatch(migration, /\bBACKFILL\b/i);
  assert.match(migration, /invoice_line_items_immutable/);
  assert.match(migration, /learner_discount_assignments/);
});

test('finance schema audit supplies exactly one value per SQL placeholder', async () => {
  const calls = [];
  const pgCompatibleClient = {
    async query(sql, values = []) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const requiredValueCount = placeholders.length ? Math.max(...placeholders) : 0;
      assert.equal(
        values.length,
        requiredValueCount,
        `placeholder/value mismatch in query: ${sql.trim().split(/\s+/).slice(0, 8).join(' ')}`,
      );
      calls.push({ sql, values });
      return { rows: [] };
    },
  };

  const result = await verifyMiniPhase1FinanceSchema(pgCompatibleClient);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 5);
  const constraintCall = calls.find(({ sql }) => sql.includes('FROM pg_constraint'));
  assert.equal(constraintCall.values.length, 1);
  assert.deepEqual(constraintCall.values[0], [
    'learner_discount_assignments',
    'invoice_line_items',
    'service_prices',
  ]);
});

test('finance schema audit identifies the exact failing query section without values', async () => {
  const sensitiveMarker = 'do-not-print-this-value';
  let queryCount = 0;
  const client = {
    async query() {
      queryCount += 1;
      if (queryCount === 3) throw new Error('database unavailable');
      return { rows: [] };
    },
  };

  await assert.rejects(
    verifyMiniPhase1FinanceSchema(client),
    (error) => {
      assert.equal(error.auditSection, 'required_indexes');
      assert.match(error.message, /required_indexes/);
      assert.doesNotMatch(error.message, new RegExp(sensitiveMarker));
      return true;
    },
  );
});

test('shared finance audit filters keep pg placeholders aligned with supplied values', async () => {
  const calls = [];
  const pgCompatibleClient = {
    async query(sql, values = []) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const requiredValueCount = placeholders.length ? Math.max(...placeholders) : 0;
      assert.equal(values.length, requiredValueCount);
      calls.push({ sql, values });
      if (sql.includes('FROM invoices')) return { rows: [] };
      if (sql.includes('FROM payment_transactions')) return { rows: [{ unallocated: 0 }] };
      throw new Error(`Unexpected finance audit query: ${sql}`);
    },
  };

  await getFinanceSummary({
    status: 'Partial',
    studentNumber: 'HAR049',
    year: 2026,
    month: 3,
  }, pgCompatibleClient);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].values.length, 4);
  assert.equal(calls[1].values.length, 3);
});

test('history, export, Parent and Admin remain ledger-aligned and preserve year-only/unavailable behavior', () => {
  const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const history = source('routes/enhanced-invoices.js');
  const parent = source('routes/parent.js');
  const parentUi = source('client/src/components/parent/ParentInvoices.js');
  const admin = source('routes/invoices.js');
  const adminDiscounts = source('routes/admin.js');
  const exportUi = source('client/src/components/payments/StudentPaymentExport.js');
  const historyExport = history;
  const studentAdmin = source('client/src/components/admin/StudentManagement.js');
  const adminApi = source('client/src/services/api.js');
  const servicePrices = source('routes/servicePrices.js');
  const migrationRunner = source('scripts/run-mini-phase1-finance-migration.js');
  const migrationVerifier = source('scripts/mini-phase1-finance-schema-verifier.js');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const dashboard = source('client/src/components/payments/PaymentDashboard.js');
  assert.match(history, /getStudentLedger\(student\.id\)/);
  assert.doesNotMatch(history, /SUM\(amount\)[\s\S]{0,200}payment_transactions/);
  assert.doesNotMatch(history, /ptByMonth/);
  assert.doesNotMatch(history, /Math\.max\(invoicePaid, ptPaid\)/);
  assert.match(history, /historicalPaymentReview/);
  assert.match(parent, /getStudentLedger/);
  assert.match(parentUi, /Enrollment only/);
  assert.match(parentUi, /line_items/);
  assert.match(admin, /buildInvoiceBreakdown/);
  assert.match(admin, /snapshot_unavailable_reason/);
  assert.match(historyExport, /Invoice Breakdown/);
  assert.match(historyExport, /Snapshot unavailable \(legacy invoice\)/);
  assert.match(exportUi, /student-payment-history/);
  assert.match(admin, /getFinanceSummary/);
  assert.match(adminDiscounts, /discount_assignment_created/);
  assert.match(adminDiscounts, /discount_assignment_deactivated/);
  assert.match(adminDiscounts, /executor: client/);
  assert.match(adminDiscounts, /required: true/);
  assert.match(studentAdmin, /Approved discount assignments/);
  assert.match(studentAdmin, /deactivateDiscountAssignment/);
  assert.match(adminApi, /createDiscountAssignment/);
  assert.match(servicePrices, /included_service_keys must be a non-empty array/);
  assert.match(migrationRunner, /--audit/);
  assert.match(migrationRunner, /BEGIN/);
  assert.match(migrationRunner, /COMMIT/);
  assert.match(migrationVerifier, /invoice_line_items_immutable/);
  assert.ok(packageJson.scripts['migrate:mini-phase1-finance']);
  assert.ok(packageJson.scripts['audit:mini-phase1-finance']);
  assert.deepEqual(parseInvoiceListQuery({ year: '2026' }).month, undefined);
  assert.match(dashboard, /Finance data is unavailable/);
});