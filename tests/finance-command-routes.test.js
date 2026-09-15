/*
 * Route-level command integration contract.  The router is real Express code;
 * only infrastructure and the command implementation are replaced so this
 * test proves the public API delegates its write to the command layer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const original = new Map();
function mock(name, exports) {
  const resolved = require.resolve(name);
  original.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, exports,
  };
}

function restore() {
  for (const [resolved, cache] of original) {
    if (cache) require.cache[resolved] = cache;
    else delete require.cache[resolved];
  }
  original.clear();
}

function request(app, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1', port, path, method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...extraHeaders,
        },
      }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        });
      });
      req.on('error', (error) => { server.close(); reject(error); });
      req.end(payload);
    });
  });
}

test('manual payment route delegates exact invoice allocation to finance commands', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      if (/SELECT \* FROM payment_transactions/.test(sql)) {
        return { rows: [{ id: 901, amount: '100.00' }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  mock('../config/database', {
    async query(sql) {
      if (/FROM users/.test(sql)) {
        return {
          rows: [{ id: 7, student_number: 'HAR007', first_name: 'A', last_name: 'Learner' }],
        };
      }
      return { rows: [] };
    },
    pool: { async connect() { return client; } },
  });
  mock('../middleware/auth', {
    authenticate: (req, res, next) => {
      req.user = { id: 99, role: 'admin', first_name: 'Admin', last_name: 'User' };
      next();
    },
    authorize: () => (req, res, next) => next(),
  });
  mock('../services/financeCommandService', {
    recordPayment: async (options) => {
      calls.push(options);
      return {
        allocations: [{
          transactionId: 901, invoiceId: 44, amount: 100,
          status: 'Partial', dueDate: '2027-01-31',
        }],
        transactionIds: [901],
      };
    },
    reversePayment: async () => {},
    correctPayment: async () => {},
    applyCredit: async () => {},
  });
  mock('../services/parentNotificationService', {
    notifyPayment: async () => {},
  });
  mock('../utils/auditLogger', {
    logAudit: async () => {},
    getIp: () => '127.0.0.1',
  });

  try {
    const router = require('../routes/enhanced-invoices');
    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await request(app, 'POST', '/manual-payment', {
      student_id: 7,
      amount: 100,
      payment_date: '2027-01-15',
      invoice_id: 44,
      payment_method: 'cash',
      reference: 'CASH-901',
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].invoiceId, 44);
    assert.equal(calls[0].studentId, 7);
  } finally {
    restore();
  }
});

test('monthly billing route delegates the complete period command', async () => {
  const calls = [];
  mock('../config/database', {
    async query() { return { rows: [] }; },
    pool: { async connect() { throw new Error('route must not open a database client'); } },
  });
  mock('../middleware/auth', {
    authenticate: (req, res, next) => {
      req.user = { id: 99, role: 'admin', first_name: 'Admin', last_name: 'User' };
      next();
    },
    authorize: () => (req, res, next) => next(),
  });
  mock('../services/financeCommandService', {
    generateMonthlyInvoices: async (options) => {
      calls.push(options);
      return {
        invoices: [{ id: 321, amount_due: '100.00' }],
        totalStudents: 1,
        invoicesCreated: 1,
        skipped: 0,
        siblingDiscountsApplied: 0,
        teacherDiscountsApplied: 0,
        month: 2,
        year: 2029,
        dueDate: '2029-02-28',
      };
    },
  });
  mock('../utils/auditLogger', {
    logAudit: async () => {},
    getIp: () => '127.0.0.1',
  });

  try {
    const router = require('../routes/invoices');
    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await request(
      app, 'POST', '/generate-monthly',
      { month: 2, year: 2029 },
      { 'idempotency-key': 'monthly-route-test-2029' },
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.summary.invoicesCreated, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].month, 2);
    assert.equal(calls[0].year, 2029);
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0], 'legacyCompatibility'), false);
    assert.equal(calls[0].idempotencyKey, 'monthly-route-test-2029');
  } finally {
    restore();
  }
});