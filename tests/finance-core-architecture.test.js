const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  configuredBillableLines,
} = require('../services/financeLedger');
const {
  periodBounds,
  listEffectiveEnrollments,
  createEnrollment,
} = require('../services/serviceEnrollmentRepository');
const {
  isLegacyCompatibleInvoice,
} = require('../services/payableObligations');
const { REQUIRED_TABLES, runFinanceCoreAudit } = require('../scripts/audit-finance-core');

test('finance-core migration is additive, idempotent, and does not backfill history', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'finance_core_architecture.sql'),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS service_enrollments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS payment_proof_allocation_proposals/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS payment_proof_allocations/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS billing_period DATE/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS finance_origin VARCHAR/);
  assert.match(sql, /invoices_canonical_monthly_identity_idx/);
  assert.match(sql, /invoice_line_items_classification_append/);
  assert.match(sql, /CREATE TRIGGER invoice_line_items_immutable/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON invoice_line_items/);
  assert.match(sql, /current_setting\('harmony\.finance_command', true\)/);
  assert.match(sql, /invoices_projection_context/);
  assert.match(sql, /CREATE TRIGGER payment_transactions_immutable/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON payment_transactions/);
  assert.match(sql, /invoices_projection_context/);
  assert.match(sql, /harmony\.finance_command/);
  assert.match(sql, /duplicate canonical monthly invoices/);
  assert.match(sql, /legacy_classification_correction/);
  assert.doesNotMatch(sql, /'public\./);
  assert.match(sql, /BEGIN;[\s\S]*pg_advisory_xact_lock/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /EXCLUDE USING gist/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /validate_proof_allocation_consistency/);
  assert.match(sql, /ON CONFLICT \(schema_key\) DO UPDATE/);
  assert.match(sql, /VALUES \('finance_core_architecture', 2\)/);
  assert.match(sql, /REFERENCES invoice_line_items\(id\)/);
  assert.match(sql, /REFERENCES student_fee_assignments\(id\)/);
  assert.doesNotMatch(sql, /\bUPDATE\s+(users|invoices|payment_transactions)\b/i);
  assert.deepEqual(REQUIRED_TABLES, [
    'finance_schema_versions',
    'service_enrollments',
    'payment_proof_allocation_proposals',
    'payment_proof_allocations',
  ]);
});

test('effective enrollment period bounds include an enrollment crossing the month', async () => {
  assert.deepEqual(periodBounds('2027-02'), {
    start: '2027-02-01',
    end: '2027-02-28',
  });
  let received;
  const executor = {
    async query(sql, values) {
      received = { sql, values };
      return { rows: [{ student_id: 7, service_key: 'transport', state: 'active' }] };
    },
  };
  const rows = await listEffectiveEnrollments(7, '2027-02', executor);
  assert.equal(rows[0].service_key, 'transport');
  assert.deepEqual(received.values, [7, '2027-02-28', '2027-02-01']);
  assert.match(received.sql, /effective_start <=/);
  assert.match(received.sql, /effective_end IS NULL OR effective_end >=/);
});

test('new billing lines use persisted effective enrollments, not current flags', () => {
  const prices = [
    { service_key: 'tuition', label: 'Tuition', amount: 2350, billing_mode: 'standalone' },
    { service_key: 'boarding', label: 'Boarding', amount: 1600, billing_mode: 'standalone' },
    { service_key: 'transport', label: 'Transport', amount: 650, billing_mode: 'standalone' },
    { service_key: 'aftercare', label: 'Aftercare', amount: 550, billing_mode: 'standalone' },
  ];
  const lines = configuredBillableLines(
    { is_boarder: true, uses_transport: true, uses_aftercare: true },
    prices,
    [{ service_key: 'tuition', state: 'active' }, { service_key: 'transport', state: 'active' }],
  );
  assert.deepEqual(lines.map((line) => line.service_key), ['tuition', 'transport']);
});

test('legacy payable compatibility uses the persisted invoice marker', () => {
  assert.equal(isLegacyCompatibleInvoice({ due_date: '2035-12-31', finance_origin: null }), true);
  assert.equal(isLegacyCompatibleInvoice({ due_date: '2010-01-01', finance_origin: 'unknown' }), true);
  assert.equal(isLegacyCompatibleInvoice({ due_date: '2010-01-01', finance_origin: 'canonical' }), false);
  assert.equal(isLegacyCompatibleInvoice(
    { finance_origin: 'legacy' },
    { allowLegacyCompatibility: false },
  ), false);
});

