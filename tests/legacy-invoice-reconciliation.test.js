const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const db = require('../config/database');
const invoiceRouter = require('../routes/invoices');
const paymentProofRouter = require('../routes/paymentProofs');
const { buildInvoiceBreakdown, getStudentLedger } = require('../services/financeLedger');
const { getPayableObligations, pendingMatches } = require('../services/payableObligations');
const { resolveLegacyClassification } = require('../services/legacyClassification');

const invoiceHandler = invoiceRouter.stack
  .find((layer) => layer.route?.path === '/:id/classify-legacy')
  .route.stack.at(-1).handle;

const routeSource = fs.readFileSync('routes/paymentProofs.js', 'utf8');
const invoiceSource = fs.readFileSync('routes/invoices.js', 'utf8');
const payableSource = fs.readFileSync('services/payableObligations.js', 'utf8');
const lockSource = fs.readFileSync('services/invoiceObligationLocks.js', 'utf8');
const lineageSource = fs.readFileSync('services/carryForwardLineage.js', 'utf8');

const invoice = {
  id: 44, student_id: 7, student_number: 'ST-7', amount_due: '2350.00',
  amount_paid: '1400.00', outstanding_balance: '950.00',
  overpaid_amount: '0.00', due_date: '2026-04-30',
  reference_number: 'APR-44', description: 'Historical school fees', status: 'Partial',
};

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function classificationClient({
  lines = [], pending = [], auditFails = false, invoiceRow = invoice, lineage = false,
} = {}) {
  const queries = [];
  const state = { inserted: [], committed: false, rolledBack: false };
  return {
    state,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/^BEGIN/.test(sql)) return { rows: [] };
      if (/^COMMIT/.test(sql)) { state.committed = true; return { rows: [] }; }
      if (/^ROLLBACK/.test(sql)) { state.rolledBack = true; return { rows: [] }; }
      if (/information_schema\.columns/.test(sql)) {
        return { rows: lineage ? [{ column_name: 'carried_forward_to_invoice_id' }] : [] };
      }
      if (/carried_forward_to_invoice_id IS NOT NULL/.test(sql)) {
        return { rows: lineage ? [{ id: 44 }] : [] };
      }
      if (/FROM invoices/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: [invoiceRow] };
      if (/FROM invoice_line_items/.test(sql) && /SELECT id, line_type/.test(sql)) {
        return { rows: lines };
      }
      if (/FROM invoice_line_items/.test(sql)) {
        return { rows: state.inserted.length ? [{
          id: 901, invoice_id: 44, line_type: 'charge', service_key: 'tuition',
          label: 'Tuition', description: invoice.description, amount: 2350,
          is_included: false, metadata: state.inserted[0].params[5] ? JSON.parse(state.inserted[0].params[5]) : {},
        }] : lines };
      }
      if (/FROM payment_transactions/.test(sql)) {
        return { rows: [{ id: 700, amount: 1400, allocation_category: null, is_reversed: false }] };
      }
      if (/INSERT INTO invoice_line_items/.test(sql)) {
        state.inserted.push({ sql, params });
        return { rows: [{
          id: 901, invoice_id: 44, line_type: 'charge', service_key: params[1],
          label: params[2], description: params[3], amount: params[4],
          metadata: JSON.parse(params[5]),
        }] };
      }
      if (/FROM invoices/.test(sql)) return { rows: [invoiceRow] };
      if (/FROM users u/.test(sql)) return { rows: [{ id: 7, student_number: 'ST-7', first_name: 'Learner', last_name: 'One' }] };
      if (/FROM service_prices/.test(sql)) return { rows: [] };
      if (/FROM pending_payments/.test(sql)) return { rows: pending };
      if (/INSERT INTO audit_logs/.test(sql)) {
        if (auditFails) throw new Error('audit unavailable');
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
}

async function classify({
  body = { category: 'tuition', reason: 'Confirmed by archived school records.' },
  lines, pending, auditFails = false, invoiceRow = invoice, lineage = false,
} = {}) {
  const client = classificationClient({ lines, pending, auditFails, invoiceRow, lineage });
  const previous = db.pool.connect;
  db.pool.connect = async () => client;
  const res = response();
  try {
    await invoiceHandler({
      params: { id: '44' },
      body,
      user: { id: 3, first_name: 'A', last_name: 'Admin', role: 'admin' },
      headers: {},
      socket: {},
    }, res);
  } finally {
    db.pool.connect = previous;
  }
  return { res, client };
}

test('classification source contract is admin-only and distinct from missing-charge creation', () => {
  assert.ok(invoiceSource.includes("router.post('/:id/classify-legacy', ["));
  assert.match(invoiceSource, /classify-legacy[\s\S]*authorize\('admin', 'super_admin'\)/);
  assert.match(invoiceSource, /LEGACY_INVOICE_CLASSIFIED/);
  assert.match(invoiceSource, /FROM invoices i[\s\S]*?FOR UPDATE/);
  assert.match(invoiceSource, /alreadyClassified \|\| linesResult\.rows\.length > 0/);
  assert.match(invoiceSource, /status\(409\)/);
  assert.match(invoiceSource, /acquireInvoiceObligationLocks/);
  assert.match(routeSource, /acquireInvoiceObligationLocks/);
  assert.match(lockSource, /harmony:invoice-obligation:v1/);
  assert.match(lineageSource, /invoice_carry_forward_links/);
  assert.match(lineageSource, /carry_forward_source/);
  assert.match(invoiceSource, /FROM invoice_line_items[\s\S]*?ORDER BY id/);
  assert.match(invoiceSource, /linesResult\.rows\.length > 0/);
  assert.match(invoiceSource, /INSERT INTO invoice_line_items/);
  assert.doesNotMatch(invoiceSource.slice(invoiceSource.indexOf("router.post('/:id/classify-legacy'"),
    invoiceSource.indexOf("router.post('/manual-arrears'")), /INSERT INTO invoices/);
});

test('ambiguous legacy invoice classifies with one authoritative line, audit, and unchanged financial evidence', async () => {
  const { res, client } = await classify({ lines: [] });
  assert.equal(res.statusCode, 200);
  assert.equal(client.state.inserted.length, 1);
  assert.equal(client.state.inserted[0].params[0], 44);
  assert.equal(Number(client.state.inserted[0].params[4]), Number(invoice.amount_due));
  assert.equal(client.state.inserted[0].params[5].includes('legacy_invoice_reconciliation'), true);
  assert.equal(client.queries.filter((q) => /INSERT INTO audit_logs/.test(q.sql)).length, 1);
  assert.equal(client.state.committed, true);
  assert.equal(client.state.rolledBack, false);
  assert.equal(res.body.financial_invariants.authoritative_outstanding_before, 950);
  assert.equal(res.body.financial_invariants.payable_outstanding_after, 950);
  assert.equal(res.body.invoice.amount_due, invoice.amount_due);
  assert.equal(res.body.invoice.amount_paid, invoice.amount_paid);
});

test('every pre-existing line rejects before insertion, and invalid category/reason returns 422', async () => {
  const withDiscount = await classify({
    lines: [{ id: 10, line_type: 'discount', service_key: 'tuition', amount: 100, metadata: {} }],
  });
  assert.equal(withDiscount.res.statusCode, 409);
  assert.equal(withDiscount.client.state.inserted.length, 0);
  assert.equal(withDiscount.client.state.committed, false);
  assert.equal(withDiscount.client.state.rolledBack, true);

  const invalid = await classify({ body: { category: 'current_price', reason: 'short' }, lines: [] });
  assert.equal(invalid.res.statusCode, 422);
  assert.equal(invalid.client.queries.length, 0);
});

test('classification conflicts with active pending proof or conflicting payment allocation', async () => {
  const pending = await classify({
    lines: [],
    pending: [{ id: 88, selected_obligations: [{ invoice_id: 44, category: 'tuition', amount: 100 }] }],
  });
  assert.equal(pending.res.statusCode, 409);
  assert.equal(pending.client.state.inserted.length, 0);

  // The mock's allocation rows can expose a conflicting category without any
  // invoice mutation; the production query excludes reversals.
  const client = classificationClient({ lines: [] });
  const originalQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (/FROM payment_transactions/.test(sql) && /allocation_category/.test(sql)) {
      return { rows: [
        { id: 1, amount: 500, allocation_category: 'boarding', is_reversed: false },
        { id: 2, amount: 500, allocation_category: 'transport', is_reversed: false },
      ] };
    }
    return originalQuery(sql, params);
  };
  const previous = db.pool.connect;
  db.pool.connect = async () => client;
  const res = response();
  try {
    await invoiceHandler({
      params: { id: '44' }, body: { category: 'tuition', reason: 'Records confirm tuition.' },
      user: { id: 3, first_name: 'A', last_name: 'Admin', role: 'admin' },
      headers: {}, socket: {},
    }, res);
  } finally {
    db.pool.connect = previous;
  }
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /conflicting payment allocation/);
  assert.equal(client.state.inserted.length, 0);
});

