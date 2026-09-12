const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.JWT_SECRET = 'parent-rollout-dashboard-test-secret';

const { buildParentRollout } = require('../services/parentRollout');

const parent = (id, values = {}) => ({
  id, first_name: `Parent${id}`, last_name: 'Test', phone_number: `277312345${id}`,
  email: null, email_verified_at: null, is_active: true, activated_at: null,
  parent_account_status: 'pending', linked_learner_count: 1, ...values,
});

test('rollout metrics count activated, eligible, attention, disabled and multi-child Parents once', () => {
  const now = new Date().toISOString();
  const result = buildParentRollout([
    parent(1, { phone_number: '0731234567', activated_at: now, email: 'one@example.test', email_verified_at: now, linked_learner_count: 2 }),
    parent(2, { phone_number: '0741234567' }),
    parent(3, { phone_number: 'invalid' }),
    parent(4, { phone_number: '', email: '' }),
    parent(5, { phone_number: '0751234567', is_active: false }),
  ], [{ entity_id: '1', action: 'parent_self_activation_completed', created_at: now }]);

  assert.deepEqual({
    total: result.metrics.total,
    activated: result.metrics.activated,
    ready: result.metrics.ready_to_activate,
    attention: result.metrics.needs_attention,
    disabled: result.metrics.disabled,
    multi: result.metrics.multi_learner_parents,
    verified: result.metrics.email_verified,
  }, { total: 5, activated: 1, ready: 1, attention: 2, disabled: 1, multi: 1, verified: 1 });
  assert.equal(result.parents[0].activation_history[0].method, 'SELF_EMAIL_OTP');
  assert.equal(result.parents[0].email_status, 'VERIFIED');
});

test('readiness recalculates after a registered mobile correction and detects duplicates', () => {
  const invalid = parent(10, { phone_number: '123' });
  assert.equal(buildParentRollout([invalid]).parents[0].rollout_status, 'INVALID_MOBILE');
  const corrected = { ...invalid, phone_number: '073 123 4567' };
  assert.equal(buildParentRollout([corrected]).parents[0].rollout_status, 'READY_TO_ACTIVATE');
  const duplicate = buildParentRollout([
    corrected,
    parent(11, { phone_number: '+27731234567' }),
  ]);
  assert.ok(duplicate.parents.every(item => item.rollout_status === 'DUPLICATE_MOBILE'));
});

test('Admin UI provides status filters, cleanup, safe history and email-aware assistance', () => {
  const ui = fs.readFileSync('client/src/components/admin/ParentManagement.js', 'utf8');
  assert.match(ui, /Filter by rollout status/);
  assert.match(ui, /READY_TO_ACTIVATE/);
  assert.match(ui, /openEdit\(p\)/);
  assert.match(ui, /activation_history/);
  assert.match(ui, /SELF_EMAIL_OTP/);
  assert.match(ui, /disabled=\{!p\.email\}/);
  assert.match(ui, /Copy instructions/);
  assert.doesNotMatch(ui, /otp_hash|password_hash|refresh_token_hash|token_hash/i);
});

test('dashboard uses existing schema and records both activation methods without automatic migration', () => {
  const routes = fs.readFileSync('routes/parent.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(routes, /parent_self_activation_completed/);
  assert.match(routes, /parent_admin_email_link_activated/);
  assert.doesNotMatch(server, /run-parent-self-activation-migration|migrate:parent-self-activation/);
});