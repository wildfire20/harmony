const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  PORTAL_ACCESS,
  TOKEN_PURPOSES,
  TOKEN_TTL_MS,
  generatePortalToken,
  getPortalAccess,
  hashPortalToken,
  issuePortalToken,
  recordPortalTokenUse,
  revokePortalTokens,
  validatePortalToken,
  withValidatedPortalToken,
} = require('../services/admissionsPortalTokenService');
const { isAdmissionsPortalSchemaReady } = require('../middleware/admissionsPortalSchema');
const {
  CANONICAL_PRODUCTION_URL,
  buildPortalLink,
  getCanonicalProductionUrl,
} = require('../services/admissionsPortalLinks');

const createTransactionDatabase = ({ status = 'APPROVED', formStatus = null, priorIds = [] } = {}) => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SELECT e.status')) return { rows: [{ status, form_status: formStatus }] };
      if (String(sql).includes('SELECT id') && String(sql).includes('admissions_portal_tokens')) {
        return { rows: priorIds.map((id) => ({ id })) };
      }
      if (String(sql).includes('INSERT INTO admissions_portal_tokens')) {
        return {
          rows: [{
            id: 99,
            enrollment_id: params[0],
            purpose: params[1],
            issued_at: params[4],
            expires_at: params[5],
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { async connect() { return client; } }, queries };
};

test('portal migration is additive, idempotent and does not alter existing records', () => {
  const migration = read('migrations/secure_registration_portal_phase.sql');
  for (const table of [
    'admissions_portal_tokens',
    'registration_records',
    'registration_checklist_items',
    'admissions_portal_documents',
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /last_used_at TIMESTAMP/);
  assert.match(migration, /CORRECTIONS_REQUESTED/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/);
  assert.doesNotMatch(migration, /medical|accessibility/i);
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE enrollments|UPDATE enrollments)\b/i);
});

test('portal schema has a separate readiness guard and explicit migration command', () => {
  const packageJson = JSON.parse(read('package.json'));
  const runner = read('scripts/run-secure-registration-portal-migration.js');
  assert.equal(packageJson.scripts['migrate:registration-portal'], 'node scripts/run-secure-registration-portal-migration.js');
  assert.match(runner, /secure_registration_portal_phase\.sql/);
  assert.match(runner, /migration applied and verified/);
});

test('schema readiness requires every portal table', async () => {
  const ready = await isAdmissionsPortalSchemaReady({
    async query() { return { rows: [{ tables_present: 4, columns_present: 15, indexes_present: 4 }] }; },
  });
  const notReady = await isAdmissionsPortalSchemaReady({
    async query() { return { rows: [{ tables_present: 4, columns_present: 14, indexes_present: 4 }] }; },
  });
  assert.equal(ready, true);
  assert.equal(notReady, false);
});

test('tokens use 256 bits of randomness and SHA-256 hashes', () => {
  const first = generatePortalToken();
  const second = generatePortalToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 43);
  assert.equal(hashPortalToken(first).length, 64);
  assert.notEqual(hashPortalToken(first), hashPortalToken(second));
});

test('eligibility preserves legacy approved and submitted registration is read-only', () => {
  assert.equal(getPortalAccess({
    purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
    enrollmentStatus: 'MORE_INFORMATION_REQUIRED',
  }), PORTAL_ACCESS.EDIT);
  for (const status of ['APPROVED', 'approved']) {
    assert.equal(getPortalAccess({
      purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
      enrollmentStatus: status,
    }), PORTAL_ACCESS.EDIT);
  }
  assert.equal(getPortalAccess({
    purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    enrollmentStatus: 'REGISTRATION_PENDING',
    formStatus: 'SUBMITTED',
  }), PORTAL_ACCESS.READ_ONLY);
  assert.equal(getPortalAccess({
    purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    enrollmentStatus: 'approved',
    formStatus: 'SUBMITTED',
  }), PORTAL_ACCESS.READ_ONLY);
  for (const status of ['NEW', 'UNDER_REVIEW', 'REGISTERED', 'NOT_ACCEPTED', 'rejected', 'waitlisted']) {
    assert.equal(getPortalAccess({
      purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
      enrollmentStatus: status,
    }), null);
  }
});

