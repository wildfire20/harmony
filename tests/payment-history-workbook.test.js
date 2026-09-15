const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

test('payment-history workbook uses meaningful cells and canonical pending one-off status', async () => {
  const db = require('../config/database');
  const finance = require('../services/financeLedger');
  const payable = require('../services/payableObligations');
  const originalQuery = db.query;
  const originalLedger = finance.getStudentLedger;
  const originalPayable = payable.getPayableObligations;
  db.query = async () => ({ rows: [{
    id: 7, first_name: 'Test', last_name: 'Learner', student_number: 'HARTEST',
    created_at: '2026-01-01', grade: 'Grade 2',
  }] });
  finance.getStudentLedger = async () => ({
    totals: {
      totalDue: 1200, totalPaid: 0, outstanding: 1200, overpaid: 0,
      unallocated: 32150, credit: 32150, netOutstanding: 1200,
    },
    invoices: [{
      id: 11386, due_date: '2026-09-24', counted_in_totals: true,
      carry_forward_history: false, status: 'Unpaid', net_due: 1200,
      amount_due: 1200, amount_paid: 0, allocated_effective_payments: 0,
      outstanding_balance: 1200, credit: 0, gross_charges: 1200,
      discount_lines: [{ id: 504, line_type: 'discount', service_key: 'tuition',
        label: 'Sibling discount', amount: 100 }],
      discount_total: 100, charge_totals: { one_off: 1200, tuition: 1000, boarding: 1000 },
      payment_review_flags: [], review_required: false,
      service_charge_lines: [], one_off_charge_lines: [{
        id: 501, line_type: 'charge', service_key: 'one_off_fee',
        label: 57, description: 57, amount: 1200,
        metadata: { category: 'one_off', fee_id: 4 },
      }],
      line_items: [{
        id: 501, line_type: 'charge', service_key: 'one_off_fee',
        label: 57, description: 57, amount: 1200, metadata: { category: 'one_off', fee_id: 4 },
      }, {
        id: 502, line_type: 'charge', service_key: 'tuition',
        label: 'Tuition', description: 'Monthly tuition', amount: 1000,
      }, {
        id: 503, line_type: 'charge', service_key: 'boarding',
        label: 'Boarding', description: 'Monthly boarding', amount: 1000,
      }, {
        id: 504, line_type: 'discount', service_key: 'tuition',
        label: 'Sibling discount', description: 'Approved sibling discount', amount: 100,
      }],
    }],
    transactions: [{
      id: 1, invoice_id: null, amount: 32150, payment_date: '2026-09-15',
      payment_method: 'manual_entry', reference_number: null,
      review_flags: ['unallocated_payment', 41], review_required: true,
    }],
    service_components: [],
  });
  payable.getPayableObligations = async () => [{
    invoice_id: 11386, invoice_line_item_id: 501, status: 'PENDING_REVIEW',
  }];

  const routePath = require.resolve('../routes/enhanced-invoices');
  delete require.cache[routePath];
  const router = require('../routes/enhanced-invoices');
  const handler = router.stack
    .find((layer) => layer.route?.path === '/student-payment-history/:studentNumber')
    .route.stack.at(-1).handle;
  let buffer;
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.jsonBody = value; return this; },
    send(value) { buffer = value; return this; },
  };
  try {
    await handler({ params: { studentNumber: 'HARTEST' }, query: { format: 'excel' } }, response);
  } finally {
    db.query = originalQuery;
    finance.getStudentLedger = originalLedger;
    payable.getPayableObligations = originalPayable;
    delete require.cache[routePath];
  }
  assert.equal(response.statusCode, 200);
  assert.ok(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const oneOff = workbook.getWorksheet('One-Off Fees');
  assert.equal(oneOff.getCell('H2').value, 'Pending Review');
  const monthly = workbook.getWorksheet('Monthly School Account');
  const values = [];
  monthly.eachRow((row) => row.eachCell({ includeEmpty: true }, (cell) => values.push(cell.value)));
  assert.ok(values.includes('OVERALL ACCOUNT SUMMARY'));
  assert.ok(values.includes('Legacy snapshot unavailable'));
  assert.ok(values.includes('unallocated_payment'));
  assert.equal(values.some((value) => value === 41 || value === '41'), false);
  assert.equal(values.some((value) => value === 57 || value === '57'), false);
  const breakdown = workbook.getWorksheet('Invoice Breakdown');
  const breakdownRows = [];
  breakdown.eachRow((row) => breakdownRows.push(row.values));
  const breakdownText = JSON.stringify(breakdownRows);
  assert.match(breakdownText, /Tuition/);
  assert.match(breakdownText, /Boarding/);
  assert.match(breakdownText, /Sibling discount/);
  assert.match(breakdownText, /-100/);
});