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
  ]), ['tuition', 'transport', 'one_off']);
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
      { invoiceId: 2, amount: 1200, category: 'one_off' },
    ],
  });
  assert.deepEqual(result.allocations.map((allocation) => [allocation.invoiceId, allocation.amount]), [
    [1, 2350], [2, 1200], [null, 50],
  ]);
  assert.equal(state.paid.get(1), 2350);
  assert.equal(state.paid.get(2), 1200);
});

test('R4200 proof resolves tuition, transport and one-off selectors to authoritative lines', async () => {
  const { resolvePaymentProposals } = require('../routes/paymentProofs');
  const executor = {
    async query(sql, params) {
      if (!sql.includes('FROM invoices i')) throw new Error(`Unexpected query: ${sql}`);
      const selector = String(params.at(-1));
      if (selector === 'tuition') return { rows: [{
        id: 10, due_date: '2026-06-30', invoice_line_item_id: 101,
        service_key: 'tuition', line_amount: 2350, metadata: {},
        amount_due: 3000, amount_paid: 0,
        invoice_lines: [
          { line_type: 'charge', service_key: 'tuition', amount: 2350, is_included: false },
          { line_type: 'charge', service_key: 'transport', amount: 650, is_included: false },
        ],
        invoice_transactions: [],
      }] };
      if (selector === 'transport') return { rows: [{
        id: 10, due_date: '2026-06-30', invoice_line_item_id: 102,
        service_key: 'transport', line_amount: 650, metadata: {},
        amount_due: 3000, amount_paid: 0,
        invoice_lines: [
          { line_type: 'charge', service_key: 'tuition', amount: 2350, is_included: false },
          { line_type: 'charge', service_key: 'transport', amount: 650, is_included: false },
        ],
        invoice_transactions: [],
      }] };
      if (selector === '4') return { rows: [{
        id: 11, due_date: '2026-09-14', invoice_line_item_id: 103,
        service_key: 'one_off_fee', line_amount: 1200,
        metadata: { category: 'one_off', fee_id: 4, assignment_id: 88 },
        amount_due: 1200, amount_paid: 0,
        invoice_lines: [{
          line_type: 'charge', service_key: 'one_off_fee', amount: 1200, is_included: false,
          metadata: { category: 'one_off', fee_id: 4, assignment_id: 88 },
        }],
        invoice_transactions: [],
      }] };
      return { rows: [] };
    },
  };
  const proposals = await resolvePaymentProposals(executor, 7, [
    { service_key: 'tuition', category: 'tuition', amount: 2350 },
    { service_key: 'transport', category: 'transport', amount: 650 },
    { fee_id: 4, category: 'one_off:4', amount: 1200 },
  ]);
  assert.deepEqual(proposals, [
    { invoiceId: 10, invoiceLineItemId: 101, obligationId: null, amount: 2350, category: 'tuition', availableAmount: 2350 },
    { invoiceId: 10, invoiceLineItemId: 102, obligationId: null, amount: 650, category: 'transport', availableAmount: 650 },
    { invoiceId: 11, invoiceLineItemId: 103, obligationId: 4, assignmentId: 88, amount: 1200, category: 'one_off', availableAmount: 1200 },
  ]);
  assert.equal(proposals.reduce((sum, row) => sum + row.amount, 0), 4200);
});

