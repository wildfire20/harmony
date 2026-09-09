const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const routeSource = fs.readFileSync('routes/enrollments.js', 'utf8');
const {
  TOKEN_PURPOSES,
  generatePortalToken,
  hashPortalToken,
  getPortalAccess,
} = require('../services/admissionsPortalTokenService');
const { buildPortalLink } = require('../services/admissionsPortalLinks');
const { statusEmailContent, htmlToPlainText } = require('../services/gmailService');

test('portal tokens are 256-bit, hashed, and status eligibility is enforced', () => {
  const raw = generatePortalToken();
  assert.equal(Buffer.from(raw, 'base64url').length, 32);
  assert.equal(hashPortalToken(raw).length, 64);
  assert.equal(getPortalAccess({
    purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
    enrollmentStatus: 'APPROVED',
  }), null);
  assert.equal(getPortalAccess({
    purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    enrollmentStatus: 'REGISTERED',
  }), null);
  assert.equal(getPortalAccess({
    purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    enrollmentStatus: 'REGISTRATION_PENDING',
    formStatus: 'SUBMITTED',
  }), 'read_only');
});

test('secure status email contains escaped canonical link in HTML and plain text', () => {
  const link = buildPortalLink({
    token: generatePortalToken(),
    purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    environment: { FRONTEND_URL: 'https://www.harmonylearning.co.za' },
  });
  const content = statusEmailContent('APPROVED', 'HLI-2027-0001', '<unsafe>', link);
  assert.match(content.html, /Complete Registration/);
  assert.match(content.html, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(content.html, /<unsafe>/);
  assert.match(htmlToPlainText(content.html), new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Admin Phase 5 routes enforce transactional secure workflows and safe contracts', () => {
  assert.match(routeSource, /router\.post\('\/:id\/information-request'/);
  assert.match(routeSource, /router\.patch\('\/:id\/checklist\/:itemType'/);
  assert.match(routeSource, /portalData/);
  assert.match(routeSource, /secureLinks/);
  assert.match(routeSource, /status_more_information_required.*status_approved/);
  assert.match(routeSource, /Use \/information-request/);
  assert.match(routeSource, /revokePortalTokensInTransaction/);
  assert.doesNotMatch(routeSource, /Unexpected client query/);
  assert.doesNotMatch(routeSource, /token_hash.*portalData/);
});