test('issuing a token revokes and links prior active tokens without storing raw token', async () => {
  const database = createTransactionDatabase({ priorIds: [7, 8] });
  const issued = await issuePortalToken({
    enrollmentId: 12,
    purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    issuedBy: 3,
    database,
    now: new Date('2027-01-01T00:00:00Z'),
  });
  assert.equal(issued.expires_at.toISOString(), '2027-01-31T00:00:00.000Z');
  const insert = database.queries.find(({ sql }) => sql.includes('INSERT INTO admissions_portal_tokens'));
  assert.equal(insert.params[2].length, 64);
  assert.notEqual(insert.params[2], issued.token);
  const replacement = database.queries.find(({ sql }) => sql.includes('replaced_by_token_id'));
  assert.deepEqual(replacement.params[1], [7, 8]);
  assert.ok(database.queries.some(({ sql }) => sql === 'COMMIT'));
});

test('update tokens use a 14-day expiry and reject ineligible status', async () => {
  const eligible = createTransactionDatabase({ status: 'MORE_INFORMATION_REQUIRED' });
  const issued = await issuePortalToken({
    enrollmentId: 2,
    purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
    database: eligible,
    now: new Date('2027-02-01T00:00:00Z'),
  });
  assert.equal(issued.expires_at.toISOString(), '2027-02-15T00:00:00.000Z');
  assert.equal(TOKEN_TTL_MS.UPDATE_APPLICATION, 14 * 24 * 60 * 60 * 1000);

  const ineligible = createTransactionDatabase({ status: 'NEW' });
  await assert.rejects(() => issuePortalToken({
    enrollmentId: 2,
    purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
    database: ineligible,
  }), { code: 'TOKEN_NOT_ELIGIBLE' });
  assert.ok(ineligible.queries.some(({ sql }) => sql === 'ROLLBACK'));
});

test('validation returns generic null for malformed, expired, revoked or incompatible tokens', async () => {
  assert.equal(await validatePortalToken('short', {
    database: { async query() { throw new Error('must not query'); } },
  }), null);
  const absent = { async query() { return { rows: [] }; } };
  assert.equal(await validatePortalToken('x'.repeat(43), { database: absent }), null);

  const incompatible = {
    async query() {
      return { rows: [{
        token_id: 1,
        enrollment_id: 4,
        purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
        enrollment_status: 'REGISTERED',
      }] };
    },
  };
  assert.equal(await validatePortalToken('y'.repeat(43), { database: incompatible }), null);
});

test('submitted registration token remains valid in read-only mode', async () => {
  const database = {
    async query() {
      return { rows: [{
        token_id: 1,
        enrollment_id: 4,
        purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
        enrollment_status: 'REGISTRATION_PENDING',
        form_status: 'SUBMITTED',
      }] };
    },
  };
  const result = await validatePortalToken('z'.repeat(43), { database });
  assert.equal(result.access, PORTAL_ACCESS.READ_ONLY);
});

test('recording use updates timestamps and count without revoking or consuming token', async () => {
  const queries = [];
  await recordPortalTokenUse(5, {
    database: { async query(sql, params) { queries.push({ sql: String(sql), params }); return { rows: [] }; } },
    now: new Date('2027-03-01T00:00:00Z'),
  });
  assert.match(queries[0].sql, /last_used_at/);
  assert.match(queries[0].sql, /use_count = use_count \+ 1/);
  assert.doesNotMatch(queries[0].sql, /revoked_at\s*=/);
});

test('explicit revocation affects only active tokens for one application and purpose', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SELECT id FROM enrollments')) return { rows: [{ id: 9 }] };
      if (String(sql).includes('UPDATE admissions_portal_tokens')) return { rows: [{ id: 1 }, { id: 2 }] };
      return { rows: [] };
    },
    release() {},
  };
  const count = await revokePortalTokens({
    enrollmentId: 9,
    purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
    database: { pool: { async connect() { return client; } } },
  });
  assert.equal(count, 2);
  assert.ok(queries.some(({ sql }) => sql.includes('SELECT id FROM enrollments WHERE id = $1 FOR UPDATE')));
  assert.ok(queries.some(({ sql }) => /enrollment_id = \$1 AND purpose = \$2 AND revoked_at IS NULL/.test(sql)));
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
});

