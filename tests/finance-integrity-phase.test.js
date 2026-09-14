const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  invoiceAllocationCategories,
  allocatePayment,
} = require('../services/financeLedger');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('allocation categories distinguish recurring services and one-off obligations', () => {
  assert.deepEqual(invoiceAllocationCategories([
    { line_type: 'charge', service_key: 'tuition', amount: 2350, is_included: false },
    { line_type: 'charge', service_key: 'transport', amount: 650, is_included: false },
    { line_type: 'charge', service_key: 'one_off_fee', amount: 1200, is_included: false,
      metadata: { category: 'one_off', fee_id: 44 } },
    { line_type: 'charge', service_key: 'boarding', amount: 0, is_included: true },
  ]), ['tuition', 'transport', 'one_off:44']);
});

test('proposed allocations stay category-isolated and leave excess as credit', async () => {
  const state = { paid: new Map(), nextId: 1, transactions: [] };
  const executor = {
    async query(sql, params = []) {
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'TEST-7' }] };
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        const ids = params[2] || [1, 2];
        return { rows: ids.map((id) => ({
          id, student_number: 'TEST-7', reference_number: `INV-${id}`,
          amount_due: id === 1 ? 2350 : 1200,
          amount_paid: state.paid.get(id) || 0,
          outstanding_balance: (id === 1 ? 2350 : 1200) - (state.paid.get(id) || 0),
          due_date: id === 1 ? '2026-06-30' : '2026-06-15',
        })) };
      }
      if (sql.includes('FROM invoice_line_items')) return {
        rows: [
          { invoice_id: 1, line_type: 'charge', service_key: 'tuition', amount: 2350, is_included: false },
          { invoice_id: 2, line_type: 'charge', service_key: 'one_off_fee', amount: 1200, is_included: false,
            metadata: { category: 'one_off', fee_id: 44 } },
        ],
      };
      if (sql.includes('FROM payment_transactions pt')) return { rows: [] };
      if (sql.includes('UPDATE invoices')) {
        state.paid.set(Number(params[2]), Number(params[0]));
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO payment_transactions')) {
        const id = state.nextId++;
        state.transactions.push({ id, invoiceId: params[0], amount: Number(params[4]) });
        return { rows: [{ id }] };
      }
      throw new Error(`Unexpected allocator query: ${sql}`);
    },
  };

  const result = await allocatePayment(executor, {
    studentId: 7,
    amount: 3600,
    paymentDate: '2026-06-20',
    paymentMethod: 'proof_of_payment',
    reference: 'PROOF-TEST',
    allocationProposals: [
      { invoiceId: 1, amount: 2350, category: 'tuition' },
      { invoiceId: 2, amount: 1200, category: 'one_off:44' },
    ],
  });
  assert.deepEqual(result.allocations.map((allocation) => [allocation.invoiceId, allocation.amount]), [
    [1, 2350], [2, 1200], [null, 50],
  ]);
  assert.equal(state.paid.get(1), 2350);
  assert.equal(state.paid.get(2), 1200);
});

test('one proof can allocate tuition and transport separately on the same invoice', async () => {
  const transactions = [];
  const executor = {
    async query(sql, params = []) {
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'TEST-7' }] };
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) return { rows: [{
        id: 1, student_number: 'TEST-7', reference_number: 'INV-1',
        amount_due: 3000, amount_paid: 0, outstanding_balance: 3000, due_date: '2026-06-30',
      }] };
      if (sql.includes('FROM invoice_line_items')) return { rows: [
        { invoice_id: 1, line_type: 'charge', service_key: 'tuition', amount: 2350, is_included: false },
        { invoice_id: 1, line_type: 'charge', service_key: 'transport', amount: 650, is_included: false },
      ] };
      if (sql.includes('FROM payment_transactions pt')) return { rows: [] };
      if (sql.includes('UPDATE invoices')) return { rows: [] };
      if (sql.includes('INSERT INTO payment_transactions')) {
        transactions.push({ category: params[11], amount: Number(params[4]) });
        return { rows: [{ id: transactions.length }] };
      }
      throw new Error(`Unexpected allocator query: ${sql}`);
    },
  };
  const result = await allocatePayment(executor, {
    studentId: 7, amount: 3000, paymentDate: '2026-06-30',
    allocationProposals: [
      { invoiceId: 1, amount: 2350, category: 'tuition' },
      { invoiceId: 1, amount: 650, category: 'transport' },
    ],
  });
  assert.deepEqual(result.allocations.map((row) => [row.category, row.amount]), [
    ['tuition', 2350], ['transport', 650],
  ]);
  assert.deepEqual(transactions, [
    { category: 'tuition', amount: 2350 },
    { category: 'transport', amount: 650 },
  ]);
});

test('approved discounts reduce tuition net without reducing transport', () => {
  const { invoiceCategoryBalances } = require('../services/financeLedger');
  assert.deepEqual(invoiceCategoryBalances([
    { line_type: 'charge', service_key: 'tuition', amount: 2350 },
    { line_type: 'charge', service_key: 'transport', amount: 650 },
    { line_type: 'discount', service_key: 'tuition', amount: 850 },
  ], 2150), [
    { category: 'tuition', amount: 1500 },
    { category: 'transport', amount: 650 },
  ]);
});

test('finance multi-allocation migration is additive and payment events are immutable', () => {
  const migration = source('migrations/finance_multi_allocation.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS selected_obligations JSONB/);
  assert.match(migration, /invoice_line_items_one_off_assignment_idx/);
  assert.match(migration, /payment_transactions_immutable/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+payment_transactions/i);
  const fees = source('routes/studentFees.js');
  assert.match(fees, /\/:id\/reconciliation/);
  assert.match(fees, /confirmed_collected/);
  assert.match(fees, /invoice_line_items/);
  assert.match(source('routes/invoices.js'), /Destructive invoice clearing is disabled/);
  assert.doesNotMatch(source('routes/invoices.js'), /DELETE FROM payment_transactions/);
});
