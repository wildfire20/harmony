const assert = require('node:assert/strict');

// Exercise the real Express route in a separate Node process. In Express 4 an
// async handler can send a response and then crash the process in its finally
// block; checking the HTTP response alone would miss that regression.
async function runScenario(scenario) {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const db = require('../config/database');
  const commands = require('../services/financeCommandService');
  const notifications = require('../services/parentNotificationService');
  const calls = [];
  const alerts = [];
  const role = scenario === 'unauthorized' ? 'teacher' : 'admin';
  process.env.JWT_SECRET = 'synthetic-payment-proof-rejection-test-only';
  db.query = async () => ({ rows: [{ id: 1, role, first_name: 'Test', last_name: 'Admin' }] });
  db.pool.connect = async () => { throw new Error('Route must not acquire its own connection'); };
  commands.rejectProof = async options => {
    calls.push(options);
    if (scenario === 'not-found') throw { status: 404, message: 'Submission not found' };
    if (scenario === 'already-approved') throw { status: 400, message: 'This submission is already approved' };
    if (scenario === 'database-error') throw new Error('Synthetic command failure');
    if (scenario === 'idempotent') return { idempotent: true, proofId: 41 };
    return { idempotent: false, proof: { id: 41, student_id: 2, amount: '500.00' } };
  };
  notifications.notifyPayment = async options => {
    alerts.push(options);
    if (scenario === 'notification-error') throw new Error('Synthetic notification failure');
  };
  const app = express();
  app.use(express.json());
  app.use('/api/payment-proofs', require('../routes/paymentProofs'));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const response = await fetch(`${url}/api/payment-proofs/41/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-reject-41' },
      body: JSON.stringify({ admin_note: scenario === 'invalid-note' ? 'x'.repeat(2001) : ' Test reason ' }),
    });
    const body = await response.json();
    const expectedStatus = { 'not-found': 404, 'already-approved': 400,
      'database-error': 500, 'invalid-note': 400, unauthorized: 403 }[scenario] || 200;
    assert.equal(response.status, expectedStatus);
    if (expectedStatus === 200) {
      assert.equal(body.message, scenario === 'idempotent'
        ? 'Submission was already rejected' : 'Submission rejected');
    }
    await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
    // A second request proves the server survived after completing cleanup.
    const health = await fetch(`${url}/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const expectedCalls = ['unauthorized', 'invalid-note'].includes(scenario) ? 0 : 1;
    assert.equal(calls.length, expectedCalls);
    if (expectedCalls) {
      assert.equal(calls[0].proofId, '41');
      assert.equal(calls[0].adminNote, 'Test reason');
      assert.equal(calls[0].idempotencyKey, 'synthetic-reject-41');
      assert.equal(calls[0].actor.id, 1);
      assert.equal(calls[0].actor.role, 'admin');
    }
    const expectsAlert = ['success', 'notification-error'].includes(scenario);
    assert.equal(alerts.length, expectsAlert ? 1 : 0);
    if (expectsAlert) assert.deepEqual(alerts[0], {
      kind: 'rejected', paymentId: 41, learnerId: 2, reason: 'Test reason',
    });
    console.log('REJECTION_ROUTE_SURVIVED');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await db.pool.end();
  }
}

if (process.env.HARMONY_REJECTION_TEST_CHILD === '1') {
  runScenario(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const test = require('node:test');
  const { spawnSync } = require('node:child_process');
  for (const scenario of ['success', 'idempotent', 'not-found', 'already-approved',
    'database-error', 'invalid-note', 'unauthorized', 'notification-error']) {
    test(`payment-proof rejection keeps server running: ${scenario}`, { timeout: 15000 }, () => {
      const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', __filename, scenario], {
        env: { ...process.env, HARMONY_REJECTION_TEST_CHILD: '1', NODE_ENV: 'test' },
        encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /REJECTION_ROUTE_SURVIVED/);
    });
  }
}
