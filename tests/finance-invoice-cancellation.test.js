const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  getStudentLedger,
  invoiceStatus,
  invoiceStatusExpression,
} = require('../services/financeLedger');
const parentRouter = require('../routes/parent');
const {
  execute,
  parseArgs,
  sha256,
  EXPECTED_INVOICE_IDS,
} = require('../scripts/cancel-september-grade2-test-invoices');

function candidateRows(status = 'Unpaid') {
  return EXPECTED_INVOICE_IDS.map((invoiceId, index) => {
    const feeId = index < 59 ? 4 : 5;
    const amount = feeId === 4 ? '1200.00' : '300.00';
    return {
      invoice_id: invoiceId,
      student_id: 2 + (index % 59),
      fee_id: feeId,
      line_item_id: 1 + index,
      fee_name: feeId === 4 ? 'grade 2 fees  for fun  day' : 'test im tierd',
      fee_amount: amount,
      fee_active: false,
      invoice_date: feeId === 4 ? '2026-09-24' : '2026-09-23',
      invoice_kind: null,
      invoice_source: null,
      finance_origin: null,
      invoice_amount: amount,
      amount_paid: '0.00',
      status,
      line_amount: amount,
      original_payment_ids: invoiceId === 11445 ? [2241] : [],
      live_payment_ids: [],
      reversal_ids: invoiceId === 11445 ? [2266] : [],
    };
  });
}