test('category-only historical proposals are ambiguous and exact invoice selectors reserve only their invoice', async () => {
  const obligation = {
    obligation_id: 'invoice:44:line:901',
    invoice_id: 44,
    invoice_line_item_id: 901,
    category: 'tuition',
  };
  assert.equal(pendingMatches({ category: 'tuition', amount: 2350 }, obligation), false);
  assert.equal(pendingMatches({ invoice_id: 44, category: 'tuition', amount: 950 }, obligation), true);
  assert.equal(pendingMatches({ invoice_id: 45, category: 'tuition', amount: 950 }, obligation), false);

  const unrelatedAmbiguous = await classify({
    lines: [],
    pending: [{ id: 88, selected_obligations: [{ category: 'tuition', amount: 2350 }] }],
  });
  assert.equal(unrelatedAmbiguous.res.statusCode, 200);
  assert.equal(unrelatedAmbiguous.client.state.committed, true);
});

test('append-only correction preserves original evidence and changes only effective classification', async () => {
  const initial = {
    id: 901, invoice_id: 44, line_type: 'charge', service_key: 'boarding',
    label: 'Boarding', amount: 2350, is_included: false,
    metadata: {
      source: 'legacy_invoice_reconciliation', legacy_reconciliation: true,
      category: 'boarding', actor_id: 3, classified_at: '2026-09-15T10:00:00.000Z',
    },
  };
  const correction = {
    id: 902, invoice_id: 44, line_type: 'charge',
    service_key: 'tuition', label: 'Tuition', amount: 0, is_included: true,
    metadata: {
      source: 'legacy_classification_correction', correction_type: 'category',
      target_line_id: 901, previous_category: 'boarding', new_category: 'tuition',
      actor_id: 4, corrected_at: '2026-09-15T11:00:00.000Z',
    },
  };
  const resolved = resolveLegacyClassification([initial, correction]);
  assert.equal(resolved.category, 'tuition');
  assert.equal(resolved.lines.find((line) => line.id === 901).service_key, 'tuition');
  assert.equal(resolved.lines.find((line) => line.id === 902).line_type, 'charge');
  assert.equal(initial.service_key, 'boarding');
  assert.equal(correction.amount, 0);

  const breakdown = buildInvoiceBreakdown(invoice, [initial, correction]);
  assert.equal(breakdown.amount_due, 2350);
  assert.equal(breakdown.amount_paid, 1400);
  assert.equal(breakdown.outstanding_balance, 950);
  assert.equal(breakdown.gross_charges, 2350);
  assert.equal(breakdown.legacy_reconciliation.category, 'tuition');
  assert.equal(breakdown.line_items.filter((line) => line.line_type === 'charge').length, 1);
  assert.equal(breakdown.line_items.filter((line) => line.line_type === 'classification_correction').length, 1);

  assert.match(invoiceSource, /correct-legacy-classification/);
  assert.match(invoiceSource, /CORRECTION_SOURCE/);
  const correctionRoute = invoiceSource.slice(
    invoiceSource.indexOf("router.post('/:id/correct-legacy-classification'"),
    invoiceSource.indexOf("router.post('/manual-arrears'"),
  );
  assert.doesNotMatch(correctionRoute, /UPDATE invoice_line_items|DELETE FROM invoice_line_items|INSERT INTO invoices|INSERT INTO payment_transactions/);
  assert.match(correctionRoute, /LEGACY_INVOICE_CLASSIFICATION_CORRECTED/);
});

