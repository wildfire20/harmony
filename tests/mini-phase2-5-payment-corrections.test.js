const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { allocatePayment, reversePayment } = require('../services/financeLedger');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Admin payment correction routes preserve immutable finance history', () => {
  const routes = source('routes/enhanced-invoices.js');
  const correctionArea = routes.split("router.put('/manual-payment/:paymentId'")[1]
    .split("router.post('/manual-payment/apply-arrears-first'")[0];

  assert.match(routes, /body\('invoice_id'\)\.optional/);
  assert.match(routes, /invoiceId: invoice_id == null \? null : Number\(invoice_id\)/);
  assert.match(correctionArea, /body\('reason'\).*isLength/);
  assert.match(correctionArea, /reversePayment\(client/);
  assert.match(correctionArea, /allocatePayment\(client/);
  assert.match(correctionArea, /manual_payment_reverse/);
  assert.match(correctionArea, /manual_payment_reallocated/);
  assert.match(correctionArea, /alreadyReversed/);
  assert.doesNotMatch(correctionArea, /DELETE FROM payment_transactions/);
  assert.doesNotMatch(correctionArea, /SET amount\s*=/);
});

test('correction notifications happen after finance commit and cannot roll it back', () => {
  const routes = source('routes/enhanced-invoices.js');
  for (const marker of ["router.put('/manual-payment/:paymentId'", "router.delete('/manual-payment/:paymentId'", "router.post('/manual-payment/:paymentId/apply'"]) {
    const handler = routes.split(marker)[1];
    assert.ok(handler, `missing handler ${marker}`);
    const commit = handler.indexOf("client.query('COMMIT')");
    const notify = handler.indexOf('notifyPayment({');
    assert.ok(commit >= 0 && notify > commit, `notification must follow commit for ${marker}`);
  }
  const notifications = source('services/parentNotificationService.js');
  assert.match(notifications, /PAYMENT_RECORDED: 'payment_recorded'/);
  assert.match(notifications, /PAYMENT_ADJUSTED: 'payment_adjusted'/);
  assert.match(notifications, /PAYMENT_REVERSED: 'payment_reversed'/);
  assert.match(notifications, /Parent notification creation skipped/);
});

test('required correction audits share the finance transaction and retain every replacement id', () => {
  const routes = source('routes/enhanced-invoices.js');
  const correctionArea = routes.split("router.put('/manual-payment/:paymentId'")[1]
    .split("router.post('/manual-payment/apply-arrears-first'")[0];
  assert.match(correctionArea, /executor: client,\s*required: true/g);
  assert.match(correctionArea, /replacement_transaction_ids: replacementTransactionIds/g);
  for (const marker of ["router.put('/manual-payment/:paymentId'", "router.delete('/manual-payment/:paymentId'", "router.post('/manual-payment/:paymentId/apply'"]) {
    const handler = routes.split(marker)[1];
    const requiredAudit = handler.indexOf('required: true');
    const commit = handler.indexOf("client.query('COMMIT')");
    assert.ok(requiredAudit >= 0 && requiredAudit < commit, `required audit must precede commit for ${marker}`);
  }
});

test('manual payment audit derives its period inside the manual-payment handler', () => {
  const routes = source('routes/enhanced-invoices.js');
  const historyHandler = routes.split("router.get('/student-payment-history/:studentNumber'")[1]
    .split("router.post('/manual-payment'")[0];
  const manualHandler = routes.split("router.post('/manual-payment'")[1]
    .split("router.get('/student-payments/:studentId'")[0];
  assert.doesNotMatch(historyHandler, /const paymentMonth|const paymentYear/);
  assert.match(manualHandler, /const paymentMonth = month \|\| new Date\(payment_date\)/);
  assert.match(manualHandler, /const paymentYear = year \|\| new Date\(payment_date\)/);
  assert.ok(manualHandler.indexOf('const paymentMonth') < manualHandler.indexOf('month: paymentMonth'));
  assert.ok(manualHandler.indexOf('const paymentYear') < manualHandler.indexOf('year: paymentYear'));
});

