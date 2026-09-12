const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  parseInvoiceListQuery,
  appendPeriodFilters,
} = require('../utils/invoiceQuery');
const { getFinanceSummary } = require('../services/financeLedger');

test('standard 2026 invoice request accepts all months with pagination', () => {
  assert.deepEqual(parseInvoiceListQuery({
    year: '2026', page: '1', limit: '20',
  }), {
    status: undefined,
    month: undefined,
    year: 2026,
    studentNumber: undefined,
    page: 1,
    limit: 20,
    sortBy: 'due_date',
    sortOrder: 'DESC',
  });
});

test('invoice filters accept all/specific statuses, all/specific months, and student search', () => {
  assert.equal(parseInvoiceListQuery({ status: '' }).status, undefined);
  assert.equal(parseInvoiceListQuery({ status: 'Paid' }).status, 'Paid');
  assert.equal(parseInvoiceListQuery({ year: '2026' }).month, undefined);
  assert.equal(parseInvoiceListQuery({ month: '2', year: '2026' }).month, 2);
  assert.equal(parseInvoiceListQuery({ studentNumber: ' HAR001 ' }).studentNumber, 'HAR001');
  assert.throws(() => parseInvoiceListQuery({ status: 'Unknown' }), /status/);
  assert.throws(() => parseInvoiceListQuery({ page: '0' }), /page/);
  assert.throws(() => parseInvoiceListQuery({ limit: '101' }), /limit/);
});

test('period clauses support year-only and month-plus-year filtering', () => {
  const clauses = [];
  const params = [];
  appendPeriodFilters(clauses, params, 'i.due_date', { year: 2026 });
  assert.deepEqual(params, [2026]);
  assert.deepEqual(clauses, ['EXTRACT(YEAR FROM i.due_date) = $1']);

  appendPeriodFilters(clauses, params, 'i.due_date', { month: 2, year: 2026 });
  assert.deepEqual(params, [2026, 2, 2026]);
  assert.deepEqual(clauses.slice(1), [
    'EXTRACT(MONTH FROM i.due_date) = $2',
    'EXTRACT(YEAR FROM i.due_date) = $3',
  ]);
});

test('authoritative finance summary supports year-only filters and legitimate empty results', async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM invoices')) return { rows: [] };
      return { rows: [{ unallocated: 0 }] };
    },
  };
  const summary = await getFinanceSummary({ year: 2026 }, executor);
  assert.equal(summary.totalInvoices, 0);
  assert.equal(summary.totalOutstanding, 0);
  assert.match(calls[0].sql, /EXTRACT\(YEAR FROM i\.due_date\) = \$1/);
  assert.doesNotMatch(calls[0].sql, /EXTRACT\(MONTH/);
  assert.deepEqual(calls[0].params, [2026]);
});

test('/api/invoices handler returns paginated year-only and fully filtered results', async () => {
  const database = require('../config/database');
  const financeLedger = require('../services/financeLedger');
  const originalQuery = database.query;
  const originalSummary = financeLedger.getFinanceSummary;
  const routePath = require.resolve('../routes/invoices');
  const databaseCalls = [];
  const summaryCalls = [];
  database.query = async (sql, params = []) => {
    databaseCalls.push({ sql, params });
    if (/COUNT\(\*\) as total_students/i.test(sql)) {
      return { rows: [{ total_students: '2' }] };
    }
    if (/SELECT COUNT\(\*\) as total\s+FROM invoices/i.test(sql)) {
      return { rows: [{ total: '1' }] };
    }
    if (/SELECT\s+i\.id/i.test(sql) && /ORDER BY/i.test(sql)) {
      return {
        rows: [{
          id: 1, student_number: 'HAR001', reference_number: 'HAR001',
          amount_due: 1000, amount_paid: 250, outstanding_balance: 750,
          due_date: '2026-02-28', status: 'Partial',
        }],
      };
    }
    throw new Error(`Unexpected invoice route query: ${sql}`);
  };
  financeLedger.getFinanceSummary = async (filters) => {
    summaryCalls.push(filters);
    return {
      totalInvoices: 1, paidCount: 0, unpaidCount: 0, partialCount: 1,
      overpaidCount: 0, totalAmountDue: 1000, totalAmountPaid: 250,
      totalOutstanding: 750, totalOverpaid: 0, unallocated: 0,
      credit: 0, netOutstanding: 750,
    };
  };
  delete require.cache[routePath];

  try {
    const router = require(routePath);
    const route = router.stack.find((layer) => layer.route?.path === '/' &&
      layer.route.methods.get);
    const handler = route.route.stack.at(-1).handle;
    const invoke = async (query) => {
      let payload;
      let statusCode = 200;
      await handler(
        { query, user: { id: 1, role: 'admin' } },
        {
          status(code) { statusCode = code; return this; },
          json(value) { payload = value; return this; },
        },
      );
      return { statusCode, payload };
    };

    let response = await invoke({ year: '2026', page: '1', limit: '20' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.pagination.currentPage, 1);
    assert.equal(response.payload.pagination.limit, 20);
    assert.equal(response.payload.summary.totalOutstanding, 750);
    assert.equal(response.payload.invoices[0].student_number, 'HAR001');
    assert.deepEqual(summaryCalls[0], {
      status: undefined, month: undefined, year: 2026, studentNumber: undefined,
    });

    databaseCalls.length = 0;
    response = await invoke({
      status: 'Paid', month: '2', year: '2026',
      studentNumber: 'HAR001', page: '2', limit: '10',
    });
    assert.equal(response.statusCode, 200);
    const listCall = databaseCalls.find((call) =>
      /SELECT\s+i\.id/i.test(call.sql) && /ORDER BY/i.test(call.sql));
    assert.match(listCall.sql, /i\.status = \$1/);
    assert.match(listCall.sql, /EXTRACT\(MONTH FROM i\.due_date\) = \$2/);
    assert.match(listCall.sql, /EXTRACT\(YEAR FROM i\.due_date\) = \$3/);
    assert.match(listCall.sql, /i\.student_number ILIKE \$4/);
    assert.deepEqual(listCall.params, ['Paid', 2, 2026, '%HAR001%', 10, 10]);
  } finally {
    database.query = originalQuery;
    financeLedger.getFinanceSummary = originalSummary;
    delete require.cache[routePath];
  }
});

test('dashboard distinguishes backend failure from zero totals and preserves export and Parent finance paths', () => {
  const dashboard = fs.readFileSync(
    require.resolve('../client/src/components/payments/PaymentDashboard.js'), 'utf8',
  );
  const exportSource = fs.readFileSync(
    require.resolve('../client/src/components/payments/StudentPaymentExport.js'), 'utf8',
  );
  const parentRoutes = fs.readFileSync(require.resolve('../routes/parent.js'), 'utf8');
  assert.match(dashboard, /useState\(null\)/);
  assert.match(dashboard, /Finance data is unavailable/);
  assert.match(dashboard, /The values above are not zero balances/);
  assert.match(dashboard, /No invoices found for the selected filters/);
  assert.match(dashboard, /Showing the last successfully loaded invoice data/);
  assert.match(exportSource, /\/api\/enhanced-invoices\/student-payment-history\//);
  assert.match(parentRoutes, /getStudentLedger/);
});