test('payment proposal resolution approves the corrected effective category using the original line identity', async () => {
  const { resolvePaymentProposals } = paymentProofRouter;
  const initialMetadata = {
    source: 'legacy_invoice_reconciliation', legacy_reconciliation: true,
    category: 'boarding',
  };
  const correctionMetadata = {
    source: 'legacy_classification_correction', target_line_id: 901,
    previous_category: 'boarding', new_category: 'tuition',
  };
  const executor = {
    async query(sql) {
      if (/FROM invoices i[\s\S]*JOIN invoice_line_items li/.test(sql)) {
        return { rows: [{
          id: 44, due_date: '2026-04-30', amount_due: 2350, amount_paid: 1400,
          invoice_line_item_id: 901, label: 'Boarding', service_key: 'boarding',
          line_amount: 2350, metadata: initialMetadata,
          invoice_lines: [
            {
              id: 901, line_type: 'charge', service_key: 'boarding',
              label: 'Boarding', amount: 2350, is_included: false,
              metadata: initialMetadata,
            },
            {
              id: 902, line_type: 'charge', service_key: 'tuition',
              label: 'Tuition', amount: 0, is_included: true,
              metadata: correctionMetadata,
            },
          ],
          invoice_transactions: [],
        }] };
      }
      throw new Error(`Unexpected corrected proposal query: ${sql}`);
    },
  };
  const resolved = await resolvePaymentProposals(executor, 7, [{
    obligation_id: 'invoice:44:line:901',
    invoice_id: 44,
    invoice_line_item_id: 901,
    category: 'tuition',
    amount: 950,
  }]);
  assert.deepEqual(resolved, [{
    invoiceId: 44,
    invoiceLineItemId: 901,
    obligationId: null,
    amount: 950,
    category: 'tuition',
    availableAmount: 950,
  }]);
});

