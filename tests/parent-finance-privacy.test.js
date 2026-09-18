const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const parentRouter = require('../routes/parent');

test('Parent invoice UI does not render unallocated or credit totals', () => {
  const source = fs.readFileSync('client/src/components/parent/ParentInvoices.js', 'utf8');

  assert.doesNotMatch(source, /Unallocated payments/i);
  assert.doesNotMatch(source, /totals\.(?:credit|unallocated|netOutstanding)/);
  assert.match(source, /Total Billed/);
  assert.match(source, /Total Paid/);
  assert.match(source, /Outstanding invoices/);
});

test('Parent invoice projection removes unallocated totals and transactions', () => {
  const result = parentRouter.parentSafeInvoiceLedger({
    invoices: [{ id: 10, line_items: [{ id: 1, label: 'Tuition' }] }],
    transactions: [
      { id: 20, invoice_id: 10, amount: 100 },
      { id: 21, invoice_id: null, amount: 32150 },
    ],
    service_components: [{ key: 'tuition', label: 'Monthly Tuition' }],
    totals: {
      totalDue: 26600,
      totalPaid: 15600,
      outstanding: 11000,
      unallocated: 32150,
      credit: 32150,
      netOutstanding: -21150,
    },
  });

  assert.deepEqual(result.totals, {
    totalDue: 26600,
    totalPaid: 15600,
    outstanding: 11000,
  });
  assert.deepEqual(result.transactions, [{ id: 20, invoice_id: 10, amount: 100 }]);
  assert.equal(result.invoices[0].line_items[0].label, 'Tuition');
  assert.equal(result.serviceComponents[0].key, 'tuition');
});

test('Parent empty-child shape is safe while Admin retains full ledger access', () => {
  const parentRoute = fs.readFileSync('routes/parent.js', 'utf8');
  const adminRoute = fs.readFileSync('routes/invoices.js', 'utf8');
  const ledger = fs.readFileSync('services/financeLedger.js', 'utf8');

  assert.match(parentRoute, /totals: \{ totalDue: 0, totalPaid: 0, outstanding: 0 \}/);
  assert.doesNotMatch(parentRoute, /totals: ledger\.totals/);
  assert.match(adminRoute, /unallocated: financeSummary\.unallocated/);
  assert.match(ledger, /unallocated/);
});