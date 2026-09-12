const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const parentRoute = fs.readFileSync('routes/parent.js', 'utf8');
const calendarRoute = fs.readFileSync('routes/calendar.js', 'utf8');
const migration = fs.readFileSync('migrations/calendar_parent_visibility.sql', 'utf8');
const parentCalendar = fs.readFileSync('client/src/components/parent/ParentCalendar.js', 'utf8');
const parentPortal = fs.readFileSync('client/src/components/parent/ParentPortal.js', 'utf8');
const dashboard = fs.readFileSync('client/src/components/parent/ParentDashboard.js', 'utf8');
const calendarUi = fs.readFileSync('client/src/components/calendar/Calendar.js', 'utf8');
const parentCss = fs.readFileSync('client/src/components/parent/ParentPortal.css', 'utf8');

test('Parent calendar is read-only and resolves the selected linked learner', () => {
  assert.match(parentRoute, /router\.get\('\/calendar', requireParent/);
  assert.match(parentRoute, /resolveChild\(req\.user\.id, req\.query\.child_id\)/);
  assert.doesNotMatch(parentRoute, /router\.(post|put|delete)\('\/calendar/);
});

test('Parent query is explicit opt-in and grade scoped', () => {
  assert.match(parentRoute, /e\.parent_visible=true/);
  assert.match(parentRoute, /e\.grade_id IS NULL OR e\.grade_id=\$1/);
  assert.match(parentRoute, /e\.class_id IS NULL OR e\.class_id=\$2/);
  assert.doesNotMatch(parentRoute.match(/router\.get\('\/calendar'[\s\S]*?\/\/ ─── GET \/api\/parent\/attendance/)[0], /target_audience\s*=\s*'all'/);
});

test('legacy events remain private and migration is idempotent', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS parent_visible BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/i);
  assert.match(calendarRoute, /parent_visible === true/);
  assert.match(calendarRoute, /false AS parent_visible/);
  assert.match(calendarRoute, /Run the Calendar Parent visibility migration/);
});

test('Parent UI uses an agenda/date selector rather than the desktop calendar grid', () => {
  assert.match(parentCalendar, /type="date"/);
  assert.match(parentCalendar, /Upcoming events/);
  assert.doesNotMatch(parentCalendar, /react-big-calendar/);
  assert.match(parentPortal, /path="calendar"/);
  assert.match(dashboard, /Upcoming/);
});

test('Admin retains CRUD and can explicitly publish Parent-visible events', () => {
  assert.match(calendarRoute, /router\.post\('\/events'/);
  assert.match(calendarRoute, /router\.put\('\/events\/:id'/);
  assert.match(calendarRoute, /router\.delete\('\/events\/:id'/);
  assert.match(calendarRoute, /parent_visible/);
});

test('new event UI simplifies internal audience while preserving legacy student events', () => {
  assert.match(calendarUi, /Internal Audience/);
  assert.match(calendarUi, />All Staff</);
  assert.match(calendarUi, />Teachers Only</);
  assert.match(calendarUi, />Staff\/Admin Only</);
  assert.match(calendarUi, /eventForm\.target_audience === 'students'/);
  assert.doesNotMatch(calendarUi, /<option value="students">Students Only<\/option>/);
});

test('Admin form explains Parent publishing and updates a live visibility summary', () => {
  assert.match(calendarUi, /Show this event to Parents/);
  assert.match(calendarUi, /Who will see this\?/);
  assert.match(calendarUi, /All Parents/);
  assert.match(calendarUi, /Parents \(all classes\)/);
  assert.match(calendarUi, /Internal visibility and Parent publication are separate/);
});

test('Parent Calendar cards and tabs force approved light surfaces', () => {
  assert.match(parentCalendar, /parent-calendar-event/);
  assert.match(parentCalendar, /parent-calendar-tab/);
  assert.match(parentCss, /button\.parent-calendar-event[\s\S]*background: #fff !important/);
  assert.match(parentCss, /button\.parent-calendar-tab\.is-active[\s\S]*background: #e8f1ef !important/);
});