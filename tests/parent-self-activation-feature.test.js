const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  isParentSelfActivationEnabled,
  isParentSelfActivationPilotParentAllowed,
} = require('../config/features');

test('Parent self-activation is default-deny and requires explicit true', () => {
  const previous = process.env.PARENT_SELF_ACTIVATION_ENABLED;
  try {
    delete process.env.PARENT_SELF_ACTIVATION_ENABLED;
    assert.equal(isParentSelfActivationEnabled(), false);
    process.env.PARENT_SELF_ACTIVATION_ENABLED = 'false';
    assert.equal(isParentSelfActivationEnabled(), false);
    process.env.PARENT_SELF_ACTIVATION_ENABLED = 'TRUE';
    assert.equal(isParentSelfActivationEnabled(), true);
    process.env.PARENT_SELF_ACTIVATION_ENABLED = '1';
    assert.equal(isParentSelfActivationEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.PARENT_SELF_ACTIVATION_ENABLED;
    else process.env.PARENT_SELF_ACTIVATION_ENABLED = previous;
  }
});

test('pilot allowlist is optional, exact and fail-closed when configured incorrectly', () => {
  const previous = process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS;
  try {
    delete process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS;
    assert.equal(isParentSelfActivationPilotParentAllowed(433), true);
    process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS = '433, 434';
    assert.equal(isParentSelfActivationPilotParentAllowed(433), true);
    assert.equal(isParentSelfActivationPilotParentAllowed(435), false);
    process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS = 'not-an-id';
    assert.equal(isParentSelfActivationPilotParentAllowed(433), false);
  } finally {
    if (previous === undefined) delete process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS;
    else process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS = previous;
  }
});

test('public config and Parent UI expose the gate while operational scripts do not depend on it', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const context = fs.readFileSync('client/src/contexts/AppConfigContext.js', 'utf8');
  const activation = fs.readFileSync('client/src/components/parent/ParentActivation.js', 'utf8');
  const login = fs.readFileSync('client/src/components/parent/ParentLogin.js', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.match(server, /parentSelfActivationEnabled:\s*isParentSelfActivationEnabled\(\)/);
  assert.match(context, /parentSelfActivationEnabled/);
  assert.match(activation, /Self-activation is not available yet/);
  assert.match(login, /parentSelfActivationEnabled\s*&&/);
  assert.equal(packageJson.scripts['audit:parent-self-activation'], 'node scripts/audit-parent-self-activation.js');
  assert.equal(packageJson.scripts['migrate:parent-self-activation'], 'node scripts/run-parent-self-activation-migration.js');
});