function cleanupPool() {
  const state = { status: 'Unpaid', audit: false, transaction: null };
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN') {
        state.transaction = { status: state.status, audit: state.audit };
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'COMMIT') {
        state.transaction = null;
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'ROLLBACK') {
        if (state.transaction) {
          state.status = state.transaction.status;
          state.audit = state.transaction.audit;
          state.transaction = null;
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('pg_get_constraintdef')) {
        return { rows: [{ definition: "CHECK (status IN ('Unpaid','Cancelled'))" }], rowCount: 1 };
      }
      if (sql.includes('SELECT i.id AS invoice_id')) {
        return { rows: candidateRows(state.status), rowCount: 118 };
      }
      if (sql.includes('FROM invoices WHERE id=11091')) {
        return {
          rows: [{
            id: 11091, student_id: 66, student_number: 'SYN049',
            amount_due: '2350.00', amount_paid: '0.00',
            due_date: '2026-09-30', status: 'Unpaid', description: null,
            invoice_kind: null, finance_origin: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("billing_period=DATE '2026-10-01'")) {
        return {
          rows: [{
            invoice_count: 316, total_due: '829725.00', total_paid: '0.00',
            min_invoice_id: 11473, max_invoice_id: 11788,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("role IN ('admin','super_admin')")) {
        return {
          rows: [{ id: 1, first_name: 'Synthetic', last_name: 'Admin', role: 'super_admin' }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE invoices") && sql.includes("status='Cancelled'")) {
        state.status = 'Cancelled';
        return { rows: EXPECTED_INVOICE_IDS.map((id) => ({ id })), rowCount: 118 };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        state.audit = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("action='september_test_invoices_cancelled'")) {
        return state.audit ? {
          rows: [{
            user_id: 1,
            user_role: 'super_admin',
            details: {
              invoice_ids: EXPECTED_INVOICE_IDS,
              preflight_sha256: params[1] || state.expectedHash,
            },
          }],
          rowCount: 1,
        } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('SET LOCAL') || sql.includes('pg_advisory_xact_lock') ||
          sql.includes("set_config('harmony.finance_command'") || sql.startsWith('LOCK TABLE')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected cleanup query: ${sql}`);
    },
    release() {},
  };
  return {
    state,
    client,
    pool: { async connect() { return client; } },
  };
}

test('Cancelled is a stable invoice status and is represented in SQL status projection', () => {
  assert.equal(invoiceStatus(1200, 0, 'Cancelled'), 'Cancelled');
  assert.match(invoiceStatusExpression('i'), /status = 'Cancelled'/);
  const migration = fs.readFileSync('migrations/finance_invoice_cancellation.sql', 'utf8');
  assert.match(migration, /'Cancelled'/);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE/i);
});

test('Admin ledger retains Cancelled invoices but excludes them from totals', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM users')) return {
        rows: [{
          id: 7, student_number: 'SYN007', first_name: 'Synthetic', last_name: 'Learner',
          is_boarder: false, uses_transport: false, uses_aftercare: false,
          has_sibling_discount: false, has_teacher_discount: false,
        }],
      };
      if (sql.includes('FROM invoices')) return {
        rows: [
          { id: 1, student_id: 7, amount_due: '1200.00', amount_paid: '0.00', due_date: '2026-09-24', status: 'Cancelled' },
          { id: 2, student_id: 7, amount_due: '2350.00', amount_paid: '0.00', due_date: '2026-09-30', status: 'Unpaid' },
        ],
      };
      if (sql.includes('FROM payment_transactions')) return { rows: [] };
      if (sql.includes('FROM service_prices')) return { rows: [] };
      if (sql.includes('FROM invoice_line_items')) return { rows: [] };
      throw new Error(`Unexpected ledger query: ${sql}`);
    },
  };
  const ledger = await getStudentLedger(7, executor);
  assert.equal(ledger.invoices.length, 2);
  assert.equal(ledger.invoices.find((invoice) => invoice.id === 1).status, 'Cancelled');
  assert.equal(ledger.invoices.find((invoice) => invoice.id === 1).counted_in_totals, false);
  assert.equal(ledger.totals.totalDue, 2350);
  assert.equal(ledger.totals.outstanding, 2350);

  const parent = parentRouter.parentSafeInvoiceLedger(ledger);
  assert.deepEqual(parent.invoices.map((invoice) => invoice.id), [2]);
});

test('Cancelled invoices are excluded from payable and allocation queries', () => {
  const payable = fs.readFileSync('services/payableObligations.js', 'utf8');
  const ledger = fs.readFileSync('services/financeLedger.js', 'utf8');
  const commands = fs.readFileSync('services/financeCommandService.js', 'utf8');
  const cleanup = fs.readFileSync('scripts/cancel-september-grade2-test-invoices.js', 'utf8');
  const enhanced = fs.readFileSync('routes/enhanced-invoices.js', 'utf8');
  assert.match(payable, /i\.status <> 'Cancelled'/);
  assert.match(ledger, /amount_paid < amount_due[\s\S]{0,100}status <> 'Cancelled'/);
  assert.match(ledger, /Payments linked to a Cancelled invoice cannot be reversed or edited/);
  assert.match(commands, /status NOT IN \('Carried Forward', 'Cancelled'\)/);
  assert.match(commands, /invoice\.status === 'Carried Forward' \|\| invoice\.status === 'Cancelled'/);
  assert.match(commands, /Cancelled invoices cannot be edited/);
  assert.match(commands, /Cancelled invoices cannot be carried forward/);
  assert.match(cleanup, /set_config\('harmony\.finance_command', 'canonical', true\)/);
  assert.match(enhanced, /\['Carried Forward', 'Cancelled'\]\.includes\(inv\.status\)/);
  assert.match(enhanced, /invoice\.status === 'Cancelled'\) return 'Cancelled'/);
  assert.match(enhanced, /inv\.status === 'Cancelled'\s*\?\s*0/);
});

test('cleanup CLI is strict', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  assert.throws(() => parseArgs(['--invoice=1']), /Usage/);
});

test('cleanup applies once, preserves protected invoices, and retries as verified no-op', async () => {
  const fixture = cleanupPool();
  const rows = candidateRows();
  const expectedHash = sha256(rows);
  fixture.state.expectedHash = expectedHash;
  const options = {
    apply: true,
    pool: fixture.pool,
    env: { FINANCE_SEPTEMBER_CLEANUP_ADMIN_USER_ID: '1' },
    expectedPreflightSha256: expectedHash,
    logger: () => {},
  };
  const applied = await execute(options);
  assert.equal(applied.applied, true);
  assert.equal(fixture.state.status, 'Cancelled');
  assert.equal(fixture.state.audit, true);
  const retry = await execute(options);
  assert.equal(retry.noop, true);
  assert.equal(retry.verified, true);
});

test('cleanup rolls back every cancellation and audit write after an injected failure', async () => {
  const fixture = cleanupPool();
  const expectedHash = sha256(candidateRows());
  fixture.state.expectedHash = expectedHash;
  await assert.rejects(() => execute({
    apply: true,
    pool: fixture.pool,
    env: { FINANCE_SEPTEMBER_CLEANUP_ADMIN_USER_ID: '1' },
    expectedPreflightSha256: expectedHash,
    injectedFailure: true,
    logger: () => {},
  }), /Injected cancellation failure/);
  assert.equal(fixture.state.status, 'Unpaid');
  assert.equal(fixture.state.audit, false);
});