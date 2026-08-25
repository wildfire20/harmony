const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('public SQL and migration endpoints are not registered', () => {
  const server = read('server.js');
  assert.doesNotMatch(server, /\/api\/debug\/run-sql/);
  assert.doesNotMatch(server, /\/api\/debug\/check-schema/);
  assert.doesNotMatch(server, /migration-endpoint/);
  assert.match(server, /app\.all\('\/run-migration-once'[\s\S]*?status\(404\)/);
});

test('startup schema and seed work is explicitly opt-in', () => {
  const server = read('server.js');
  const guard = server.indexOf("ENABLE_STARTUP_SCHEMA_CHANGES !== 'true'");
  const initialize = server.indexOf('await db.initialize()');
  assert.ok(guard >= 0, 'startup write guard is required');
  assert.ok(initialize > guard, 'database initialization must occur after the guard');

  for (const file of ['routes/enrollments.js', 'routes/calendar.js']) {
    assert.match(read(file), /ENABLE_STARTUP_SCHEMA_CHANGES === 'true'/);
  }
});

test('JWT authentication is Bearer-only', () => {
  const auth = read('middleware/auth.js');
  assert.match(auth, /startsWith\('Bearer '\)/);
  assert.doesNotMatch(auth, /req\.query\.token|query\.token/);

  const clientFiles = [
    'client/src/components/parent/ParentDocuments.js',
    'client/src/components/documents/DocumentLibrary.js',
    'client/src/components/documents/Documents.js',
    'client/src/components/tasks/TaskDetails.js',
  ];
  for (const file of clientFiles) {
    assert.doesNotMatch(read(file), /[?&]token=/, `${file} must not put JWTs in URLs`);
  }
});

test('plaintext password fields and OTP response fallbacks are unused', () => {
  for (const file of [
    'routes/passwords.js',
    'routes/parent.js',
    'routes/auth.js',
    'client/src/components/admin/PasswordManagement.js',
    'client/src/components/parent/ParentForgotPassword.js',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /display_password|temp_password_plain|dev_otp/);
  }
});

test('temporary passwords and OTPs use cryptographic randomness', () => {
  const generator = read('utils/passwordGenerator.js');
  const auth = read('routes/auth.js');
  assert.match(generator, /crypto\.randomBytes/);
  assert.doesNotMatch(generator, /Math\.random/);
  assert.match(auth, /crypto\.randomInt\(100000,\s*1000000\)/);
  assert.match(auth, /bcrypt\.hash\(otp/);
  assert.doesNotMatch(auth, /dev_otp|console\.log\([^)]*otp/i);
});

test('JWT default lifetime is bounded', () => {
  const auth = read('routes/auth.js');
  assert.match(auth, /JWT_EXPIRES_IN/);
  assert.match(auth, /'12h'/);
  assert.doesNotMatch(auth, /'1y'/);
});

test('payment receipts require admin access or owning parent access', () => {
  const route = read('routes/paymentProofs.js');
  assert.match(route, /const isAdmin = \['admin', 'super_admin'\]\.includes\(req\.user\.role\)/);
  assert.match(route, /const isOwningParent = req\.user\.role === 'parent' && proof\.parent_id === req\.user\.id/);
  assert.match(route, /if \(!isAdmin && !isOwningParent\)/);
});

test('S3 configuration has no fabricated region or bucket fallback', () => {
  const config = read('config/s3.js');
  assert.doesNotMatch(config, /harmony-learning-documents/);
  assert.doesNotMatch(config, /\|\| 'us-east-1'/);
});

test('authenticated document downloads are proxied instead of redirected', () => {
  const documents = read('routes/documents.js');
  assert.match(documents, /getFileContent\(document\.s3_key\)/);
  assert.doesNotMatch(documents, /res\.redirect\(signedUrl\)/);
});