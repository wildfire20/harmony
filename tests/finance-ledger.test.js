const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  configuredComponents,
  getStudentLedger,
  getFinanceSummary,
  allocatePayment,
  reversePayment,
} = require('../services/financeLedger');

test('configured service charges include enrolled services exactly once', () => {
  const charge = configuredComponents({
    is_boarder: true,
    uses_transport: true,
    uses_aftercare: true,
    has_teacher_discount: false,
    has_sibling_discount: true,
  }, [
    { service_key: 'tuition', label: 'Tuition', amount: '1000.00' },
    { service_key: 'boarding', label: 'Boarding', amount: '800.00' },
    { service_key: 'transport', label: 'Transport', amount: '200.00' },
    { service_key: 'aftercare', label: 'Aftercare', amount: '150.00' },
  ]);

  assert.deepEqual(charge.components.map((component) => component.key), [
    'tuition', 'boarding', 'transport', 'aftercare',
  ]);
  assert.equal(charge.subtotal, 2150);
  assert.equal(charge.discount, 0);
  assert.equal(charge.configuredTotal, 2150);
  // The bundle total is a description of one charge, not an additional line.
  assert.equal(charge.components.reduce((sum, component) => sum + component.amount, 0), 2150);
});

test('ledger totals reconcile invoice balances and expose unallocated credit', async () => {
  const executor = {
    query: async (sql) => {
      if (sql.includes('FROM users')) return {
        rows: [{
          id: 7, student_number: 'HAR007', first_name: 'A', last_name: 'Learner',
          is_boarder: false, uses_transport: false, uses_aftercare: false,
          has_sibling_discount: false, has_teacher_discount: false,
        }],
      };
      if (sql.includes('FROM invoices')) return {
        rows: [
          { id: 1, student_id: 7, amount_due: '1000.00', amount_paid: '400.00',
            outstanding_balance: '600.00', overpaid_amount: '0.00',
            due_date: '2026-01-31', status: 'Partial' },
          { id: 2, student_id: 7, amount_due: '500.00', amount_paid: '500.00',
            outstanding_balance: '0.00', overpaid_amount: '0.00',
            due_date: '2026-02-28', status: 'Paid' },
        ],
      };
      if (sql.includes('FROM payment_transactions')) return {
        rows: [
          { id: 10, invoice_id: 1, amount: '400.00', payment_method: 'bank_transfer' },
          { id: 11, invoice_id: null, amount: '50.00', payment_method: 'bank_transfer' },
        ],
      };
      if (sql.includes('FROM service_prices')) return {
        rows: [{ service_key: 'tuition', label: 'Tuition', amount: '1000.00' }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const ledger = await getStudentLedger(7, executor);
  assert.deepEqual(ledger.totals, {
    totalDue: 1500,
    totalPaid: 900,
    outstanding: 600,
    overpaid: 0,
    unallocated: 50,
    credit: 50,
    netOutstanding: 550,
  });
  assert.equal(ledger.invoices[0].service_components.length, 1);
  assert.equal(ledger.transactions.filter((tx) => tx.allocated).length, 1);
});

test('all payment channels are wired to the authoritative allocator', () => {
  const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const bank = source('routes/invoices.js');
  const enhanced = source('routes/enhanced-invoices.js');
  const proof = source('routes/paymentProofs.js');

  assert.match(bank, /allocatePayment\(client/);
  assert.match(enhanced, /paymentMethod: 'bank_transfer'/);
  assert.match(enhanced, /paymentMethod: 'manual_entry'/);
  assert.match(proof, /allocatePayment\(executor/);
  // No channel is allowed to maintain a second invoice allocation algorithm.
  const bankHandler = bank.split("router.post('/process-bank-statement'")[1]
    .split("// Get payment transactions")[0];
  assert.doesNotMatch(bankHandler, /UPDATE invoices SET/);
  assert.doesNotMatch(bankHandler, /INSERT INTO payment_transactions/);
});

test('allocator gives bank, manual, proof and enhanced payments identical ledger treatment', async () => {
  const makeExecutor = () => {
    const state = {
      paid: 0,
      transactions: [],
      nextId: 1,
    };
    return {
      state,
      query: async (sql, params = []) => {
        if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'HAR007' }] };
        if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              id: 1, student_number: 'HAR007', reference_number: 'INV-1',
              amount_due: 100, amount_paid: state.paid,
              outstanding_balance: 100 - state.paid, due_date: '2026-01-31',
            }],
          };
        }
        if (sql.includes('UPDATE invoices')) {
          state.paid = Number(params[0]);
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
  };

  for (const paymentMethod of ['bank_transfer', 'manual_entry', 'proof_of_payment', 'bank_statement']) {
    const executor = makeExecutor();
    const result = await allocatePayment(executor, {
      studentId: 7,
      amount: 25,
      paymentDate: '2026-02-01',
      paymentMethod,
      reference: `${paymentMethod}-1`,
      recordedBy: 99,
    });
    assert.equal(result.total, 25);
    assert.deepEqual(result.allocations.map((allocation) => allocation.amount), [25]);
    assert.equal(executor.state.paid, 25);
    assert.equal(executor.state.transactions.length, 1);
  }
});

test('carry-forward history is retained but excluded from authoritative totals', async () => {
  const executor = {
    query: async (sql) => {
      if (sql.includes('FROM users')) return {
        rows: [{
          id: 7, student_number: 'HAR007', first_name: 'A', last_name: 'Learner',
          is_boarder: false, uses_transport: false, uses_aftercare: false,
          has_sibling_discount: false, has_teacher_discount: false,
        }],
      };
      if (sql.includes('FROM invoices')) return {
        rows: [
          { id: 1, student_id: 7, amount_due: 300, amount_paid: 100,
            outstanding_balance: 200, overpaid_amount: 0, due_date: '2025-12-31',
            status: 'Carried Forward' },
          { id: 2, student_id: 7, amount_due: 200, amount_paid: 0,
            outstanding_balance: 200, overpaid_amount: 0, due_date: '2026-01-31',
            status: 'Unpaid' },
        ],
      };
      if (sql.includes('FROM payment_transactions')) return {
        rows: [{ id: 40, invoice_id: 1, amount: 100, payment_method: 'manual_entry' }],
      };
      if (sql.includes('FROM service_prices')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const ledger = await getStudentLedger(7, executor);
  assert.equal(ledger.invoices.filter((invoice) => invoice.counted_in_totals).length, 1);
  assert.deepEqual(ledger.totals, {
    totalDue: 200, totalPaid: 0, outstanding: 200, overpaid: 0,
    unallocated: 0, credit: 0, netOutstanding: 200,
  });
});

test('Admin summary model exposes the same credit semantics as the learner ledger', async () => {
  const executor = {
    query: async (sql) => {
      if (sql.includes('FROM invoices')) return {
        rows: [
          { id: 1, status: 'Carried Forward', amount_due: 500, amount_paid: 250 },
          { id: 2, status: 'Partial', amount_due: 400, amount_paid: 100 },
        ],
      };
      if (sql.includes('FROM payment_transactions')) {
        return { rows: [{ unallocated: '25' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const summary = await getFinanceSummary({}, executor);
  assert.equal(summary.totalAmountDue, 400);
  assert.equal(summary.totalAmountPaid, 100);
  assert.equal(summary.totalOutstanding, 300);
  assert.equal(summary.unallocated, 25);
  assert.equal(summary.credit, 25);
  assert.equal(summary.netOutstanding, 275);
});

test('manual edit/delete routes reverse exact allocations instead of period-wide updates', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes/enhanced-invoices.js'), 'utf8');
  const editDelete = source.split("router.put('/manual-payment/:paymentId'")[1]
    .split("router.post('/manual-payment/apply-arrears-first'")[0];
  assert.match(editDelete, /reversePayment/);
  assert.match(editDelete, /invoiceId: reversal\.effectiveInvoiceId/);
  assert.match(editDelete, /WHERE id = \$1\s+FOR UPDATE/);
  assert.doesNotMatch(editDelete, /WHERE student_id = \\$2[\\s\\S]{0,400}EXTRACT\\(MONTH FROM due_date\\)/);
  assert.doesNotMatch(editDelete, /DELETE FROM payment_transactions/);
});

function reversalExecutor({ carriedForward = false, conflictOnInsert = false } = {}) {
  const state = {
    paid: carriedForward ? 50 : 50,
    due: carriedForward ? 100 : 100,
    successorDue: carriedForward ? 50 : null,
    successorPaid: 0,
    reversalId: null,
    nextId: 90,
  };
  return {
    state,
    async query(sql, params = []) {
      if (sql.includes('SAVEPOINT') || sql.includes('RELEASE SAVEPOINT') || sql.includes('ROLLBACK TO SAVEPOINT')) {
        return { rows: [] };
      }
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'HAR007' }] };
      if (sql.includes('SELECT id, invoice_id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 10, invoice_id: 1, student_id: 7, student_number: 'HAR007',
            reference_number: 'PAY-10', reference: 'PAY-10',
            reverses_transaction_id: null, amount: 50,
            payment_date: '2026-01-01', transaction_date: '2026-01-01',
            payment_method: 'manual_entry', month: 1, year: 2026,
          }],
        };
      }
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'HAR007' }] };
      if (sql.includes('SELECT id') && sql.includes('reverses_transaction_id')) {
        return state.reversalId ? { rows: [{ id: state.reversalId }] } : { rows: [] };
      }
      if (sql.includes('SELECT id, student_id, amount_due')) {
        return {
          rows: [{
            id: 1, student_id: 7, amount_due: state.due, amount_paid: state.paid,
            status: carriedForward ? 'Carried Forward' : 'Partial',
            due_date: '2025-12-31',
          }],
        };
      }
      if (sql.includes('SELECT id, amount_due, amount_paid, status') && sql.includes('description = $3')) {
        return state.successorDue == null ? { rows: [] } : {
          rows: [{ id: 2, amount_due: state.successorDue, amount_paid: 0, status: 'Unpaid' }],
        };
      }
      if (sql.includes('SELECT id, student_number, reference_number')) {
        if (params[1] !== 2) return { rows: [] };
        return {
          rows: [{
            id: 2, student_number: 'HAR007', reference_number: 'CF-2',
            amount_due: state.successorDue, amount_paid: state.successorPaid,
            outstanding_balance: state.successorDue - state.successorPaid,
            due_date: '2026-01-31',
          }],
        };
      }
      if (sql.includes('UPDATE invoices')) {
        if (sql.includes('SET amount_due')) state.successorDue = Number(params[0]);
        else if (carriedForward && params[2] === 2) state.successorPaid = Number(params[0]);
        else state.paid = Number(params[0]);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO payment_transactions')) {
        if (!sql.includes('reverses_transaction_id')) {
          state.paymentAllocationId = state.nextId++;
          return { rows: [{ id: state.paymentAllocationId }] };
        }
        if (conflictOnInsert || state.reversalId) {
          if (conflictOnInsert && !state.reversalId) state.reversalId = 91;
          const error = new Error('duplicate reversal');
          error.code = '23505';
          throw error;
        }
        state.targetInvoiceId = params[0];
        state.reversalId = state.nextId++;
        return { rows: [{ id: state.reversalId }] };
      }
      throw new Error(`Unexpected reversal query: ${sql}`);
    },
  };
}

test('reversal is idempotent and duplicate unique conflicts return the existing reversal', async () => {
  const executor = reversalExecutor();
  const first = await reversePayment(executor, { transactionId: 10, recordedBy: 99 });
  const second = await reversePayment(executor, { transactionId: 10, recordedBy: 99 });
  assert.equal(first.reversalId, second.reversalId);
  assert.equal(second.alreadyReversed, true);
  assert.equal(executor.state.paid, 0);

  const conflictExecutor = reversalExecutor({ conflictOnInsert: true });
  const conflict = await reversePayment(conflictExecutor, { transactionId: 10, recordedBy: 99 });
  assert.equal(conflict.reversalId, 91);
  assert.equal(conflict.alreadyReversed, true);
});

test('concurrent reversal requests serialize on the original payment lock', async () => {
  const base = reversalExecutor();
  let locked = false;
  const waiters = [];
  const executor = {
    state: base.state,
    async query(sql, params) {
      const locksOriginal = sql.includes('SELECT id, invoice_id') && sql.includes('FOR UPDATE');
      if (locksOriginal && locked) {
        await new Promise((resolve) => waiters.push(resolve));
      }
      if (locksOriginal) locked = true;
      const result = await base.query(sql, params);
      if (sql.includes('INSERT INTO payment_transactions') && locked) {
        locked = false;
        waiters.splice(0).forEach((resolve) => resolve());
      }
      return result;
    },
  };
  const results = await Promise.all([
    reversePayment(executor, { transactionId: 10, recordedBy: 99 }),
    reversePayment(executor, { transactionId: 10, recordedBy: 99 }),
  ]);
  assert.equal(results[0].reversalId, results[1].reversalId);
  assert.equal(executor.state.reversalId, results[0].reversalId);
  assert.equal(executor.state.paid, 0);
});

test('reversal moves a carried-forward allocation to its active successor', async () => {
  const executor = reversalExecutor({ carriedForward: true });
  const result = await reversePayment(executor, { transactionId: 10, recordedBy: 99 });
  assert.equal(result.reversalId, 90);
  assert.equal(result.effectiveInvoiceId, 2);
  assert.equal(executor.state.targetInvoiceId, 2);
  assert.equal(executor.state.successorDue, 100);
});

test('carried-forward edit reapplies to the effective successor without unallocated credit', async () => {
  const executor = reversalExecutor({ carriedForward: true });
  const reversal = await reversePayment(executor, { transactionId: 10, recordedBy: 99 });
  const replacement = await allocatePayment(executor, {
    studentId: 7,
    amount: 50,
    invoiceId: reversal.effectiveInvoiceId,
    paymentDate: '2026-02-01',
    paymentMethod: 'manual_entry',
    reference: 'EDIT-10',
    recordedBy: 99,
  });
  assert.equal(replacement.allocations[0].invoiceId, 2);
  assert.equal(executor.state.successorDue, 100);
  assert.equal(executor.state.successorPaid, 50);
  assert.equal(replacement.allocations.some((allocation) => allocation.invoiceId == null), false);
  // Both Admin summary and Parent ledger therefore see the same active
  // successor balance: due 100, paid 50, outstanding 50, no credit.
  assert.deepEqual({ due: executor.state.successorDue, paid: executor.state.successorPaid, outstanding: 50, credit: 0 }, {
    due: 100, paid: 50, outstanding: 50, credit: 0,
  });

  const modelExecutor = {
    async query(sql) {
      if (sql.includes('FROM users')) return {
        rows: [{
          id: 7, student_number: 'HAR007', first_name: 'A', last_name: 'Learner',
          is_boarder: false, uses_transport: false, uses_aftercare: false,
          has_sibling_discount: false, has_teacher_discount: false,
        }],
      };
      if (sql.includes('FROM invoices')) return {
        rows: [
          { id: 1, student_id: 7, amount_due: 100, amount_paid: 100,
            outstanding_balance: 0, overpaid_amount: 0, due_date: '2025-12-31',
            status: 'Carried Forward' },
          { id: 2, student_id: 7, amount_due: executor.state.successorDue,
            amount_paid: executor.state.successorPaid, outstanding_balance: 50,
            overpaid_amount: 0, due_date: '2026-01-31', status: 'Partial' },
        ],
      };
      if (sql.includes('FROM payment_transactions')) {
        return sql.includes('SUM(pt.amount)') ? { rows: [{ unallocated: 0 }] } : {
          rows: [{ id: 90, invoice_id: 2, amount: 50, payment_method: 'manual_entry' }],
        };
      }
      if (sql.includes('FROM service_prices')) return { rows: [] };
      throw new Error(`Unexpected model query: ${sql}`);
    },
  };
  const parentLedger = await getStudentLedger(7, modelExecutor);
  const adminSummary = await getFinanceSummary({ studentNumber: 'HAR007' }, modelExecutor);
  assert.equal(parentLedger.totals.outstanding, adminSummary.totalOutstanding);
  assert.equal(parentLedger.totals.totalPaid, adminSummary.totalAmountPaid);
  assert.equal(parentLedger.totals.unallocated, adminSummary.unallocated);
});

test('carried-forward reversal fails safely when no active successor exists', async () => {
  const executor = reversalExecutor({ carriedForward: true });
  executor.state.successorDue = null;
  await assert.rejects(
    reversePayment(executor, { transactionId: 10, recordedBy: 99 }),
    /no active carry-forward successor/,
  );
  assert.equal(executor.state.reversalId, null);
  assert.equal(executor.state.paid, 50);
});

test('aggregate carry-forward lineage migration is additive and fail-closed', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'manual_finance_reconciliation.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS carried_forward_to_invoice_id INTEGER\s+REFERENCES invoices\(id\)/);
  assert.match(migration, /invoices_carried_forward_to_invoice_id_idx/);
  assert.match(migration, /COUNT\(\*\) OVER \(PARTITION BY source\.id\)/);
  assert.match(migration, /candidate_count = 1/);
  assert.match(migration, /successor\.description = 'Arrears from '/);
});

test('multiple source invoices reverse and edit against one persisted carry-forward successor', async () => {
  const state = {
    successorDue: 100,
    successorPaid: 0,
    reversals: new Map(),
    nextId: 100,
  };
  const executor = {
    state,
    async query(sql, params = []) {
      if (sql.includes('SAVEPOINT') || sql.includes('RELEASE SAVEPOINT') || sql.includes('ROLLBACK TO SAVEPOINT')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id, invoice_id') && sql.includes('FOR UPDATE')) {
        const sourceId = Number(params[0]) === 11 ? 2 : 1;
        return {
          rows: [{
            id: Number(params[0]), invoice_id: sourceId, student_id: 7,
            student_number: 'HAR007', reference_number: `PAY-${params[0]}`,
            reference: `PAY-${params[0]}`, reverses_transaction_id: null,
            amount: 50, payment_date: '2026-01-01', transaction_date: '2026-01-01',
            payment_method: 'manual_entry', month: 1, year: 2025,
          }],
        };
      }
      if (sql.includes('SELECT id, invoice_id') && !sql.includes('FOR UPDATE')) {
        return { rows: [] };
      }
      if (sql.includes('FROM users')) return { rows: [{ id: 7, student_number: 'HAR007' }] };
      if (sql.includes('SELECT') && sql.includes('reverses_transaction_id')) {
        const id = state.reversals.get(Number(params[0]));
        return id ? { rows: [{ id, invoice_id: 3 }] } : { rows: [] };
      }
      if (sql.includes('SELECT id, student_id, amount_due')) {
        const sourceId = Number(params[0]);
        return {
          rows: [{
            id: sourceId, student_id: 7, amount_due: 100, amount_paid: 50,
            status: 'Carried Forward', due_date: '2025-12-31',
            carried_forward_to_invoice_id: 3,
          }],
        };
      }
      if (sql.includes('WHERE id = $1 AND student_id = $2')) {
        return {
          rows: [{ id: 3, amount_due: state.successorDue, amount_paid: state.successorPaid, status: 'Partial' }],
        };
      }
      if (sql.includes('SELECT id, student_number, reference_number')) {
        return {
          rows: [{
            id: 3, student_number: 'HAR007', reference_number: 'CF-3',
            amount_due: state.successorDue, amount_paid: state.successorPaid,
            outstanding_balance: state.successorDue - state.successorPaid,
            due_date: '2026-01-31',
          }],
        };
      }
      if (sql.includes('UPDATE invoices')) {
        if (sql.includes('SET amount_due')) state.successorDue = Number(params[0]);
        else state.successorPaid = Number(params[0]);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO payment_transactions')) {
        const id = state.nextId++;
        if (sql.includes('reverses_transaction_id')) state.reversals.set(Number(params[4]), id);
        return { rows: [{ id }] };
      }
      throw new Error(`Unexpected aggregate query: ${sql}`);
    },
  };
  return (async () => {
    const first = await reversePayment(executor, { transactionId: 10, recordedBy: 99 });
    const second = await reversePayment(executor, { transactionId: 11, recordedBy: 99 });
    assert.equal(first.effectiveInvoiceId, 3);
    assert.equal(second.effectiveInvoiceId, 3);
    assert.equal(state.successorDue, 200);
    const replacement = await allocatePayment(executor, {
      studentId: 7,
      amount: 75,
      invoiceId: first.effectiveInvoiceId,
      paymentDate: '2026-02-01',
      paymentMethod: 'manual_entry',
      reference: 'EDIT-10',
      recordedBy: 99,
    });
    assert.equal(replacement.allocations[0].invoiceId, 3);
    assert.equal(state.successorPaid, 75);
    assert.equal(replacement.allocations.some((allocation) => allocation.invoiceId == null), false);
    assert.deepEqual({ due: state.successorDue, paid: state.successorPaid, outstanding: 125, credit: 0 }, {
      due: 200, paid: 75, outstanding: 125, credit: 0,
    });
  })();
});