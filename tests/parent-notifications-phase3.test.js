/*
 * Phase 3 parent notification centre contract tests.
 *
 * These tests use the same in-memory PostgreSQL double style as the Phase 1
 * and Phase 2 parent tests.  They deliberately do not apply migrations or
 * connect to a real database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');

const original = new Map();
const mock = (name, exports) => {
  const resolved = require.resolve(name);
  if (!original.has(resolved)) original.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const learners = new Map([
  [101, { id: 101, first_name: 'Ada', last_name: 'One', grade_id: 1, class_id: 11 }],
  [102, { id: 102, first_name: 'Bea', last_name: 'Two', grade_id: 2, class_id: 22 }],
  [201, { id: 201, first_name: 'Cal', last_name: 'Other', grade_id: 1, class_id: 11 }],
]);
const parents = new Map([
  [10, { id: 10, email: 'a@example.test', first_name: 'Parent', last_name: 'A' }],
  [20, { id: 20, email: 'b@example.test', first_name: 'Parent', last_name: 'B' }],
]);

const state = {
  links: new Map([[10, new Set([101, 102])], [20, new Set([201])]]),
  notifications: [],
  reads: new Map(),
  pushSubscriptions: [],
  queries: [],
  nextNotification: 1,
  nextPush: 1,
  pushDeliveries: [],
};
const row = (rows, rowCount = rows.length) => ({ rows, rowCount });
const linked = (parentId, learnerId) => state.links.get(Number(parentId))?.has(Number(learnerId));
const notificationVisible = (notification, parentId) =>
  Number(notification.parent_id) === Number(parentId) &&
  (notification.learner_id == null || linked(parentId, notification.learner_id));

function resetState() {
  state.notifications = [];
  state.reads = new Map();
  state.pushSubscriptions = [];
  state.queries = [];
  state.nextNotification = 1;
  state.nextPush = 1;
  state.pushDeliveries = [];
  state.links = new Map([[10, new Set([101, 102])], [20, new Set([201])]]);
}

const notificationDb = {
  async query(sql, params = []) {
    state.queries.push({ sql, params });

    // Recipient discovery is kept in the double rather than trusting caller
    // supplied parent IDs.  This catches accidental school-wide broadening.
    if (/SELECT DISTINCT p\.id AS parent_id/.test(sql)) {
      const parentIds = /p\.id = ANY/.test(sql) ? new Set(params[0].map(Number)) : null;
      const learnerMatch = sql.match(/ps\.student_id = \$(\d+)/);
      const gradeMatch = sql.match(/s\.grade_id = \$(\d+)/);
      const classMatch = sql.match(/s\.class_id = \$(\d+)/);
      const learnerId = learnerMatch ? Number(params[Number(learnerMatch[1]) - 1]) : null;
      const gradeId = gradeMatch ? Number(params[Number(gradeMatch[1]) - 1]) : null;
      const classId = classMatch ? Number(params[Number(classMatch[1]) - 1]) : null;
      const rows = [];
      for (const [parentId, children] of state.links) {
        if (parentIds && !parentIds.has(parentId)) continue;
        for (const childId of children) {
          const learner = learners.get(childId);
          if (!learner) continue;
          if (learnerId != null && childId !== learnerId) continue;
          if (gradeId != null && learner.grade_id !== gradeId) continue;
          if (classId != null && learner.class_id !== classId) continue;
          rows.push({
            parent_id: parentId,
            email: parents.get(parentId)?.email,
            parent_first_name: parents.get(parentId)?.first_name,
            learner_id: childId,
            first_name: learner.first_name,
            last_name: learner.last_name,
          });
        }
      }
      return row(rows);
    }

    if (/SELECT id, first_name, last_name FROM users WHERE id=\$1 AND role='student'/.test(sql)) {
      const learner = learners.get(Number(params[0]));
      return row(learner ? [learner] : []);
    }

    if (/INSERT INTO parent_notifications/.test(sql)) {
      const [eventType, parentId, learnerId, title, summary, deepLink, dedupeKey, important] = params;
      if (!state.links.has(Number(parentId)) ||
          (learnerId != null && !linked(parentId, learnerId))) return row([]);
      if (state.notifications.some((n) => Number(n.parent_id) === Number(parentId) && n.dedupe_key === dedupeKey)) {
        return row([]);
      }
      const notification = {
        id: state.nextNotification++,
        event_type: eventType,
        parent_id: Number(parentId),
        learner_id: learnerId == null ? null : Number(learnerId),
        title,
        summary,
        deep_link: deepLink,
        dedupe_key: dedupeKey,
        important: Boolean(important),
        created_at: new Date(Date.now() + state.notifications.length),
      };
      state.notifications.push(notification);
      return row([{ id: notification.id }]);
    }

    if (/SELECT n\.id, n\.event_type/.test(sql) && /FROM parent_notifications n/.test(sql)) {
      const parentId = Number(params[0]);
      const limit = Number(params[1]);
      const rows = state.notifications
        .filter((n) => notificationVisible(n, parentId))
        .map((n) => {
          const readAt = state.reads.get(`${n.id}:${parentId}`) || null;
          return {
            id: n.id, event_type: n.event_type, title: n.title, summary: n.summary,
            deep_link: n.deep_link, learner_id: n.learner_id, created_at: n.created_at,
            important: n.important, read: Boolean(readAt), read_at: readAt,
            learner_name: n.learner_id ? `${learners.get(n.learner_id)?.first_name} ${learners.get(n.learner_id)?.last_name}` : null,
          };
        })
        .slice(0, limit);
      return row(rows);
    }

    if (/COUNT\(\*\)::int AS count/.test(sql) && /parent_notifications/.test(sql)) {
      const parentId = Number(params[0]);
      const count = state.notifications
        .filter((n) => notificationVisible(n, parentId) && !state.reads.has(`${n.id}:${parentId}`)).length;
      return row([{ count }]);
    }

    if (/INSERT INTO parent_notification_reads/.test(sql) && /n\.id = \$1/.test(sql)) {
      const [notificationId, parentId] = params.map(Number);
      const n = state.notifications.find((item) => item.id === notificationId);
      if (!n || Number(n.parent_id) !== parentId || !notificationVisible(n, parentId)) return row([]);
      const key = `${notificationId}:${parentId}`;
      const readAt = state.reads.get(key) || new Date();
      state.reads.set(key, readAt);
      return row([{ notification_id: notificationId, read_at: readAt }]);
    }

    if (/INSERT INTO parent_notification_reads/.test(sql) && /n\.parent_id = \$1/.test(sql)) {
      const parentId = Number(params[0]);
      const visible = state.notifications.filter((n) => notificationVisible(n, parentId));
      for (const n of visible) state.reads.set(`${n.id}:${parentId}`, state.reads.get(`${n.id}:${parentId}`) || new Date());
      return row(visible.map((n) => ({ notification_id: n.id })));
    }

    if (/SELECT u\.id, u\.first_name, u\.last_name, u\.student_number/.test(sql) &&
        /FROM parent_students ps/.test(sql)) {
      const children = [...(state.links.get(Number(params[0])) || [])]
        .map((id) => learners.get(id))
        .filter(Boolean)
        .map((learner) => ({
          ...learner,
          student_number: `S${learner.id}`,
          grade_name: String(learner.grade_id),
          class_name: String(learner.class_id),
          is_boarder: false, uses_transport: false, uses_aftercare: false,
        }));
      return row(children);
    }

    if (/SELECT parent_id FROM parent_push_subscriptions WHERE endpoint/.test(sql)) {
      const found = state.pushSubscriptions.find((subscription) => subscription.endpoint === params[0]);
      return row(found ? [{ parent_id: found.parent_id }] : []);
    }

    if (/INSERT INTO parent_push_subscriptions/.test(sql)) {
      const [parentId, endpoint, subscription] = params;
      const found = state.pushSubscriptions.find((item) => item.endpoint === endpoint);
      if (found && Number(found.parent_id) !== Number(parentId)) return row([]);
      if (found) Object.assign(found, { subscription, is_active: true });
      else state.pushSubscriptions.push({ id: state.nextPush++, parent_id: Number(parentId), endpoint, subscription, is_active: true });
      return row([{ id: found?.id || state.pushSubscriptions.at(-1).id }]);
    }

    if (/UPDATE parent_push_subscriptions SET is_active = false/.test(sql) && /WHERE endpoint/.test(sql)) {
      const [endpoint, parentId] = params;
      for (const subscription of state.pushSubscriptions) {
        if (subscription.endpoint === endpoint && Number(subscription.parent_id) === Number(parentId)) subscription.is_active = false;
      }
      return row([]);
    }

    // The parent router's other child lookup calls use this form.
    if (/FROM users u JOIN parent_students ps/.test(sql)) {
      const parentId = Number(params[0]);
      const childId = params.length > 1 ? Number(params[1]) : null;
      const ids = [...(state.links.get(parentId) || [])].filter((id) => childId == null || id === childId);
      return row(ids.map((id) => ({ ...learners.get(id), student_number: `S${id}` })));
    }

    if (/FROM parent_push_subscriptions pps/.test(sql)) {
      const wanted = new Set((params[0] || []).map(Number));
      return row(state.pushSubscriptions
        .filter((subscription) => wanted.has(Number(subscription.parent_id)) && subscription.is_active)
        .map((subscription) => ({ id: subscription.id, subscription: subscription.subscription })));
    }
    if (/FROM parent_push_subscriptions/.test(sql) && /parent_id = ANY/.test(sql)) {
      const wanted = new Set((params[0] || []).map(Number));
      return row(state.pushSubscriptions
        .filter((subscription) => wanted.has(Number(subscription.parent_id)) && subscription.is_active)
        .map((subscription) => ({ id: subscription.id, subscription: subscription.subscription })));
    }
    if (/UPDATE parent_push_subscriptions SET is_active = false, updated_at/.test(sql) ||
        /UPDATE parent_push_subscriptions SET is_active = false WHERE id/.test(sql)) {
      const id = Number(params[0]);
      const found = state.pushSubscriptions.find((subscription) => subscription.id === id);
      if (found) found.is_active = false;
      return row([]);
    }

    return row([]);
  },
  pool: {
    async connect() {
      return {
        query: notificationDb.query.bind(notificationDb),
        release() {},
      };
    },
  },
};

const pushMock = {
  async sendToParents(parentIds, payload) {
    state.pushDeliveries.push({ parentIds, payload });
    if (pushMock.fail) throw new Error('push service unavailable');
  },
  fail: false,
};

mock('../config/database', notificationDb);
mock('../middleware/auth', {
  authenticate: (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ message: 'Authentication required' });
    req.user = { id: Number(req.headers['x-parent-id'] || 10), role: 'parent', first_name: 'Parent', last_name: 'Test' };
    next();
  },
  authorize: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' }),
});
mock('../services/gmailService', {
  sendEmail: async () => ({ success: true }),
  escapeHtml: (value) => String(value),
});
mock('../services/pushNotification', pushMock);

const notificationService = require('../services/parentNotificationService');
const parentRouter = require('../routes/parent');
const app = express();
app.use(express.json());
app.use('/api/parent', parentRouter);
const server = http.createServer(app);
let base;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  resetState();
  pushMock.fail = false;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of original) {
    if (value) require.cache[name] = value;
    else delete require.cache[name];
  }
});

const request = (path, options = {}) => fetch(`${base}${path}`, {
  ...options,
  headers: { authorization: 'Bearer parent-token', ...(options.headers || {}) },
});
const json = async (path, options) => {
  const response = await request(path, options);
  return { response, body: await response.json() };
};

test('parent isolation, linked-learner filtering, labels, unread count, and read operations', async () => {
  const own = await notificationService.createParentNotifications({
    eventType: 'attendance_absent', title: 'Ada was marked absent', summary: 'Ada was absent.',
    destination: 'attendance', dedupeKey: 'absence-101', learnerId: 101,
  });
  await notificationService.createParentNotifications({
    eventType: 'attendance_late', title: 'Bea was marked late', summary: 'Bea was late.',
    destination: 'attendance', dedupeKey: 'late-102', learnerId: 102,
  });
  await notificationService.createParentNotifications({
    eventType: 'attendance_late', title: 'Cal was marked late', summary: 'Cal was late.',
    destination: 'attendance', dedupeKey: 'late-201', learnerId: 201,
  });
  assert.equal(own.created, 1);
  assert.equal(state.notifications.length, 3);

  const parentA = await json('/api/parent/notifications', { headers: { 'x-parent-id': '10' } });
  assert.equal(parentA.response.status, 200);
  assert.equal(parentA.body.notifications.length, 2);
  assert.deepEqual(new Set(parentA.body.notifications.map((item) => item.learner_name)), new Set(['Ada One', 'Bea Two']));
  assert.match(state.queries.find((q) => /FROM parent_notifications n/.test(q.sql)).sql, /n\.parent_id = \$1/);

  const parentB = await json('/api/parent/notifications', { headers: { 'x-parent-id': '20' } });
  assert.equal(parentB.body.notifications.length, 1);
  assert.equal(parentB.body.notifications[0].learner_name, 'Cal Other');
  const deniedRead = await json(`/api/parent/notifications/${parentB.body.notifications[0].id}/read`, {
    method: 'PUT', headers: { 'x-parent-id': '10' },
  });
  assert.equal(deniedRead.response.status, 404);

  state.links.get(10).delete(101);
  const unlinked = await json('/api/parent/notifications', { headers: { 'x-parent-id': '10' } });
  assert.equal(unlinked.body.notifications.length, 1);
  assert.equal(unlinked.body.notifications[0].learner_name, 'Bea Two');
  state.links.get(10).delete(102);
  const unreadAfterUnlink = await json('/api/parent/notifications/unread-count', { headers: { 'x-parent-id': '10' } });
  assert.equal(unreadAfterUnlink.body.count, 0);

  state.links.get(10).add(101);
  state.links.get(10).add(102);
  const notificationId = state.notifications.find((n) => n.parent_id === 10).id;
  const count = await json('/api/parent/notifications/unread-count', { headers: { 'x-parent-id': '10' } });
  assert.equal(count.body.count, 2);
  const marked = await json(`/api/parent/notifications/${notificationId}/read`, {
    method: 'PUT', headers: { 'x-parent-id': '10' },
  });
  assert.equal(marked.response.status, 200);
  assert.equal((await json('/api/parent/notifications/unread-count', { headers: { 'x-parent-id': '10' } })).body.count, 1);

  await notificationService.createParentNotifications({
    eventType: 'academic_result_published', title: 'Result', summary: 'A result is ready.',
    destination: 'grades', dedupeKey: 'result-101', learnerId: 101,
  });
  await notificationService.createParentNotifications({
    eventType: 'document_published', title: 'Document', summary: 'A document is ready.',
    destination: 'documents', dedupeKey: 'document-global', parentIds: [10],
  });
  const allRead = await json('/api/parent/notifications/read-all', {
    method: 'PUT', headers: { 'x-parent-id': '10' },
  });
  assert.equal(allRead.response.status, 200);
  assert.equal((await json('/api/parent/notifications/unread-count', { headers: { 'x-parent-id': '10' } })).body.count, 0);
});

test('deduplicates source events and persists only allowlisted portal links', async () => {
  const first = await notificationService.createParentNotifications({
    eventType: 'custom', title: 'Safe', summary: 'Safe summary', destination: '/parent/grades',
    dedupeKey: 'same-event', learnerId: 101,
  });
  const second = await notificationService.createParentNotifications({
    eventType: 'custom', title: 'Safe', summary: 'Safe summary', destination: 'grades',
    dedupeKey: 'same-event', learnerId: 101,
  });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(state.notifications[0].deep_link, '/parent/grades');
  for (const destination of Object.values(notificationService.DEEP_LINKS)) {
    assert.equal(notificationService.destinationFor(destination), destination);
  }
  assert.throws(() => notificationService.destinationFor('https://evil.example/steal'), /Unsupported/);
  assert.throws(() => notificationService.destinationFor('/admin/users'), /Unsupported/);
});

test('attendance, academic, payment, and invoice notification contracts include learner and event identity', async () => {
  const absent = await notificationService.notifyAttendance({ learnerId: 101, status: 'absent', date: '2027-02-03' });
  const late = await notificationService.notifyAttendance({ learnerId: 102, status: 'late', date: '2027-02-03' });
  const ignored = await notificationService.notifyAttendance({ learnerId: 101, status: 'present', date: '2027-02-03' });
  const result = await notificationService.notifyAcademicResult({
    submissionId: 88, learnerId: 101, subject: 'Mathematics', publicationKey: 'pub-88',
  });
  const submitted = await notificationService.notifyPayment({ kind: 'submitted', paymentId: 9, learnerId: 101, amount: 20 });
  const approved = await notificationService.notifyPayment({ kind: 'approved', paymentId: 10, learnerId: 101, amount: 20 });
  const rejected = await notificationService.notifyPayment({
    kind: 'rejected',
    paymentId: 11,
    learnerId: 101,
    reason: 'Receipt unclear. Contact finance at parent@example.test; ref 123456789.',
  });
  const applied = await notificationService.notifyPayment({ kind: 'applied', paymentId: 12, learnerId: 101, amount: 20 });
  const invoice = await notificationService.notifyInvoice({ invoiceId: 13, learnerId: 102, amount: 100 });
  assert.equal(absent.created, 1);
  assert.equal(late.created, 1);
  assert.equal(ignored.created, 0);
  assert.equal(result.created, 1);
  assert.equal(submitted.created, 1);
  assert.equal(approved.created, 1);
  assert.equal(rejected.created, 1);
  assert.equal(applied.created, 1);
  assert.equal(invoice.created, 1);
  assert.deepEqual(state.notifications.map((n) => n.event_type), [
    'attendance_absent', 'attendance_late', 'academic_result_published',
    'payment_proof_submitted', 'payment_proof_approved', 'payment_proof_rejected',
    'payment_applied', 'invoice_created',
  ]);
  assert.ok(state.notifications.every((n) => n.learner_id != null));
  assert.equal(state.notifications.find((n) => n.event_type === 'invoice_created').deep_link, '/parent/invoices');
  const rejectedRow = state.notifications.find((n) => n.event_type === 'payment_proof_rejected');
  assert.match(rejectedRow.summary, /Reason: Receipt unclear/);
  assert.doesNotMatch(rejectedRow.summary, /parent@example|123456789/);
  assert.ok(rejectedRow.summary.length <= 500);
  const bounded = notificationService.safeRejectionReason(
    `${'A'.repeat(400)} https://private.example/review parent@example.test ref 123456789`,
  );
  assert.ok(bounded.length <= 160);
  assert.doesNotMatch(bounded, /https?:|private\.example|parent@example|123456789/);
});

test('announcement and document targeting honours parent-safe audience and grade/class recipients', async () => {
  const staff = await notificationService.notifyAnnouncement({
    id: 1, title: 'Staff only', target_audience: 'staff', grade_id: null, class_id: null,
  });
  assert.equal(staff.created, 0);
  const targetedAnnouncement = await notificationService.notifyAnnouncement({
    id: 2, title: 'Grade one notice', target_audience: 'students', grade_id: 1, class_id: null,
  });
  assert.equal(targetedAnnouncement.created, 0);
  assert.deepEqual(state.notifications, []);

  resetState();
  const globalAnnouncement = await notificationService.notifyAnnouncement({
    id: 3, title: 'Whole school', target_audience: 'everyone', grade_id: null, class_id: null,
  });
  assert.equal(globalAnnouncement.created, 2);
  assert.deepEqual(state.notifications.map((n) => [n.parent_id, n.learner_id]), [[10, null], [20, null]]);

  resetState();
  const targetedDocument = await notificationService.notifyDocument({
    id: 4, title: 'Grade two handbook', target_audience: 'parents', grade_id: 2, class_id: 22,
  });
  assert.equal(targetedDocument.created, 1);
  assert.deepEqual(state.notifications.map((n) => [n.parent_id, n.learner_id]), [[10, 102]]);
  const studentDocument = await notificationService.notifyDocument({
    id: 5, title: 'Student-only', target_audience: 'students', grade_id: null, class_id: null,
  });
  assert.equal(studentDocument.created, 0);
});

test('push endpoint ownership is rejected and unsubscribe only changes the owning parent', async () => {
  const subscription = {
    endpoint: 'https://push.example.test/subscription-a',
    keys: { p256dh: 'abcdefghijklmnop', auth: 'qrstuvwxyzabcdef' },
  };
  const first = await json('/api/parent/push/subscribe', {
    method: 'POST', body: JSON.stringify({ subscription }),
    headers: { 'content-type': 'application/json', 'x-parent-id': '10' },
  });
  assert.equal(first.response.status, 200);
  const rejected = await json('/api/parent/push/subscribe', {
    method: 'POST', body: JSON.stringify({ subscription }),
    headers: { 'content-type': 'application/json', 'x-parent-id': '20' },
  });
  assert.equal(rejected.response.status, 409);
  assert.match(rejected.body.message, /another parent/);
  assert.equal(state.pushSubscriptions[0].parent_id, 10);

  const otherUnsubscribe = await json('/api/parent/push/unsubscribe', {
    method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }),
    headers: { 'content-type': 'application/json', 'x-parent-id': '20' },
  });
  assert.equal(otherUnsubscribe.response.status, 200);
  assert.equal(state.pushSubscriptions[0].is_active, true);
  const ownUnsubscribe = await json('/api/parent/push/unsubscribe', {
    method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }),
    headers: { 'content-type': 'application/json', 'x-parent-id': '10' },
  });
  assert.equal(ownUnsubscribe.response.status, 200);
  assert.equal(state.pushSubscriptions[0].is_active, false);
});

test('delivery failures do not remove a durable inbox row, and source transactions notify after commit', async () => {
  pushMock.fail = true;
  const result = await notificationService.createParentNotifications({
    eventType: 'attendance_absent', title: 'Ada absent', summary: 'Ada was absent.',
    destination: 'attendance', dedupeKey: 'delivery-failure', learnerId: 101,
  });
  assert.equal(result.created, 1);
  assert.equal(state.notifications.length, 1, 'delivery failure must not roll back the insert');

  const attendanceSource = fs.readFileSync(require.resolve('../routes/attendance'), 'utf8');
  const attendanceCommit = attendanceSource.indexOf("await client.query('COMMIT')");
  const attendanceNotify = attendanceSource.indexOf('notifyAttendance({');
  assert.ok(attendanceCommit >= 0 && attendanceNotify > attendanceCommit);
  const paymentSource = fs.readFileSync(require.resolve('../routes/paymentProofs'), 'utf8');
  const paymentCommit = paymentSource.indexOf("await client.query('COMMIT')");
  const paymentNotify = paymentSource.indexOf('notifyPayment({', paymentCommit);
  assert.ok(paymentCommit >= 0 && paymentNotify > paymentCommit);
});

test('push service retires both 404 and 410 endpoints without broadening ownership', async () => {
  const webpush = {
    setVapidDetails() {},
    async sendNotification(subscription) {
      const error = new Error('gone');
      error.statusCode = subscription === 'gone-410' ? 410 : 404;
      throw error;
    },
  };
  mock('web-push', webpush);
  delete require.cache[require.resolve('../services/pushNotification')];
  const pushService = require('../services/pushNotification');
  state.pushSubscriptions = [
    { id: 41, parent_id: 10, subscription: 'gone-410', is_active: true },
    { id: 42, parent_id: 20, subscription: 'gone-404', is_active: true },
  ];
  await pushService.sendToParents([10], { type: 'attendance_absent', url: '/parent/attendance' });
  assert.equal(state.pushSubscriptions.find((item) => item.id === 41).is_active, false);
  assert.equal(state.pushSubscriptions.find((item) => item.id === 42).is_active, true);
  assert.ok(state.queries.some((q) => /parent_id = ANY/.test(q.sql)));
  const source = fs.readFileSync(require.resolve('../services/pushNotification'), 'utf8');
  assert.match(source, /err\.statusCode === 404 \|\| err\.statusCode === 410/);
});

test('event wiring uses current parent_students links and all durable event producers', () => {
  const serviceSource = fs.readFileSync(require.resolve('../services/parentNotificationService'), 'utf8');
  const parentSource = fs.readFileSync(require.resolve('../routes/parent'), 'utf8');
  for (const source of [serviceSource, parentSource]) assert.match(source, /parent_students/);
  for (const route of ['attendance', 'quizzes', 'submissions', 'admin', 'invoices', 'enhanced-invoices', 'studentFees', 'paymentProofs', 'announcements', 'documents']) {
    const source = fs.readFileSync(require.resolve(`../routes/${route}`), 'utf8');
    assert.match(source, /parentNotificationService|notifyAttendance|notifyAcademicResult|notifyPayment|notifyInvoice|notifyAnnouncement|notifyDocument/);
  }
});

test('review blocker contracts: post-update targeting, saved attendance rows, payment paths, migration, and push ownership', () => {
  const announcementSource = fs.readFileSync(require.resolve('../routes/announcements'), 'utf8');
  const updateNotify = announcementSource.indexOf('await notifyAnnouncement(result.rows[0])');
  assert.ok(updateNotify >= 0);
  assert.equal(announcementSource.indexOf('...req.resource', updateNotify), -1);
  assert.match(announcementSource.slice(announcementSource.lastIndexOf('RETURNING id', updateNotify), updateNotify), /grade_id/);
  assert.match(announcementSource.slice(announcementSource.lastIndexOf('RETURNING id', updateNotify), updateNotify), /class_id/);

  const attendanceSource = fs.readFileSync(require.resolve('../routes/attendance'), 'utf8');
  const savedRows = attendanceSource.indexOf('const savedAttendance = []');
  const attendanceNotify = attendanceSource.indexOf('Promise.allSettled(savedAttendance');
  assert.ok(savedRows >= 0 && attendanceNotify > savedRows);
  assert.equal(attendanceSource.indexOf('Promise.allSettled(attendance'), -1);

  for (const route of ['enhanced-invoices', 'invoices']) {
    const source = fs.readFileSync(require.resolve(`../routes/${route}`), 'utf8');
    assert.match(source, /notifyPayment/);
  }
  const invoicesSource = fs.readFileSync(require.resolve('../routes/invoices'), 'utf8');
  assert.equal((invoicesSource.match(/notifyInvoice\(\{/g) || []).length, 3,
    'monthly generation, manual arrears, and carry-forward invoice writers notify parents');
  assert.equal((invoicesSource.match(/notifyPayment\(\{/g) || []).length, 1,
    'bank-statement payment writer notifies parents');
  const enhancedSource = fs.readFileSync(require.resolve('../routes/enhanced-invoices'), 'utf8');
  assert.equal((enhancedSource.match(/notifyPayment\(\{/g) || []).length, 4,
    'all enhanced payment writers notify parents');
  assert.match(enhancedSource, /manual-payment\/apply-arrears-first/);
  assert.match(enhancedSource, /transactionId/);
  const proofSource = fs.readFileSync(require.resolve('../routes/paymentProofs'), 'utf8');
  assert.equal((proofSource.match(/notifyPayment\(\{/g) || []).length, 4,
    'submitted, approved, applied, and rejected proof writers notify parents');
  const migration = fs.readFileSync(require.resolve('../migrations/parent_notifications_phase3.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS parent_push_subscriptions/);
  for (const column of ['parent_id', 'endpoint', 'subscription', 'is_active', 'created_at', 'updated_at']) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migration, /uq_parent_push_subscriptions_endpoint/);

  const parentSource = fs.readFileSync(require.resolve('../routes/parent'), 'utf8');
  assert.match(parentSource, /WHERE parent_push_subscriptions\.parent_id = EXCLUDED\.parent_id/);
  assert.match(parentSource, /Push subscription keys are invalid/);
});