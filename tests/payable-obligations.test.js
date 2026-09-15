const test = require('node:test');
const assert = require('node:assert/strict');
const { getPayableObligations } = require('../services/payableObligations');

function executorFor({ invoices, lines = [], transactions = [], pending = [], pendingFor }) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM invoices i')) return { rows: invoices };
      if (sql.includes('FROM invoice_line_items')) return { rows: lines };
      if (sql.includes('FROM payment_transactions pt')) return { rows: transactions };
      if (sql.includes('FROM pending_payments')) {
        return { rows: pendingFor ? pendingFor(params) : pending };
      }
      if (sql.includes('FROM student_one_off_fees')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('canonical obligations use persisted recurring and one-off lines, including archived fee debt', async () => {
  const obligations = await getPayableObligations(7, executorFor({
    invoices: [
      { id: 1, student_id: 7, amount_due: 2350, amount_paid: 950, due_date: '2026-04-30', description: 'Monthly invoice', reference_number: 'APR' },
      { id: 2, student_id: 7, amount_due: 1200, amount_paid: 0, due_date: '2026-09-23', description: 'Archived fee invoice', reference_number: 'FUN' },
      { id: 3, student_id: 7, amount_due: 300, amount_paid: 300, due_date: '2026-09-20', description: 'Test fee', reference_number: 'TEST' },
    ],
    lines: [
      { id: 11, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 2350, is_included: false, metadata: {} },
      { id: 21, invoice_id: 2, line_type: 'charge', service_key: 'one_off_fee', label: 'Fun Day', amount: 1200, is_included: false, metadata: { category: 'one_off', fee_id: 88, assignment_id: 91 } },
      { id: 31, invoice_id: 3, line_type: 'charge', service_key: 'one_off_fee', label: 'Test', amount: 300, is_included: false, metadata: { category: 'one_off', fee_id: 89, assignment_id: 92 } },
    ],
    transactions: [],
  }));

  assert.deepEqual(
    obligations.filter((item) => item.is_payable).map((item) => [item.category, item.invoice_id, item.amount_outstanding]),
    [['tuition', 1, 1400], ['one_off', 2, 1200]],
  );
  assert.equal(obligations.find((item) => item.invoice_id === 2).obligation_id, 'invoice:2:line:21');
  assert.equal(obligations.find((item) => item.invoice_id === 3).status, 'PAID');
});

test('legacy Tuition is selectable only with safe description; ambiguous debt reconciles and pending is reserved', async () => {
  const obligations = await getPayableObligations(7, executorFor({
    invoices: [
      { id: 10, student_id: 7, amount_due: 2350, amount_paid: 1400, due_date: '2026-04-30', description: 'School fees', reference_number: 'OLD-T' },
      { id: 11, student_id: 7, amount_due: 1600, amount_paid: 0, due_date: '2026-05-31', description: 'Legacy balance', reference_number: 'OLD-A' },
      { id: 12, student_id: 7, amount_due: 650, amount_paid: 0, due_date: '2026-06-30', description: 'Transport', reference_number: 'MODERN' },
    ],
    lines: [
      { id: 121, invoice_id: 12, line_type: 'charge', service_key: 'transport', label: 'Transport', amount: 650, is_included: false, metadata: {} },
    ],
    pending: [{
      id: 5,
      selected_obligations: [{ invoice_id: 12, invoice_line_item_id: 121, category: 'transport', amount: 650 }],
    }],
  }));

  const tuition = obligations.find((item) => item.invoice_id === 10);
  assert.equal(tuition.category, 'tuition');
  assert.equal(tuition.status, 'PARTIALLY_PAID');
  assert.equal(tuition.is_payable, true);

  const ambiguous = obligations.find((item) => item.invoice_id === 11);
  assert.equal(ambiguous.status, 'REQUIRES_RECONCILIATION');
  assert.equal(ambiguous.is_payable, false);

  const pending = obligations.find((item) => item.invoice_id === 12);
  assert.equal(pending.status, 'PENDING_REVIEW');
  assert.equal(pending.is_payable, false);
});

test('current proof reservation is excluded while a competing pending proof remains reserved', async () => {
  const pending = [
    { id: 100, selected_obligations: [{ invoice_id: 1, invoice_line_item_id: 11, category: 'tuition', amount: 100 }] },
    { id: 101, selected_obligations: [{ invoice_id: 1, invoice_line_item_id: 11, category: 'tuition', amount: 100 }] },
  ];
  const makeExecutor = () => executorFor({
    invoices: [{ id: 1, student_id: 7, amount_due: 100, amount_paid: 0, due_date: '2026-09-30', description: 'Monthly' }],
    lines: [{ id: 11, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 100, is_included: false, metadata: {} }],
    pendingFor: (params) => pending.filter((row) => Number(params[1] || 0) !== row.id),
  });
  assert.equal(
    (await getPayableObligations(7, makeExecutor(), { excludePaymentId: 100 }))[0].status,
    'PENDING_REVIEW',
  );
  assert.equal(
    (await getPayableObligations(7, makeExecutor(), { excludePaymentId: 100, asOf: '2026-09-15' }))[0].pending_amount,
    100,
  );
  // When the competing proof is absent, this proof's own reservation must not
  // hide the target from its allocation editor.
  const ownOnly = executorFor({
    invoices: [{ id: 1, student_id: 7, amount_due: 100, amount_paid: 0, due_date: '2026-09-30', description: 'Monthly' }],
    lines: [{ id: 11, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 100, is_included: false, metadata: {} }],
    pendingFor: (params) => pending
      .filter((row) => row.id === 100)
      .filter((row) => Number(params[1] || 0) !== row.id),
  });
  const result = await getPayableObligations(7, ownOnly, { excludePaymentId: 100 });
  assert.equal(result[0].status, 'UNPAID');
});

test('explicit empty approval records an unallocated transaction instead of oldest-unpaid allocation', async () => {
  const { applyPaymentToInvoices, approvalUnallocatedDisposition } = require('../routes/paymentProofs');
  const queries = [];
  const executor = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('SELECT student_number FROM users')) return { rows: [{ student_number: 'TEST-7' }] };
      if (sql.includes('INSERT INTO payment_transactions')) return { rows: [{ id: 900 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  assert.deepEqual(await applyPaymentToInvoices(executor, 7, 250, 55, 9, []), [900]);
  assert.match(queries.at(-1).sql, /VALUES \(NULL/);
  assert.doesNotMatch(queries.map((item) => item.sql).join('\n'), /UPDATE invoices/);
  assert.deepEqual(
    approvalUnallocatedDisposition([], 250, {
      unallocated_acknowledged: true,
      unallocated_reason: 'Parent payment is held for reconciliation',
    }).unallocatedAmount,
    250,
  );
  assert.throws(
    () => approvalUnallocatedDisposition([{ invoice_id: 1, amount: 100 }], 250, {}),
    (error) => error.status === 422,
  );
  assert.equal(
    approvalUnallocatedDisposition([{ invoice_id: 1, amount: 100 }], 250, {
      unallocated_acknowledged: 'true',
      unallocated_reason: 'Remaining funds are intentionally held',
    }).unallocatedAmount,
    150,
  );
});

test('correction method normalization preserves proof and bank-import provenance', () => {
  const { normalizeManualPaymentMethod } = require('../routes/enhanced-invoices');
  assert.equal(normalizeManualPaymentMethod('proof_of_payment'), 'proof_of_payment');
  assert.equal(normalizeManualPaymentMethod('bank_import'), 'bank_import');
  assert.equal(normalizeManualPaymentMethod('manual'), 'manual_entry');
});

test('non-empty explicit plans reject null and mixed amounts before any allocation side effect', async () => {
  const {
    parseSelectedObligations,
    resolvePaymentProposals,
    validateResolvedPlan,
  } = require('../routes/paymentProofs');
  assert.deepEqual(parseSelectedObligations([]), [], 'empty selection remains deliberate unallocated mode');
  const nullTarget = [{ invoice_id: 1, category: 'tuition' }];
  const mixedTargets = [
    { invoice_id: 1, category: 'tuition', amount: 100 },
    { invoice_id: 2, category: 'transport', amount: null },
  ];
  assert.throws(
    () => parseSelectedObligations(JSON.stringify(nullTarget)),
    (error) => error.status === 422 && /finite positive amount/.test(error.message),
  );
  assert.throws(
    () => parseSelectedObligations(JSON.stringify(mixedTargets)),
    (error) => error.status === 422 && /finite positive amount/.test(error.message),
  );

  let queried = false;
  await assert.rejects(
    () => resolvePaymentProposals({
      query: async () => { queried = true; return { rows: [] }; },
    }, 7, mixedTargets),
    (error) => error.status === 422 && /finite positive amount/.test(error.safeMessage),
  );
  assert.equal(queried, false, 'invalid explicit plans must not query or allocate');
  assert.throws(
    () => validateResolvedPlan([{ invoiceId: 1, category: 'tuition', amount: null }], 100),
    (error) => error.status === 422,
  );
});