test('admin proof review explicitly marks category-only historical proposals for retargeting', async () => {
  assert.match(routeSource, /LEGACY_AMBIGUOUS_ALLOCATION/);
  assert.match(routeSource, /Legacy ambiguous allocation — Admin retarget required/);
  const pendingUi = fs.readFileSync('client/src/components/admin/PendingPayments.js', 'utf8');
  assert.match(pendingUi, /legacy_allocation_review/);

  const adminListHandler = paymentProofRouter.stack
    .find((layer) => layer.route?.path === '/' && layer.route.methods?.get)
    .route.stack.at(-1).handle;
  const originalQuery = db.query;
  db.query = async () => ({ rows: [
    { id: 1, selected_obligations: [{ category: 'tuition', amount: 2350 }] },
    { id: 2, selected_obligations: [{ invoice_id: 44, category: 'tuition', amount: 950 }] },
  ] });
  const res = response();
  try {
    await adminListHandler({ query: { status: 'pending', search: '' } }, res);
  } finally {
    db.query = originalQuery;
  }
  assert.equal(res.body.submissions[0].legacy_allocation_review.code, 'LEGACY_AMBIGUOUS_ALLOCATION');
  assert.equal(res.body.submissions[1].legacy_allocation_review, null);
});

test('line-less carried-forward source with successor is rejected and never duplicated as payable', async () => {
  const source = { ...invoice, status: 'Unpaid' };
  const rejected = await classify({ invoiceRow: source, lineage: true });
  assert.equal(rejected.res.statusCode, 409);
  assert.match(rejected.res.body.message, /carried-forward source|active successor/i);
  assert.equal(rejected.client.state.inserted.length, 0);
  assert.equal(rejected.client.queries.some(({ sql }) => /INSERT INTO audit_logs/.test(sql)), false);

  const payable = await getPayableObligations(7, {
    async query(sql) {
      if (/information_schema\.columns/.test(sql)) {
        return { rows: [{ column_name: 'carried_forward_to_invoice_id' }] };
      }
      if (/carried_forward_to_invoice_id IS NOT NULL/.test(sql)) return { rows: [{ id: 44 }] };
      if (/FROM invoices i/.test(sql)) {
        return { rows: [
          source,
          { ...invoice, id: 45, status: 'Unpaid', description: 'Arrears from 2025', due_date: '2026-05-31' },
        ] };
      }
      if (/FROM invoice_line_items/.test(sql)) return { rows: [] };
      if (/FROM payment_transactions/.test(sql)) return { rows: [] };
      if (/FROM pending_payments/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected payable query: ${sql}`);
    },
  });
  assert.equal(payable.some((obligation) => Number(obligation.invoice_id) === 44), false);
  assert.equal(payable.filter((obligation) => Number(obligation.invoice_id) === 45).length, 1);

  const ledger = await getStudentLedger(7, {
    async query(sql) {
      if (/FROM users u/.test(sql)) {
        return { rows: [{ id: 7, student_number: 'ST-7', first_name: 'Learner', last_name: 'One' }] };
      }
      if (/FROM invoices i/.test(sql)) return { rows: [source, { ...invoice, id: 45, status: 'Unpaid' }] };
      if (/FROM payment_transactions pt/.test(sql)) return { rows: [] };
      if (/FROM service_prices/.test(sql)) return { rows: [] };
      if (/information_schema\.columns/.test(sql)) return { rows: [{ column_name: 'carried_forward_to_invoice_id' }] };
      if (/carried_forward_to_invoice_id IS NOT NULL/.test(sql)) return { rows: [{ id: 44 }] };
      if (/FROM invoice_line_items/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected ledger query: ${sql}`);
    },
  });
  const historySource = ledger.invoices.find((item) => Number(item.id) === 44);
  assert.equal(historySource.carry_forward_history, true);
  assert.equal(historySource.reconciliation_state, null);
  assert.equal(historySource.counted_in_totals, false);
});

