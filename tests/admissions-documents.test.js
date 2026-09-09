const test = require('node:test');
const assert = require('node:assert/strict');
const { detectType, validateAdmissionsFile, MAX_FILE_SIZE } = require('../services/admissionsDocumentService');

test('admissions documents require matching magic bytes and MIME', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  assert.equal(detectType(pdf).mime, 'application/pdf');
  assert.doesNotThrow(() => validateAdmissionsFile({ buffer: pdf, mimetype: 'application/pdf' }));
  assert.throws(
    () => validateAdmissionsFile({ buffer: pdf, mimetype: 'image/png' }),
    /valid PDF, JPEG, or PNG/,
  );
});

test('admissions documents enforce the 10MB cap', () => {
  assert.throws(
    () => validateAdmissionsFile({
      buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_FILE_SIZE), Buffer.from('\n%%EOF')]),
      mimetype: 'application/pdf',
    }),
    /no larger than 10MB/,
  );
});

test('admissions documents allow only PDF, JPEG and PNG signatures', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  assert.equal(detectType(jpeg).mime, 'image/jpeg');
  assert.equal(detectType(png).mime, 'image/png');
  assert.equal(detectType(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(detectType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(detectType(Buffer.from('PK\u0003\u0004archive')), null);
  assert.equal(detectType(Buffer.from('MZexecutable')), null);
});

test('notification payloads exclude sensitive and free-form fields', () => {
  const { safePayload } = require('../services/admissionsNotificationService');
  assert.deepEqual(safePayload({
    enrollmentId: 42,
    event: 'DOCUMENT_UPLOADED',
    documentPublicId: 'public-document-id',
    checklistItem: 'BIRTH_CERTIFICATE',
    eventKey: null,
    documentCount: null,
    checklistItems: [],
    token: 'secret',
    storageKey: 'private/key',
    email: 'parent@example.test',
    message: 'free form',
  }), {
    enrollmentId: 42,
    event: 'DOCUMENT_UPLOADED',
    documentPublicId: 'public-document-id',
    checklistItem: 'BIRTH_CERTIFICATE',
    eventKey: null,
    documentCount: null,
    checklistItems: [],
  });
});

test('routes keep portal capabilities and admin notification ownership server-side', () => {
  const fs = require('node:fs');
  const portalRoutes = fs.readFileSync('routes/admissionsPortal.js', 'utf8');
  const notificationRoutes = fs.readFileSync('routes/admissionsNotifications.js', 'utf8');
  const enrollmentRoutes = fs.readFileSync('routes/enrollments.js', 'utf8');
  const adminUi = fs.readFileSync('client/src/components/admin/EnrollmentManagement.js', 'utf8');
  assert.match(portalRoutes, /application\/:token\/documents/);
  assert.match(portalRoutes, /d\.enrollment_id = \$2/);
  assert.match(portalRoutes, /parent_submission_choice = 'UPLOAD_ONLINE'/);
  assert.match(portalRoutes, /FOR UPDATE OF d/);
  assert.match(portalRoutes, /d\.deleted_at IS NULL AND d\.superseded_by_document_id IS NULL/);
  assert.match(portalRoutes, /rejectionReason: row\.rejection_reason/);
  assert.match(portalRoutes, /parent_submission_choice = NULL, status = 'MISSING'/);
  assert.match(portalRoutes, /parent_submission_choice = 'UPLOAD_ONLINE'[\s\S]*NOT EXISTS/);
  assert.doesNotMatch(portalRoutes, /direct.*s3|Location:/i);
  assert.match(notificationRoutes, /WHERE recipient_id = \$1/);
  assert.match(notificationRoutes, /\[req\.user\.id/);
  assert.match(notificationRoutes, /asyncRoute/);
  assert.match(notificationRoutes, /Invalid notification identifier/);
  assert.match(notificationRoutes, /to_regclass\('public\.admissions_notifications'\)/);
  assert.doesNotMatch(notificationRoutes, /req\.(body|query)\.recipient/i);
  assert.match(enrollmentRoutes, /Content-Disposition/);
  assert.match(enrollmentRoutes, /attachment;/);
  assert.match(enrollmentRoutes, /Review or remove the active uploaded document/);
  assert.match(enrollmentRoutes, /application_update_submitted_at = NULL/);
  assert.match(enrollmentRoutes, /router\.delete\('\/:id\/documents\/:publicId'[\s\S]*SELECT id FROM enrollments WHERE id = \$1 FOR UPDATE[\s\S]*FOR UPDATE/);
  assert.match(adminUi, /item\.document\?\.originalFilename/);
  assert.match(adminUi, /item\.document\?\.contentType \|\| response\.data\?\.type/);
  assert.match(adminUi, /contentType === 'image\/jpeg'/);
  assert.doesNotMatch(adminUi, /anchor\.download = `\$\{item\.itemType\}\.pdf`/);
});

test('additive migration retires upload later without running automatically', () => {
  const fs = require('node:fs');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const migration = fs.readFileSync('migrations/admissions_documents_notifications.sql', 'utf8');
  const runner = fs.readFileSync('scripts/run-admissions-documents-migration.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(migration, /WHERE parent_submission_choice = 'UPLOAD_LATER'/);
  assert.match(migration, /UPLOAD_ONLINE/);
  assert.match(migration, /sha256/);
  assert.match(migration, /superseded_by_document_id/);
  assert.match(migration, /DROP INDEX IF EXISTS idx_admissions_documents_sha256_active/);
  assert.match(migration, /replaced_at IS NULL/);
  assert.equal(
    packageJson.scripts['migrate:admissions-documents'],
    'node scripts/run-admissions-documents-migration.js',
  );
  assert.match(runner, /admissions_documents_notifications\.sql/);
  assert.match(runner, /isAdmissionsPortalSchemaReady/);
  assert.match(runner, /migration applied and verified/);
  assert.match(migration, /admissions_notifications/);
  assert.doesNotMatch(server, /admissions_documents_notifications\.sql/);
});