test('Admin correction UI uses adjustment, reversal, invoice targeting, and audit-safe wording', () => {
  const ui = source('client/src/components/admin/ManualPayments.js');
  const api = source('client/src/services/api.js');

  assert.match(ui, /Payment Audit History/);
  assert.match(ui, /Correction Reason \*/);
  assert.match(ui, /Select an outstanding invoice/);
  assert.match(ui, /Reverse Payment/);
  assert.match(ui, /original record will remain visible in the audit history/);
  assert.match(ui, /applyUnallocatedPayment/);
  assert.doesNotMatch(ui, /Delete Payment|delete this payment|Payment deleted successfully/);
  assert.match(api, /reverseManualPayment/);
  assert.match(api, /applyUnallocatedPayment/);
});

test('Admin, Parent, history, and export continue to use the authoritative ledger', () => {
  const admin = source('routes/invoices.js');
  const parent = source('routes/parent.js');
  const history = source('routes/enhanced-invoices.js');

  assert.match(admin, /getFinanceSummary/);
  assert.match(parent, /getStudentLedger/);
  assert.match(history, /getStudentLedger\(student\.id\)/);
  assert.match(history, /Invoice Breakdown/);
  assert.doesNotMatch(history, /Math\.max\(invoicePaid, ptPaid\)/);
});

test('no schema migration is required for payment corrections', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.equal(packageJson.scripts['migrate:mini-phase2-5'], undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'migrations', 'mini_phase2_5_payment_corrections.sql')), false);
});

function correctionExecutor({ invoicePaid = 0, originalAmount = null, originalInvoiceId = 1 } = {}) {
  const state = {
    invoice: { id: 1, due: 2350, paid: invoicePaid, dueDate: '2027-09-30' },
    transactions: [],
    nextId: 100,
  };
  if (originalAmount != null) {
    state.transactions.push({
      id: 10,
      invoice_id: originalInvoiceId,
      student_id: 49,
      student_number: 'HAR049',
      reference_number: 'MANUAL-10',
      reference: 'MANUAL-10',
      reverses_transaction_id: null,
      amount: originalAmount,
      payment_date: '2027-09-05',
      transaction_date: '2027-09-05',
      payment_method: 'manual_entry',
      month: 9,
      year: 2027,
    });
  }
  return {
    state,
    async query(sql, params = []) {
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql.trim())) return { rows: [] };
      if (sql.includes('FROM users')) return { rows: [{ id: 49, student_number: 'HAR049' }] };
      if (sql.includes('FROM payment_transactions') && sql.includes('WHERE id = $1')) {
        return { rows: state.transactions.filter((tx) => tx.id === Number(params[0])) };
      }
      if (sql.includes('WHERE reverses_transaction_id = $1')) {
        return { rows: state.transactions.filter((tx) => tx.reverses_transaction_id === Number(params[0])) };
      }
      if (sql.includes('FROM invoices') && sql.includes('SELECT id, student_id')) {
        return { rows: [{
          id: 1,
          student_id: 49,
          amount_due: state.invoice.due,
          amount_paid: state.invoice.paid,
          status: state.invoice.paid >= state.invoice.due ? 'Paid' : state.invoice.paid > 0 ? 'Partial' : 'Unpaid',
          due_date: state.invoice.dueDate,
          carried_forward_to_invoice_id: null,
        }] };
      }
      if (sql.includes('FROM invoices') && sql.includes('outstanding_balance')) {
        const target = params[1];
        if (target != null && Number(target) !== state.invoice.id) return { rows: [] };
        return { rows: [{
          id: state.invoice.id,
          student_number: 'HAR049',
          reference_number: 'INV-SEP',
          amount_due: state.invoice.due,
          amount_paid: state.invoice.paid,
          outstanding_balance: Math.max(state.invoice.due - state.invoice.paid, 0),
          due_date: state.invoice.dueDate,
        }] };
      }
      if (sql.includes('UPDATE invoices') && sql.includes('SET amount_paid')) {
        state.invoice.paid = Number(params[0]);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO payment_transactions')) {
        const id = state.nextId++;
        const isReversal = sql.includes('reverses_transaction_id');
        state.transactions.push(isReversal ? {
          id,
          invoice_id: params[0],
          student_id: params[1],
          reverses_transaction_id: Number(params[4]),
          amount: Number(params[5]),
        } : {
          id,
          invoice_id: params[0],
          student_id: params[1],
          amount: Number(params[4]),
          reverses_transaction_id: null,
        });
        return { rows: [{ id }] };
      }
      throw new Error(`Unexpected correction query: ${sql}`);
    },
  };
}