test('classification audit failure rolls back the line and transaction', async () => {
  const { res, client } = await classify({ lines: [], auditFails: true });
  assert.equal(res.statusCode, 500);
  assert.equal(client.state.inserted.length, 1);
  assert.equal(client.state.committed, false);
  assert.equal(client.state.rolledBack, true);
});

test('reconciled metadata is exposed by breakdown and learner ledger history', async () => {
  const metadata = {
    source: 'legacy_invoice_reconciliation', legacy_reconciliation: true,
    category: 'tuition', actor_id: 3, actor_name: 'A Admin',
    classified_at: '2026-05-01T10:00:00.000Z', reason: 'Confirmed archived record.',
  };
  const breakdown = buildInvoiceBreakdown(invoice, [{
    id: 901, line_type: 'charge', service_key: 'tuition', label: 'Tuition',
    amount: 2350, is_included: false, metadata,
  }]);
  assert.deepEqual(breakdown.legacy_reconciliation, {
    state: 'RECONCILED', category: 'tuition', service_key: 'tuition',
    actor_id: 3, actor_name: 'A Admin', classified_at: metadata.classified_at,
    reason: metadata.reason, previous_classification: null,
  });
  assert.match(fs.readFileSync('services/financeLedger.js', 'utf8'), /legacy_reconciliation: legacyLine \?/);
  const ledger = await getStudentLedger(7, {
    async query(sql) {
      if (sql.includes('FROM users u')) return { rows: [{ id: 7, student_number: 'ST-7', first_name: 'Learner', last_name: 'One' }] };
      if (sql.includes('FROM invoices i')) return { rows: [invoice] };
      if (sql.includes('FROM payment_transactions pt')) return { rows: [] };
      if (sql.includes('FROM service_prices')) return { rows: [] };
      if (sql.includes('FROM invoice_line_items')) return { rows: [{
        id: 901, invoice_id: 44, line_type: 'charge', service_key: 'tuition',
        label: 'Tuition', description: 'Historical school fees', amount: 2350,
        is_included: false, metadata,
      }] };
      throw new Error(`Unexpected ledger query: ${sql}`);
    },
  });
  assert.equal(ledger.invoices[0].legacy_reconciliation.actor_name, 'A Admin');
  assert.equal(ledger.invoices[0].legacy_reconciliation.reason, metadata.reason);
});