test('missing assigned one-off line returns a reconciliation conflict', async () => {
  const { resolvePaymentProposals } = require('../routes/paymentProofs');
  const executor = {
    async query(sql) {
      if (sql.includes('FROM invoices i')) return { rows: [] };
      if (sql.includes('FROM student_fee_assignments')) return { rows: [{ id: 88 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => resolvePaymentProposals(executor, 7, [{ fee_id: 4, category: 'one_off:4', amount: 1200 }]),
    (error) => error.status === 409 && /requires reconciliation/.test(error.safeMessage),
  );
});

test('missing recurring line names the exact unavailable service safely', async () => {
  const { resolvePaymentProposals } = require('../routes/paymentProofs');
  const executor = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => resolvePaymentProposals(executor, 7, [{
      invoice_id: 20, invoice_line_item_id: 201, category: 'boarding', amount: 1600,
    }]),
    (error) => error.status === 422 &&
      error.obligationCategory === 'boarding' &&
      /Boarding has no outstanding charge/.test(error.safeMessage),
  );
});

test('settled category on an otherwise-open invoice returns a category-specific conflict', async () => {
  const { resolvePaymentProposals } = require('../routes/paymentProofs');
  const executor = {
    async query() {
      return { rows: [{
        id: 20, due_date: '2026-09-30', amount_due: 3000, amount_paid: 2350,
        invoice_line_item_id: 201, service_key: 'tuition', line_amount: 2350, metadata: {},
        invoice_lines: [
          { line_type: 'charge', service_key: 'tuition', amount: 2350, is_included: false },
          { line_type: 'charge', service_key: 'transport', amount: 650, is_included: false },
        ],
        invoice_transactions: [
          { amount: 2350, allocation_category: 'tuition', is_reversed: false },
        ],
      }] };
    },
  };
  await assert.rejects(
    () => resolvePaymentProposals(executor, 7, [{
      invoice_id: 20, invoice_line_item_id: 201, category: 'tuition', amount: 100,
    }]),
    (error) => error.status === 409 &&
      error.obligationCategory === 'tuition' &&
      /Tuition for 2026-09-30 is already fully paid/.test(error.safeMessage),
  );
});

test('resolver rejects an amount above the selected category balance before save', async () => {
  const { resolvePaymentProposals } = require('../routes/paymentProofs');
  const executor = {
    async query() {
      return { rows: [{
        id: 21, due_date: '2026-09-30', amount_due: 1600, amount_paid: 0,
        invoice_line_item_id: 211, service_key: 'boarding', line_amount: 1600, metadata: {},
        invoice_lines: [
          { line_type: 'charge', service_key: 'boarding', amount: 1600, is_included: false },
        ],
        invoice_transactions: [],
      }] };
    },
  };
  await assert.rejects(
    () => resolvePaymentProposals(executor, 7, [{
      invoice_id: 21, invoice_line_item_id: 211, category: 'boarding', amount: 1700,
    }]),
    (error) => error.status === 422 &&
      /Boarding has only R 1600.00 outstanding/.test(error.safeMessage),
  );
});

test('saved proposal validation rejects proof over-allocation and duplicate target over-cap', () => {
  const { validateResolvedPlan } = require('../routes/paymentProofs');
  assert.throws(
    () => validateResolvedPlan([
      { invoiceId: 20, invoiceLineItemId: 201, category: 'tuition', amount: 2350, availableAmount: 2350 },
      { invoiceId: 21, invoiceLineItemId: 211, category: 'boarding', amount: 1600, availableAmount: 1600 },
    ], 3000),
    (error) => error.status === 422 && /exceeds the payment amount/.test(error.safeMessage),
  );
  assert.throws(
    () => validateResolvedPlan([
      { invoiceId: 20, invoiceLineItemId: 201, category: 'tuition', amount: 1500, availableAmount: 2350 },
      { invoiceId: 20, invoiceLineItemId: 201, category: 'tuition', amount: 1000, availableAmount: 2350 },
    ], 3000),
    (error) => error.status === 422 && /duplicate allocation/.test(error.safeMessage),
  );
});

test('Parent payable services cannot be overwritten by enrollment flags or Service Pricing', () => {
  const parent = source('client/src/components/parent/ParentPaymentProof.js');
  assert.doesNotMatch(parent, /authFetch\('\/api\/service-prices'\)/);
  assert.doesNotMatch(parent, /is_boarder|uses_transport|uses_aftercare/);
  assert.match(parent, /setPayableServices\(\[\.\.\.byService\.values\(\)\]\)/);
  assert.match(parent, /invoice_line_item_id: line\.id/);
  assert.match(parent, /invoice_line_item_id: service\.invoice_line_item_id/);
});

test('receipt CSP permits private blob image previews without weakening other directives', () => {
  const server = source('server.js');
  assert.match(server, /imgSrc: \["'self'", "data:", "https:", "blob:"\]/);
  assert.match(server, /objectSrc: \["'none'"\]/);
  assert.doesNotMatch(server, /imgSrc:[^\n]*"\*"/);
  for (const file of [
    'client/src/components/parent/ParentPaymentProof.js',
    'client/src/components/admin/PendingPayments.js',
  ]) {
    const component = source(file);
    assert.match(component, /URL\.createObjectURL\(blob\)/);
    assert.match(component, /URL\.revokeObjectURL\(url\)/);
    assert.match(component, /receiptModal\.mime === 'application\/pdf'/);
    assert.match(component, /<img/);
  }
});

test('receipt validation accepts structurally valid WebP and rejects a spoofed RIFF header', () => {
  const { detectReceiptType, validateReceiptFile, isAllowedReceiptName } = require('../routes/paymentProofs');
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  webp.writeUInt32LE(10, 16);
  assert.equal(detectReceiptType(webp)?.mime, 'image/webp');
  assert.equal(validateReceiptFile({ buffer: webp, mimetype: 'image/webp' }).ok, true);
  assert.equal(isAllowedReceiptName({ originalname: 'proof.webp', mimetype: 'image/webp' }), true);
  const spoof = Buffer.from(webp);
  spoof.write('FAKE', 12, 'ascii');
  assert.equal(detectReceiptType(spoof), null);
});

test('selected allocation total cannot exceed the proof amount', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'TEST-7' }] };
      throw new Error(`Allocation should fail before invoice mutation: ${sql}`);
    },
  };
  await assert.rejects(
    () => allocatePayment(executor, {
      studentId: 7,
      amount: 2350,
      allocationProposals: [
        { invoiceId: 10, category: 'tuition', amount: 2350 },
        { invoiceId: 10, category: 'transport', amount: 650 },
      ],
    }),
    (error) => error.status === 422 && /exceeds the payment amount/.test(error.safeMessage),
  );
});

