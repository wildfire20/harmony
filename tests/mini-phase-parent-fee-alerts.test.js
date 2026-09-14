const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('mobile fee choices have explicit visible states and tappable rows', () => {
  const proof = source('client/src/components/parent/ParentPaymentProof.js');
  const css = source('client/src/components/parent/ParentPortal.css');
  assert.match(proof, /parent-fee-choice/);
  assert.match(proof, /parent-fee-choice-box/);
  assert.match(proof, /applicableServices\.map/);
  assert.match(proof, /oneOffFees\.map/);
  assert.doesNotMatch(proof, /fee\.description[^}]+truncate/);
  assert.match(css, /\.parent-fee-choice[\s\S]*min-height: 44px/);
  assert.match(css, /\.parent-fee-choice-box[\s\S]*border: 2px solid var\(--parent-navy\)/);
  assert.match(css, /\.parent-fee-choice\.is-selected \.parent-fee-choice-box[\s\S]*background: var\(--parent-teal\)/);
  assert.match(css, /\.parent-fee-choice-description[\s\S]*overflow-wrap: anywhere/);
});

test('one-off fee assignment and notifications share one transaction', () => {
  const fees = source('routes/studentFees.js');
  const create = fees.split("router.post('/', requireAdmin")[1].split("router.post('/:id/assign'")[0];
  assert.match(create, /client\.query\('BEGIN'\)/);
  assert.match(create, /createOneOffFeeNotifications\([\s\S]*executor: client/);
  const notifyIndex = create.indexOf('createOneOffFeeNotifications');
  const commitIndex = create.lastIndexOf("client.query('COMMIT')");
  const deliveryIndex = create.indexOf('deliverOneOffFeeNotifications', notifyIndex);
  assert.ok(notifyIndex < commitIndex);
  assert.ok(commitIndex < deliveryIndex);
  assert.match(create, /Idempotency-Key/);
  assert.match(create, /pg_advisory_xact_lock/);
  assert.match(create, /one_off_fee_created/);
});

test('fee recipients are linked, deduplicated, verified for email, and source-deduped', () => {
  const service = source('services/parentNotificationService.js');
  assert.match(service, /s\.id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
  assert.match(service, /findIndex\(\(other\) => other\.parent_id === row\.parent_id\)/);
  assert.match(service, /dedupeKey: `one-off-fee:\$\{fee\.id\}`/);
  assert.match(service, /recipient\.email && recipient\.email_verified_at/);
  assert.match(service, /New Fee Added — Harmony Learning Institute/);
  assert.match(service, /Powered by AutoM8/);
});

test('section unread counts and read actions remain independent and persisted', () => {
  const routes = source('routes/parent.js');
  const portal = source('client/src/components/parent/ParentPortal.js');
  assert.match(routes, /notifications\/unread-counts/);
  assert.match(routes, /notifications\/sections\/:section\/read/);
  for (const section of ['calendar', 'attendance', 'announcements', 'documents', 'fees']) {
    assert.match(routes, new RegExp(`${section}:`));
  }
  assert.match(routes, /INSERT INTO parent_notification_reads/);
  assert.match(portal, /parent-section-badge/);
  assert.match(portal, /SECTION_BY_PATH/);
  assert.match(portal, /notifications\/sections\/\$\{section\}\/read/);
});

test('future Parent-visible calendar events produce calendar notifications only', () => {
  const calendar = source('routes/calendar.js');
  const service = source('services/parentNotificationService.js');
  assert.match(calendar, /notifyCalendarEvent\(event\)/);
  assert.match(service, /if \(!event\?\.parent_visible\) return \{ created: 0 \}/);
  assert.match(service, /eventType: EVENT\.CALENDAR/);
});