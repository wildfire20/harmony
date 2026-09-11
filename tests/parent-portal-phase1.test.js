/*
 * Phase 1 parent portal contract tests.
 *
 * These tests deliberately use an in-memory database double and the real
 * Express routers.  They do not connect to (or modify) a database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const Module = require('node:module');
const fs = require('node:fs');

const original = new Map();
const mock = (name, exports) => {
  const resolved = require.resolve(name);
  original.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const parentChildren = {
  10: [
    { id: 101, first_name: 'Ada', last_name: 'One', student_number: 'S101', grade_id: 1, class_id: 11, grade_name: '1', class_name: 'A' },
    { id: 102, first_name: 'Bea', last_name: 'Two', student_number: 'S102', grade_id: 2, class_id: 22, grade_name: '2', class_name: 'B' },
  ],
  20: [{ id: 201, first_name: 'Cal', last_name: 'Other', student_number: 'S201', grade_id: 1, class_id: 11 }],
  30: [],
};
const audits = [];
const state = { proofs: new Map(), nextProof: 7, queries: [], nextParent: 501 };
const row = (rows) => ({ rows });
const db = {
  async query(sql, params = []) {
    state.queries.push({ sql, params });
    if (/FROM documents d/.test(sql)) {
      // Scoped document queries must use the selected learner, not merely any
      // learner linked to the parent.
      const selectedChild = Number(params[params.length - 1]);
      if (selectedChild === 102) return row([]);
      return row([{ id: 1, title: 'Calendar', description: 'Safe', document_type: 'pdf',
        original_file_name: 'calendar.pdf', file_size: 10, uploaded_at: new Date(), target_audience: 'parents', uploaded_by: 'Staff' }]);
    }
    if (/FROM parent_students/.test(sql)) {
      const ids = parentChildren[Number(params[0])] || [];
      return row(ids);
    }
    if (/FROM attendance/.test(sql)) return row([]);
    if (/SELECT \* FROM pending_payments/.test(sql)) {
      const proof = state.proofs.get(Number(params[0]));
      return row(proof ? [proof] : []);
    }
    if (/INSERT INTO pending_payments/.test(sql)) {
      const id = state.nextProof++;
      const proof = { id, parent_id: params[0], student_id: params[1], amount: params[2],
        payment_method: params[3], reference: params[4], notes: params[5], status: 'pending',
        submitted_at: new Date(), receipt_mime_type: params[10], receipt_data: params[11] };
      state.proofs.set(id, proof);
      return row([proof]);
    }
    if (/INSERT INTO payment_transactions/.test(sql)) return row([{ id: 9001 }]);
    if (/SELECT id, first_name, last_name, student_number FROM users/.test(sql)) {
      return row((params[0] || []).map(id => ({ id, first_name: 'Learner', last_name: String(id), student_number: `S${id}` })));
    }
    if (/INSERT INTO users/.test(sql) && /role/.test(sql)) {
      return row([{ id: state.nextParent++, first_name: params[0], last_name: params[1], phone_number: params[2], role: 'parent' }]);
    }
    if (/FROM invoices/.test(sql)) return row([]);
    if (/SELECT u\.\*/.test(sql) && /users u/.test(sql)) {
      const p = Number(params[0]); const id = params[1] && Number(params[1]);
      const child = (parentChildren[p] || []).find(c => !id || c.id === id);
      return row(child ? [child] : []);
    }
    if (/FROM student_one_off_fees/.test(sql)) return row([]);
    return row([]);
  },
  pool: { async connect() {
    return {
      async query(sql, params = []) {
        if (/UPDATE pending_payments/.test(sql) && /status='approved'/.test(sql)) {
          const proof = state.proofs.get(Number(params[2]));
          if (proof) proof.status = 'approved';
        }
        if (/UPDATE pending_payments/.test(sql) && /status='rejected'/.test(sql)) {
          const proof = state.proofs.get(Number(params[2]));
          if (proof) proof.status = 'rejected';
        }
        if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return row([]);
        return db.query(sql, params);
      },
      release() {},
    };
  } },
};

