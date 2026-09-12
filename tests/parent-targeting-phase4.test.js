/*
 * Phase 4 parent communication targeting contracts.
 *
 * These tests use an in-memory PostgreSQL double.  They intentionally do not
 * run a migration, contact Gmail, or require a live portal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const originalFrontendUrl = process.env.FRONTEND_URL;
const original = new Map();
const mock = (name, exports) => {
  const resolved = require.resolve(name);
  if (!original.has(resolved)) original.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const learners = new Map([
  [101, { id: 101, grade_id: 1, class_id: 11 }],
  [102, { id: 102, grade_id: 1, class_id: 12 }],
  [202, { id: 202, grade_id: 1, class_id: 12 }],
  [201, { id: 201, grade_id: 2, class_id: 21 }],
]);
const parents = new Map([
  [10, { id: 10, email: 'a@example.test', parent_first_name: 'A' }],
  [20, { id: 20, email: 'b@example.test', parent_first_name: 'B' }],
  // Parent 30 is deliberately not currently linked to a learner.
  [30, { id: 30, email: 'unlinked@example.test', parent_first_name: 'Unlinked' }],
]);
const state = {
  links: new Map([[10, new Set([101, 102])], [20, new Set([201, 202])], [30, new Set()]]),
  notifications: [],
  queries: [],
  emails: [],
  push: [],
  events: [],
  nextId: 1,
  emailFailure: false,
};
const row = (rows) => ({ rows, rowCount: rows.length });
const isLinked = (parentId, learnerId) => state.links.get(parentId)?.has(learnerId);

function reset() {
  state.notifications = [];
  state.queries = [];
  state.emails = [];
  state.push = [];
  state.events = [];
  state.nextId = 1;
  state.emailFailure = false;
  state.links = new Map([[10, new Set([101, 102])], [20, new Set([201, 202])], [30, new Set()]]);
}

const db = {
  async query(sql, params = []) {
    state.queries.push({ type: 'query', sql, params });

    if (/SELECT DISTINCT p\.id AS parent_id/.test(sql)) {
      const selected = /p\.id = ANY/.test(sql) ? new Set(params[0].map(Number)) : null;
      const gradeMatch = sql.match(/s\.grade_id = \$(\d+)/);
      const classMatch = sql.match(/s\.class_id = \$(\d+)/);
      const grade = gradeMatch ? Number(params[Number(gradeMatch[1]) - 1]) : null;
      const classId = classMatch ? Number(params[Number(classMatch[1]) - 1]) : null;
      const recipients = [];
      for (const [parentId, childIds] of state.links) {
        if (selected && !selected.has(parentId)) continue;
        for (const learnerId of childIds) {
          const learner = learners.get(learnerId);
          if (!learner || (grade != null && learner.grade_id !== grade) ||
              (classId != null && learner.class_id !== classId)) continue;
          recipients.push({
            parent_id: parentId,
            learner_id: learnerId,
            email: parents.get(parentId).email,
            parent_first_name: parents.get(parentId).parent_first_name,
          });
        }
      }
      return row(recipients);
    }

    if (/INSERT INTO parent_notifications/.test(sql)) {
      const [eventType, parentId, learnerId, title, summary, deepLink, dedupeKey, important] = params;
      if (!state.links.has(Number(parentId)) ||
          (learnerId != null && !isLinked(Number(parentId), Number(learnerId)))) return row([]);
      if (state.notifications.some(item =>
        item.parent_id === Number(parentId) && item.dedupe_key === dedupeKey)) return row([]);
      const notification = {
        id: state.nextId++,
        event_type: eventType,
        parent_id: Number(parentId),
        learner_id: learnerId == null ? null : Number(learnerId),
        title,
        summary,
        deep_link: deepLink,
        dedupe_key: dedupeKey,
        important: Boolean(important),
      };
      state.notifications.push(notification);
      state.queries.push({ type: 'commit', notification });
      state.events.push({ type: 'commit', notificationId: notification.id });
      return row([{ id: notification.id }]);
    }
    return row([]);
  },
};

const gmail = {
  async sendEmail(to, subject, html, options) {
    state.emails.push({ type: 'email', to, subject, html, options });
    state.events.push({ type: 'email', to });
    if (state.emailFailure) throw new Error('Gmail unavailable');
    return { success: true };
  },
  escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};
const push = {
  async sendToParents(parentIds, payload) {
    state.push.push({ parentIds, payload });
  },
};

mock('../config/database', db);
mock('../services/gmailService', gmail);
mock('../services/pushNotification', push);
const notifications = require('../services/parentNotificationService');

test.beforeEach(reset);
test.after(() => {
  if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = originalFrontendUrl;
  for (const [name, value] of original) {
    if (value) require.cache[name] = value;
    else delete require.cache[name];
  }
});

test('all-parent, grade, class, and specific-parent targeting use current links', async () => {
  assert.equal((await notifications.notifyAnnouncement({
    id: 1, title: 'All parents', content: 'School news', target_audience: 'parents',
  })).created, 2);
  reset();
  assert.equal((await notifications.notifyAnnouncement({
    id: 2, title: 'Grade one', content: 'Grade news',
    target_audience: 'grade', grade_id: 1,
  })).created, 2);
  assert.deepEqual(state.notifications.map(item => item.learner_id), [101, 202]);
  reset();
  assert.equal((await notifications.notifyAnnouncement({
    id: 3, title: 'Class 12', content: 'Class news',
    target_audience: 'class', grade_id: 1, class_id: 12,
  })).created, 2);
  assert.equal(state.notifications[0].parent_id, 10);
  assert.equal(state.notifications[0].learner_id, 102);
  assert.equal(state.notifications[1].parent_id, 20);
  assert.equal(state.notifications[1].learner_id, 202);
  reset();
  assert.equal((await notifications.notifyAnnouncement({
    id: 4, title: 'Selected', content: 'Selected news',
    target_audience: 'specific_parents', target_parent_ids: [20, 30],
  })).created, 1);
  assert.equal(state.notifications[0].parent_id, 20);
  assert.ok(state.queries[0].sql.includes('parent_students'));
  assert.ok(!state.notifications.some(item => item.parent_id === 30));
});

test('empty specific-parent selection is safe and never broadens to all parents', async () => {
  const result = await notifications.notifyAnnouncement({
    id: 5, title: 'Nobody', content: 'No recipients',
    target_audience: 'specific_parents', target_parent_ids: [],
  });
  assert.equal(result.created, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.emails.length, 0);
});

test('retired student announcements never fan out to or read by parents', async () => {
  const result = await notifications.notifyAnnouncement({
    id: 10, title: 'Legacy student notice', content: 'Not a parent notice',
    target_audience: 'students', priority: 'urgent',
  });
  assert.equal(result.created, 0);
  assert.equal(state.notifications.length, 0);
  const parentSource = fs.readFileSync(path.join(root, 'routes/parent.js'), 'utf8');
  const serviceSource = fs.readFileSync(
    path.join(root, 'services/parentNotificationService.js'), 'utf8',
  );
  assert.doesNotMatch(parentSource, /target_audience IN \([^)]*students/);
  assert.doesNotMatch(serviceSource, /parentAudiences[\s\S]{0,180}'students'/);
});

test('important announcement Gmail fan-out happens after each durable insert and failures do not roll back', async () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://portal.example.test';
  const result = await notifications.notifyAnnouncement({
    id: 6, title: 'Urgent title', content: '<unsafe>Important content',
    priority: 'high', target_audience: 'parents',
  });
  assert.equal(result.created, 2);
  assert.equal(state.emails.length, 2);
  assert.ok(state.emails.every(email => email.subject.includes('Urgent title')));
  assert.ok(state.emails.every(email => email.html.includes('Harmony Learning Institute')));
  const firstCommit = state.queries.findIndex(item => item.type === 'commit');
  assert.ok(firstCommit >= 0);
  const emailEvents = state.events.filter(item => item.type === 'email');
  assert.equal(emailEvents.length, 2);
  assert.deepEqual(state.events.map(item => item.type), ['commit', 'email', 'commit', 'email']);
  // Gmail delivery follows each durable insert, rather than participating in
  // the source insert/commit operation.
  assert.equal(state.notifications.length, 2);

  reset();
  state.emailFailure = true;
  const failed = await notifications.notifyAnnouncement({
    id: 7, title: 'Still saved', content: 'Delivery can fail',
    priority: 'urgent', target_audience: 'parents',
  });
  assert.equal(failed.created, 2);
  assert.equal(state.notifications.length, 2);
  if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = previousFrontendUrl;
});

test('important parent documents notify, while routine documents can opt out of email', async () => {
  process.env.FRONTEND_URL = 'https://portal.example.test';
  const routine = await notifications.notifyDocument({
    id: 8, title: 'Routine handbook', target_audience: 'class',
    grade_id: 1, class_id: 12, important: false, notify_email: false,
  });
  assert.equal(routine.created, 2);
  assert.equal(state.emails.length, 0);
  reset();
  const important = await notifications.notifyDocument({
    id: 9, title: 'Important handbook', target_audience: 'grade',
    grade_id: 1, important: true, notify_email: true,
  });
  assert.equal(important.created, 2);
  assert.equal(state.emails.length, 2);
});

test('document and portal security contracts keep parent scope and student retirement intact', () => {
  const parent = fs.readFileSync(path.join(root, 'routes/parent.js'), 'utf8');
  const documents = fs.readFileSync(path.join(root, 'routes/documents.js'), 'utf8');
  const announcementsUi = fs.readFileSync(
    path.join(root, 'client/src/components/announcements/Announcements.js'), 'utf8',
  );
  assert.match(parent, /parent_students/);
  assert.match(parent, /target_parent_ids/);
  assert.match(parent, /child_id is required/);
  assert.match(documents, /Use the parent portal document endpoint/);
  assert.match(documents, /target_audience.*parents/);
  assert.doesNotMatch(announcementsUi, /<option value="students">Students Only<\/option>/);
});

test('teacher update targeting cannot escalate and parent grades are disabled before data access', () => {
  const announcementSource = fs.readFileSync(path.join(root, 'routes/announcements.js'), 'utf8');
  const update = announcementSource.slice(
    announcementSource.indexOf("router.put('/:id'"),
    announcementSource.indexOf('// Delete announcement'),
  );
  assert.match(update, /req\.user\.role === 'teacher'/);
  assert.match(update, /\['staff', 'students'\]\.includes\(target_audience\)/);
  assert.match(update, /Teachers cannot change announcement targeting scope/);
  assert.match(update, /req\.body\.target_parent_ids/);

  const parentSource = fs.readFileSync(path.join(root, 'routes/parent.js'), 'utf8');
  const grades = parentSource.slice(
    parentSource.indexOf("router.get('/grades'"),
    parentSource.indexOf("// ─── GET /api/parent/announcements"),
  );
  assert.match(grades, /PARENT_GRADES_DISABLED/);
  assert.doesNotMatch(grades, /db\.query/);
  const dashboard = parentSource.slice(
    parentSource.indexOf("router.get('/dashboard'"),
    parentSource.indexOf("// ─── GET /api/parent/attendance"),
  );
  assert.doesNotMatch(dashboard, /gradesRes/);
  assert.match(dashboard, /recentGrades: \[\]/);
});

test('targeting migration is manual/additive and is not a startup auto-migration', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations/parent_targeting_phase4.sql'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(migration, /Manual, additive migration/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/);
  assert.equal(packageJson.scripts['migrate:parent-targeting'], 'node scripts/run-parent-targeting-migration.js');
  assert.doesNotMatch(server, /run-parent-targeting-migration/);
});