test('full and partial manual payments update the same authoritative invoice balance', async () => {
  const partial = correctionExecutor();
  await allocatePayment(partial, {
    studentId: 49, amount: 1000, invoiceId: 1, paymentDate: '2027-09-05',
    paymentMethod: 'cash', reference: 'CASH-1', recordedBy: 7,
  });
  assert.equal(partial.state.invoice.paid, 1000);

  const full = correctionExecutor();
  await allocatePayment(full, {
    studentId: 49, amount: 2350, invoiceId: 1, paymentDate: '2027-09-05',
    paymentMethod: 'bank_transfer', reference: 'EFT-1', recordedBy: 7,
  });
  assert.equal(full.state.invoice.paid, 2350);
});

test('payment amount can be increased or decreased through reversal and replacement', async () => {
  for (const correctedAmount of [2350, 1175]) {
    const executor = correctionExecutor({ invoicePaid: 2000, originalAmount: 2000 });
    const reversal = await reversePayment(executor, { transactionId: 10, recordedBy: 7, description: 'Correction' });
    await allocatePayment(executor, {
      studentId: 49, amount: correctedAmount, invoiceId: reversal.effectiveInvoiceId,
      paymentDate: '2027-09-05', paymentMethod: 'manual_entry',
      reference: 'CORRECTED-10', recordedBy: 7,
    });
    assert.equal(executor.state.invoice.paid, correctedAmount);
    assert.equal(executor.state.transactions[0].amount, 2000);
    assert.equal(executor.state.transactions.some((tx) => tx.reverses_transaction_id === 10), true);
  }
});

test('reversal restores the invoice and blocks a second effective reversal', async () => {
  const executor = correctionExecutor({ invoicePaid: 2350, originalAmount: 2350 });
  const first = await reversePayment(executor, { transactionId: 10, recordedBy: 7 });
  const second = await reversePayment(executor, { transactionId: 10, recordedBy: 7 });
  assert.equal(executor.state.invoice.paid, 0);
  assert.equal(first.reversalId, second.reversalId);
  assert.equal(second.alreadyReversed, true);
});

test('reversal fails closed when the invoice balance cannot support the compensation', async () => {
  const executor = correctionExecutor({ invoicePaid: 100, originalAmount: 500 });
  await assert.rejects(
    reversePayment(executor, { transactionId: 10, recordedBy: 7 }),
    /invoice balance is lower than the payment allocation/,
  );
  assert.equal(executor.state.invoice.paid, 100);
  assert.equal(executor.state.transactions.some((tx) => tx.reverses_transaction_id === 10), false);
});

test('unallocated payment is neutralized then applied to one exact invoice', async () => {
  const executor = correctionExecutor({ invoicePaid: 0, originalAmount: 500, originalInvoiceId: null });
  const reversal = await reversePayment(executor, { transactionId: 10, recordedBy: 7 });
  assert.equal(reversal.effectiveInvoiceId, null);
  const replacement = await allocatePayment(executor, {
    studentId: 49, amount: 500, invoiceId: 1, paymentDate: '2027-09-05',
    paymentMethod: 'bank_transfer', reference: 'EFT-UNALLOCATED', recordedBy: 7,
  });
  assert.equal(replacement.allocations[0].invoiceId, 1);
  assert.equal(executor.state.invoice.paid, 500);
  assert.equal(executor.state.transactions[0].invoice_id, null);
  assert.equal(executor.state.transactions.some((tx) => tx.reverses_transaction_id === 10), true);
});

test('overpayment remains explicit unallocated credit after the target invoice is settled', async () => {
  const executor = correctionExecutor();
  const result = await allocatePayment(executor, {
    studentId: 49, amount: 2500, invoiceId: 1, paymentDate: '2027-09-05',
    paymentMethod: 'bank_transfer', reference: 'EFT-OVER', recordedBy: 7,
  });
  assert.equal(executor.state.invoice.paid, 2350);
  assert.deepEqual(result.allocations.map((item) => [item.invoiceId, item.amount]), [[1, 2350], [null, 150]]);
});