test('classified payable uses actual period, partial outstanding, and oldest-unpaid ordering', async () => {
  const executor = {
    async query(sql) {
      if (sql.includes('FROM invoices i')) return { rows: [
        { id: 1, student_id: 7, amount_due: 2350, amount_paid: 1400, due_date: '2026-04-30', description: 'Old', reference_number: 'OLD' },
        { id: 2, student_id: 7, amount_due: 200, amount_paid: 0, due_date: '2026-07-31', description: 'New', reference_number: 'NEW' },
      ] };
      if (sql.includes('FROM invoice_line_items')) return { rows: [
        { id: 11, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 2350, is_included: false, metadata: { source: 'legacy_invoice_reconciliation', legacy_reconciliation: true, category: 'tuition' } },
        { id: 22, invoice_id: 2, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 200, is_included: false, metadata: {} },
      ] };
      if (sql.includes('FROM payment_transactions pt')) return { rows: [] };
      if (sql.includes('FROM pending_payments')) return { rows: [] };
      if (sql.includes('FROM student_one_off_fees')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const obligations = await getPayableObligations(7, executor);
  assert.deepEqual(obligations.filter((item) => item.is_payable).map((item) => [
    item.invoice_id, item.billing_period, item.amount_outstanding,
  ]), [[1, '2026-04', 950], [2, '2026-07', 200]]);
  assert.equal(obligations[0].legacy_reconciliation.state, 'RECONCILED');
});

test('pending duplicate validation is controlled and rejection/approval states release or hide', async () => {
  const { validateCanonicalSelections, canonicalObligationLockKeys, acquireCanonicalObligationLocks } = paymentProofRouter;
  const selected = [{ invoice_id: 1, invoice_line_item_id: 11, category: 'tuition', amount: 100 }];
  assert.deepEqual(canonicalObligationLockKeys(7, selected), [
    'harmony:invoice-obligation:v1:invoice:1',
    'harmony:invoice-obligation:v1:invoice:1:line:11:category:tuition:fee:0',
  ]);
  const lockQueries = [];
  await acquireCanonicalObligationLocks({ query: async (sql, params) => lockQueries.push({ sql, params }) }, 7, selected);
  assert.equal(lockQueries.length, 2);
  assert.match(lockQueries[0].sql, /pg_advisory_xact_lock/);

  const pendingExecutor = {
    async query(sql) {
      if (sql.includes('FROM invoices i')) return { rows: [{ id: 1, student_id: 7, amount_due: 100, amount_paid: 0, due_date: '2026-09-30', description: 'Monthly' }] };
      if (sql.includes('FROM invoice_line_items')) return { rows: [{ id: 11, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 100, is_included: false, metadata: {} }] };
      if (sql.includes('FROM payment_transactions pt')) return { rows: [] };
      if (sql.includes('FROM pending_payments')) return { rows: [{ id: 99, selected_obligations: selected }] };
      if (sql.includes('FROM student_one_off_fees')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(() => validateCanonicalSelections(pendingExecutor, 7, selected),
    (error) => error.status === 409 && /already pending/.test(error.safeMessage));

  const releasedExecutor = {
    async query(sql) {
      if (sql.includes('FROM invoices i')) return { rows: [{ id: 1, student_id: 7, amount_due: 100, amount_paid: 0, due_date: '2026-09-30', description: 'Monthly' }] };
      if (sql.includes('FROM invoice_line_items')) return { rows: [{ id: 11, invoice_id: 1, line_type: 'charge', service_key: 'tuition', label: 'Tuition', amount: 100, is_included: false, metadata: {} }] };
      if (sql.includes('FROM payment_transactions pt')) return { rows: [] };
      if (sql.includes('FROM pending_payments')) return { rows: [] };
      if (sql.includes('FROM student_one_off_fees')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  assert.equal((await getPayableObligations(7, releasedExecutor))[0].status, 'UNPAID');
  const approvedExecutor = {
    ...releasedExecutor,
    async query(sql) {
      if (sql.includes('FROM invoices i')) return { rows: [{ id: 1, student_id: 7, amount_due: 100, amount_paid: 100, due_date: '2026-09-30', description: 'Monthly' }] };
      return releasedExecutor.query(sql);
    },
  };
  const approved = await getPayableObligations(7, approvedExecutor);
  assert.equal(approved[0].status, 'PAID');
  assert.equal(approved[0].visible, false);

  const commandSource = fs.readFileSync('services/financeCommandService.js', 'utf8');
  assert.match(routeSource, /financeCommands\.createPaymentProof/);
  assert.match(commandSource, /acquireInvoiceObligationLocks\(executor, descriptorsFor\(studentId, lockObligations\)\)/);
  assert.ok(commandSource.indexOf('acquireInvoiceObligationLocks(executor, descriptorsFor(studentId, lockObligations))') <
    commandSource.indexOf('INSERT INTO pending_payments'));
  assert.match(payableSource, /WHERE student_id = \$1 AND status = 'pending'/);
});

test('classification and parent concurrent reservations share the same invoice lock key', async () => {
  const { acquireInvoiceObligationLocks } = require('../services/invoiceObligationLocks');
  const calls = [];
  const executor = { query: async (_sql, params) => { calls.push(params); } };
  const [classificationKeys, parentKeys] = await Promise.all([
    acquireInvoiceObligationLocks(executor, [{ invoiceId: 44, category: 'tuition' }]),
    acquireInvoiceObligationLocks(executor, [{ invoiceId: 44, studentId: 7, lineId: 901, category: 'tuition' }]),
  ]);
  const shared = 'harmony:invoice-obligation:v1:invoice:44';
  assert.ok(classificationKeys.includes(shared));
  assert.ok(parentKeys.includes(shared));
  assert.ok(calls.some((params) => params[1] === shared));
  assert.deepEqual(classificationKeys, [...classificationKeys].sort());
  assert.deepEqual(parentKeys, [...parentKeys].sort());
});

test('parent cannot classify and admin route records actor-safe provenance', () => {
  assert.match(invoiceSource, /authorize\('admin', 'super_admin'\)/);
  assert.doesNotMatch(invoiceSource.slice(invoiceSource.indexOf("router.post('/:id/classify-legacy'"),
    invoiceSource.indexOf("router.post('/manual-arrears'")), /authorize\('parent'\)/);
  assert.match(invoiceSource, /actor_id: Number\(req\.user\.id\)/);
  assert.match(invoiceSource, /classified_at: classifiedAt/);
});