test('portal security middleware redacts tokens and applies stricter limits', () => {
  const middleware = read('middleware/admissionsPortalSecurity.js');
  const route = read('routes/admissionsPortal.js');
  const server = read('server.js');
  assert.match(middleware, /max: 120/);
  assert.match(middleware, /max: 30/);
  assert.match(middleware, /\/api\/admissions-portal\/\[REDACTED\]/);
  assert.doesNotMatch(middleware, /originalUrl|req\.url|req\.params/);
  assert.match(middleware, /Referrer-Policy/);
  assert.match(middleware, /X-Robots-Tag/);
  assert.match(middleware, /Cache-Control/);
  assert.match(route, /portalReadLimiter/);
  assert.match(route, /portalWriteLimiter/);
  assert.match(route, /requireAdmissionsPortalSchema/);
  assert.match(server, /app\.use\('\/api\/admissions-portal', admissionsPortalRoutes\)/);
});

test('secure links fail closed unless the exact canonical production origin is configured', () => {
  const validEnvironment = { FRONTEND_URL: 'https://www.harmonylearning.co.za/' };
  assert.equal(getCanonicalProductionUrl(validEnvironment), CANONICAL_PRODUCTION_URL);
  assert.equal(
    buildPortalLink({
      token: 'a'.repeat(43),
      purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
      environment: validEnvironment,
    }),
    `https://www.harmonylearning.co.za/application/update/${'a'.repeat(43)}`,
  );
  for (const frontendUrl of [
    '',
    'http://www.harmonylearning.co.za',
    'https://harmonylearning.co.za',
    'https://www.harmonylearning.co.za.evil.example',
    'https://www.harmonylearning.co.za/unexpected',
  ]) {
    assert.throws(() => getCanonicalProductionUrl({ FRONTEND_URL: frontendUrl }), {
      code: 'PORTAL_CANONICAL_URL_INVALID',
    });
  }
});

test('Parent API exposes only approved endpoints and allowlisted fields', () => {
  const route = read('routes/admissionsPortal.js');
  for (const endpoint of [
    "router.get('/session/:token'",
    "router.patch('/application/:token'",
    "router.post('/application/:token/submit'",
    "router.patch('/registration/:token'",
    "router.post('/registration/:token/submit'",
  ]) assert.ok(route.includes(endpoint));
  for (const allowed of [
    'parentEmail', 'parentPhone', 'previousSchool', 'additionalNotes',
    'residentialAddress', 'postalAddress', 'emergencyContact',
    'boarding', 'transport', 'aftercare',
  ]) assert.match(route, new RegExp(allowed));
  assert.doesNotMatch(route, /medical|accessibility/i);
  assert.match(route, /withValidatedPortalToken/);
  assert.doesNotMatch(route, /sendAdmissionsStatusEmail|sendEmail|multer|s3/i);
});

test('token-bearing React routes send privacy headers before serving HTML', () => {
  const server = read('server.js');
  assert.match(server, /application\/update\/:token/);
  assert.match(server, /registration\/:token/);
  assert.match(server, /'Cache-Control': 'no-store'/);
  assert.match(server, /'X-Robots-Tag': 'noindex, nofollow, noarchive'/);
  assert.match(server, /'Referrer-Policy': 'no-referrer'/);
});

test('atomic token action locks token and enrollment and enforces edit access', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes('SELECT') && String(sql).includes('FOR UPDATE OF t, e')) {
        return { rows: [{
          token_id: 1,
          enrollment_id: 4,
          purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
          enrollment_status: 'REGISTRATION_PENDING',
          form_status: 'SUBMITTED',
        }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(() => withValidatedPortalToken('q'.repeat(43), {
    database: { pool: { async connect() { return client; } } },
    action: async () => 'must not run',
  }), { code: 'TOKEN_NOT_ELIGIBLE' });
  assert.ok(queries.includes('ROLLBACK'));
});

test('Student Portal retirement and learner records are untouched', () => {
  const migration = read('migrations/secure_registration_portal_phase.sql');
  const service = read('services/admissionsPortalTokenService.js');
  assert.doesNotMatch(`${migration}\n${service}`, /studentPortalEnabled|student login|UPDATE users|INSERT INTO users/i);
});