mock('../config/database', db);
mock('../middleware/auth', {
  authenticate: (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ message: 'Authentication required' });
    req.user = String(req.headers.authorization || '').includes('admin')
      ? { id: 99, role: 'admin', first_name: 'Test', last_name: 'Admin' }
      : { id: Number(req.headers['x-parent-id'] || 10), role: 'parent', first_name: 'Test', last_name: 'Parent' };
    next();
  },
  authorize: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' }),
});
mock('../utils/auditLogger', { logAudit: async (entry) => { audits.push(entry); }, getIp: () => '127.0.0.1' });
mock('../services/s3Service', { isConfigValid: false });
mock('../services/admissionsDocumentService', {
  detectType(buffer) {
    if (buffer.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf' };
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png' };
    return null;
  },
});

const parentRouter = require('../routes/parent');
const paymentRouter = require('../routes/paymentProofs');
const feesRouter = require('../routes/studentFees');
const app = express();
app.use(express.json());
app.use('/api/parent', parentRouter);
app.use('/api/payment-proofs', paymentRouter);
app.use('/api/student-fees', feesRouter);
const server = http.createServer(app);
let base;
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const [name, value] of original) require.cache[name] = value;
});
const request = (path, options = {}) => fetch(`${base}${path}`, {
  ...options,
  headers: { authorization: 'Bearer parent-token', ...(options.headers || {}) },
});
const json = async (path, options) => {
  const response = await request(path, options);
  return { response, body: await response.json() };
};

test('selected child_id is propagated and unauthorized children are rejected', async () => {
  const selected = await json('/api/parent/attendance?child_id=102');
  assert.equal(selected.response.status, 200);
  assert.equal(selected.body.child.id, 102);
  const denied = await json('/api/parent/attendance?child_id=201');
  assert.equal(denied.response.status, 403);
  assert.match(denied.body.message, /not linked/);
});

test('all-child parent endpoints have safe zero-child responses', async () => {
  const endpoints = ['/me', '/dashboard', '/attendance', '/grades', '/announcements', '/invoices', '/documents'];
  for (const endpoint of endpoints) {
    const result = await json(`/api/parent${endpoint}`, { headers: { 'x-parent-id': '30' } });
    assert.equal(result.response.status, 200, endpoint);
    assert.equal(result.body.child, null, endpoint);
  }
  const docs = await json('/api/parent/documents', { headers: { 'x-parent-id': '30' } });
  assert.deepEqual(docs.body, { documents: [], child: null, children: [] });
});

test('parent isolation applies to documents and payment submissions', async () => {
  const docs = await json('/api/parent/documents?child_id=201', { headers: { 'x-parent-id': '20' } });
  assert.equal(docs.response.status, 200);
  assert.deepEqual(docs.body.documents.map(d => d.id), [1]);
  assert.equal(Object.hasOwn(docs.body.documents[0], 'file_path'), false);
  assert.equal(Object.hasOwn(docs.body.documents[0], 's3_key'), false);
  const otherLinkedChild = await json('/api/parent/documents?child_id=102', { headers: { 'x-parent-id': '10' } });
  assert.equal(otherLinkedChild.response.status, 200);
  assert.deepEqual(otherLinkedChild.body.documents, []);
  const missingChildContext = await json('/api/parent/documents', { headers: { 'x-parent-id': '20' } });
  assert.equal(missingChildContext.response.status, 400);
  const own = await json('/api/payment-proofs/my?child_id=101', { headers: { 'x-parent-id': '20' } });
  assert.equal(own.response.status, 403);
});

test('document file endpoints remain authenticated and do not expose storage paths', async () => {
  const unauth = await fetch(`${base}/api/parent/documents/1/download`);
  assert.equal(unauth.status, 401);
  const missing = await json('/api/parent/documents/999/view?child_id=201');
  assert.equal(missing.response.status, 404);
});

test('legacy document routes explicitly reject parent-role bypasses', () => {
  const source = fs.readFileSync(require.resolve('../routes/documents'), 'utf8');
  assert.equal((source.match(/user\.role === 'parent'/g) || []).length >= 2, true);
  assert.match(source, /Use the parent portal document endpoint/);
});

test('portal refresh clears a stale selected child when server returns none', () => {
  const source = fs.readFileSync(require.resolve('../client/src/components/parent/ParentPortal.js'), 'utf8');
  assert.match(source, /freshChildren\.length === 0/);
  assert.match(source, /localStorage\.removeItem\('parentChild'\)/);
});

test('portal refresh falls back after partial unlink instead of restoring stale selection', () => {
  const source = fs.readFileSync(require.resolve('../client/src/components/parent/ParentPortal.js'), 'utf8');
  assert.match(source, /const updated = refreshed \|\| freshChildren\[0\]/);
  assert.doesNotMatch(source, /const updated = refreshed \|\| prev/);
});

