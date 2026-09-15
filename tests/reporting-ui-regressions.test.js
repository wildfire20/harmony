const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('Parent uses the effective legacy category for invoice subtitles', () => {
  const source = read('client/src/components/parent/ParentInvoices.js');
  assert.match(source, /legacy_reconciliation\?\.category/);
  assert.match(source, /return `Legacy \$\{label\}`/);
  assert.doesNotMatch(source, /inv\.description\}/);
});

test('allocation options ignore stale responses when the selected proof changes', () => {
  const source = read('client/src/components/admin/PendingPayments.js');
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /requestId === allocationRequestId\.current/);
  assert.match(source, /requestId !== allocationRequestId\.current/);
  assert.match(source, /legacy_allocation_review/);
});

test('workbook report sanitizes internal numeric text values and keeps report sections', () => {
  const source = read('routes/enhanced-invoices.js');
  assert.match(source, /function exportText/);
  assert.match(source, /function exportReviewFlags/);
  assert.match(source, /useSharedStrings: false/);
  assert.match(source, /addWorksheet\('Monthly School Account'\)/);
  assert.match(source, /addWorksheet\('One-Off Fees'\)/);
  assert.match(source, /addWorksheet\('Payment Transactions Audit'\)/);
});