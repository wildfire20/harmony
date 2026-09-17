const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FinanceCommandError,
  verifyLedger,
  withTransaction,
  generateMonthlyInvoices,
  verifyExistingCanonicalMonthlyInvoice,
} = require('../services/financeCommandService');

const commandSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'financeCommandService.js'),
  'utf8',
);

test('finance command service owns transaction boundaries and canonical locks', () => {
  assert.match(commandSource, /BEGIN ISOLATION LEVEL \$\{isolationLevel\}/);
  assert.match(commandSource, /await client\.query\('COMMIT'\)/);
  assert.match(commandSource, /await client\.query\('ROLLBACK'\)/);
  assert.match(commandSource, /set_config\('harmony\.finance_command', 'canonical', true\)/);
  assert.match(commandSource, /acquireInvoiceObligationLocks/);
  assert.match(commandSource, /validateExactObligations/);
  assert.match(commandSource, /logAudit\(\{/);
  assert.match(commandSource, /async function generateMonthlyInvoices/);
  assert.match(commandSource, /harmony-monthly-invoices/);
  assert.match(commandSource, /invoice_line_items/);
  assert.match(commandSource, /snapshot_source: 'monthly_billing_command'/);
  assert.doesNotMatch(commandSource, /legacyCompatibility/);
  assert.match(commandSource, /No canonical service enrollment exists/);
  assert.match(commandSource, /requires reconciliation/);
});

test('withTransaction commits successful commands and rolls back failures', async () => {
  const calls = [];
  const executor = {
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    },
  };
  assert.equal(await withTransaction(async (client) => client === executor ? 'ok' : 'bad', executor), 'ok');
  assert.deepEqual(calls, [
    `SELECT set_config('harmony.finance_command', 'canonical', true)`,
  ]);
});

test('repeatable-read isolation is established before canonical monthly work', async () => {
  const calls = [];
  const executor = {
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    },
  };
  await withTransaction(async () => 'ok', executor, 'REPEATABLE READ');
  assert.equal(calls[0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(
    calls[1],
    `SELECT set_config('harmony.finance_command', 'canonical', true)`,
  );
  assert.ok(commandSource.includes("}, options.executor, 'REPEATABLE READ');"));
});

test('canonical monthly generation rejects pre-October 2026 before financial writes', async () => {
  for (const [year, month] of [[2026, 9], [2025, 12]]) {
    const calls = [];
    await assert.rejects(
      generateMonthlyInvoices({
        year,
        month,
        executor: {
          async query(sql) {
            calls.push(sql);
            return { rows: [] };
          },
        },
      }),
      (error) => error instanceof FinanceCommandError &&
        error.status === 409 &&
        /starts in 2026-10/.test(error.safeMessage),
    );
    assert.deepEqual(calls, []);
  }
});

test('final ledger verification rejects stale invoice status', async () => {
  const executor = {
    async query(sql) {
      if (/FROM invoices/.test(sql)) {
        return { rows: [{ id: 4, amount_due: '100.00', amount_paid: '25.00', status: 'Paid' }] };
      }
      return { rows: [] };
    },
  };
  await assert.rejects(
    verifyLedger(executor, [4]),
    (error) => error instanceof FinanceCommandError && error.status === 409,
  );
});

test('canonical monthly conflicts require verified immutable snapshots', async () => {
  const invoice = {
    id: 12,
    billing_period: '2029-02-01',
    invoice_kind: 'monthly',
    invoice_source: 'monthly_generation',
    finance_origin: 'canonical',
    amount_due: '90.00',
  };
  const executor = {
    async query(sql) {
      assert.match(sql, /invoice_line_items/);
      return {
        rows: [{
          id: 44,
          line_type: 'charge',
          amount: '90.00',
          is_included: false,
          metadata: {
            snapshot_source: 'monthly_billing_command',
            billing_period: '2029-02',
          },
        }],
      };
    },
  };
  assert.equal(
    (await verifyExistingCanonicalMonthlyInvoice(executor, invoice, '2029-02-01')).id,
    12,
  );
  await assert.rejects(
    verifyExistingCanonicalMonthlyInvoice(executor, {
      ...invoice, finance_origin: 'legacy',
    }, '2029-02-01'),
    (error) => error instanceof FinanceCommandError && error.status === 409,
  );
});