test('invoice settled between resolution and lock returns a typed conflict', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'TEST-7' }] };
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => allocatePayment(executor, {
      studentId: 7,
      amount: 650,
      allocationProposals: [{ invoiceId: 10, category: 'transport', amount: 650 }],
    }),
    (error) => error.status === 409 && /no longer outstanding/.test(error.safeMessage),
  );
});

test('Admin retarget resolution constrains the exact persisted invoice line', async () => {
  const { resolvePaymentProposals } = require('../routes/paymentProofs');
  let capturedSql = '';
  let capturedParams = [];
  const executor = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{
        id: 11, due_date: '2026-09-14', invoice_line_item_id: 103,
        service_key: 'one_off_fee', line_amount: 1200,
        metadata: { category: 'one_off', fee_id: 4, assignment_id: 88 },
        amount_due: 1200, amount_paid: 0,
        invoice_lines: [{
          line_type: 'charge', service_key: 'one_off_fee', amount: 1200, is_included: false,
          metadata: { category: 'one_off', fee_id: 4, assignment_id: 88 },
        }],
        invoice_transactions: [],
      }] };
    },
  };
  const proposals = await resolvePaymentProposals(executor, 7, [{
    invoice_id: 11, invoice_line_item_id: 103, fee_id: 4, category: 'one_off', amount: 1200,
  }]);
  assert.match(capturedSql, /li\.id = \$3/);
  assert.deepEqual(capturedParams.slice(0, 3), [7, 11, 103]);
  assert.equal(proposals[0].invoiceLineItemId, 103);
  assert.equal(proposals[0].availableAmount, 1200);
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