test('payment input is bounded and receipt magic bytes are checked', async () => {
  const badAmount = await json('/api/payment-proofs', {
    method: 'POST', body: JSON.stringify({ amount: '1e3', payment_method: 'eft' }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(badAmount.response.status, 400);
  const form = new FormData();
  form.set('amount', '25.00'); form.set('payment_method', 'eft');
  form.set('receipt', new Blob(['not a pdf'], { type: 'application/pdf' }), 'receipt.pdf');
  const badFile = await request('/api/payment-proofs', { method: 'POST', body: form });
  assert.equal(badFile.status, 400);
  assert.equal(state.proofs.size, 0);
});

test('payment submission and receipt responses are minimized and secure', async () => {
  const result = await json('/api/payment-proofs', {
    method: 'POST', body: JSON.stringify({ amount: '25.00', payment_method: 'EFT', reference: 'r' }),
    headers: { 'content-type': 'application/json', 'x-parent-id': '10' },
  });
  assert.equal(result.response.status, 201);
  assert.deepEqual(Object.keys(result.body.submission).sort(),
    ['amount', 'id', 'payment_method', 'reference', 'status', 'submitted_at'].sort());
  const mine = await json(`/api/payment-proofs/my?child_id=101`, { headers: { 'x-parent-id': '10' } });
  assert.equal(mine.response.status, 200);
  assert.equal(Object.hasOwn(mine.body.submissions[0] || {}, 'receipt_data'), false);
});

test('banking details endpoint returns the centralized authoritative values', async () => {
  const result = await json('/api/parent/banking-details');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.banking.accountNumber, '63035320265');
  assert.equal(result.body.banking.branchCode, '250655');
});

test('parent management cannot perform name-based enrollment relinking', () => {
  const route = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes/parent.js'), 'utf8');
  const management = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'client/src/components/admin/ParentManagement.js'), 'utf8');
  assert.doesNotMatch(route, /sync-enrollments|LOWER\(u\.first_name\)/);
  assert.doesNotMatch(management, /sync-enrollments|handleSyncEnrollments/);
  assert.match(route, /admin\/direct-link/);
  for (const field of ['student_id', 'parent_id']) assert.match(route, new RegExp(field));
  assert.doesNotMatch(route, /admin\/link-enrollment/);
  assert.doesNotMatch(route, /FROM enrollments/);
  assert.match(route, /BEGIN/);
  assert.match(route, /ROLLBACK/);
  assert.match(route, /parent_direct_link/);
  assert.match(route, /Learner and parent identifiers must exist/);
});

test('enhanced invoice banking output uses every authoritative banking field', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes/enhanced-invoices.js'), 'utf8');
  for (const field of ['bank', 'accountHolder', 'accountType', 'accountNumber', 'branchCode']) {
    assert.match(source, new RegExp(`BANKING_DETAILS\\.${field}`));
  }
});

test('parent fee lookup rejects cross-parent child selection and safely handles no child', async () => {
  const denied = await json('/api/student-fees/for-child?child_id=201', { headers: { 'x-parent-id': '10' } });
  assert.equal(denied.response.status, 403);
  const empty = await json('/api/student-fees/for-child', { headers: { 'x-parent-id': '30' } });
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body.fees, []);
  assert.equal(empty.body.child, null);
});

test('admin parent creation validates links before commit and records its audit contract', async () => {
  const invalid = await json('/api/parent/admin/create', {
    method: 'POST', body: JSON.stringify({ first_name: 'P', last_name: 'Invalid', phone_number: '0712345678', student_ids: [0] }),
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
  });
  assert.equal(invalid.response.status, 400);
  const before = audits.length;
  const created = await json('/api/parent/admin/create', {
    method: 'POST', body: JSON.stringify({ first_name: 'P', last_name: 'New', phone_number: '0712345678', student_ids: [101] }),
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.linkedStudents[0].id, 101);
  assert.equal(audits.length, before + 1);
  assert.equal(audits.at(-1).action, 'parent_create_or_link');
});

test('approval is transactional and idempotent under repeated approval', async () => {
  const proofId = [...state.proofs.keys()][0];
  const first = await json(`/api/payment-proofs/${proofId}/approve`, {
    method: 'POST', body: JSON.stringify({ admin_note: 'checked' }),
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.status, 'approved');
  const second = await json(`/api/payment-proofs/${proofId}/approve`, {
    method: 'POST', body: JSON.stringify({}),
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.status, 'approved');
  assert.match(second.body.message, /already approved/);
  assert.equal(state.proofs.get(proofId).status, 'approved');
  assert.ok(audits.some(a => a.action === 'payment_proof_approve'));
});