test('enrollment repository rejects historical guessing and is idempotent by identity', async () => {
  assert.throws(
    () => periodBounds('2027-13'),
    /billing period must use YYYY-MM/,
  );
  const calls = [];
  const executor = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/WHERE idempotency_key/.test(sql) || (
        /FROM service_enrollments\s+WHERE student_id/.test(sql) && /LIMIT 1/.test(sql)
      )) {
        return { rows: [] };
      }
      if (/INSERT INTO service_enrollments/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [{ id: 3, student_id: 2, service_key: 'tuition', effective_start: '2027-01-01' }] };
    },
  };
  const enrollment = await createEnrollment({
    studentId: 2,
    serviceKey: 'tuition',
    effectiveStart: '2027-01-01',
    idempotencyKey: 'enroll-2-2027-01',
  }, executor);
  assert.equal(enrollment.id, 3);
  assert.equal(calls.some((call) => /ON CONFLICT \(student_id, service_key, effective_start\)/.test(call.sql)), true);
});

test('finance-core audit contract is read-only', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'audit-finance-core.js'),
    'utf8',
  );
  assert.match(source, /beginVerifiedReadonlySession/);
  assert.match(source, /finance_audit_optional_/);
  assert.match(source, /ROLLBACK TO SAVEPOINT/);
  assert.match(source, /ROLLBACK/);
  assert.match(source, /header_vs_ledger/);
  assert.match(source, /uncategorized_allocations/);
  assert.match(source, /ambiguous_proposals/);
  assert.match(source, /invalid_reversals/);
  assert.match(source, /missing_canonical_service_snapshots/);
  assert.match(source, /missing_canonical_monthly_invoice/);
  assert.match(source, /missing_enrolled_service_snapshot/);
  assert.match(source, /canonical_invoice_service_snapshots/);
  assert.match(source, /effective_start/);
  assert.match(source, /included_in/);
  assert.match(source, /bundle_key IS NOT NULL/);
  assert.match(source, /export_anomalies/);
  assert.match(source, /finance_origin = 'canonical'/);
  assert.match(source, /canonicalInvoiceIdentity/);
  assert.match(source, /classificationCorrectionIntegrity/);
  assert.match(source, /payment_transactions_immutable/);
  assert.match(source, /invoices_projection_context/);
  assert.match(source, /finance_core_architecture@2/);
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE TABLE)\b/);
  assert.equal(typeof runFinanceCoreAudit, 'function');
});

test('finance-core preflight and deployment order are explicit and read-only', () => {
  const preflight = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'preflight-finance-core.js'),
    'utf8',
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const order = fs.readFileSync(path.join(__dirname, '..', 'FINANCE_CORE_DEPLOYMENT_ORDER.md'), 'utf8');
  const readonlyDatabase = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'finance-readonly-database.js'),
    'utf8',
  );
  assert.match(preflight, /beginVerifiedReadonlySession/);
  assert.match(preflight, /targetTables/);
  assert.match(preflight, /hasCanonicalIdentityColumns/);
  assert.match(preflight, /canonicalMonthlyDuplicates/);
  assert.match(preflight, /overlapping_active_enrollment/);
  assert.doesNotMatch(preflight, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE TABLE)\b/);
  assert.equal(packageJson.scripts['preflight:finance-core'], 'node scripts/preflight-finance-core.js');
  assert.match(readonlyDatabase, /FINANCE_READONLY_DATABASE_URL is required/);
  assert.match(readonlyDatabase, /BEGIN READ ONLY/);
  assert.match(readonlyDatabase, /SHOW transaction_read_only/);
  assert.match(readonlyDatabase, /current_database\(\)/);
  assert.doesNotMatch(readonlyDatabase, /process\.env\.(DATABASE_URL|PGHOST|PGDATABASE|PGUSER|PGPASSWORD)/);
  assert.doesNotMatch(preflight, /config\/database/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'audit-finance-core.js'), 'utf8'),
    /config\/database/,
  );
  assert.match(order, /FINANCE_READONLY_DATABASE_URL/);
  assert.match(order, /Production pre-migration preflight/i);
  assert.match(order, /Missing Finance Core target tables and columns are\s+expected/i);
  assert.match(order, /backup\/checkpoint/i);
  assert.match(order, /operator-run migration/i);
  assert.match(order, /post-migration audit/i);
  assert.match(order, /Only after the post-migration audit is clean may the release be deployed/i);
});

test('startup only observes finance readiness and never invokes finance initialization', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /checkFinanceCoreReadiness/);
  assert.match(server, /app\.locals\.financeCoreReady/);
  assert.doesNotMatch(server, /await initializeInvoiceSystem\(\)/);
  assert.doesNotMatch(server, /await initializeEnhancedPaymentSystem\(\)/);
});