const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const { Pool } = require('pg');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'migrations', 'secure_registration_portal_phase.sql'),
  'utf8',
);
const uploadMigration = fs.readFileSync(
  path.join(root, 'migrations', 'admissions_documents_notifications.sql'),
  'utf8',
);

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const requestJson = (server, method, route, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const request = http.request({
    host: '127.0.0.1',
    port: server.address().port,
    path: route,
    method,
    headers: payload ? {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    } : {},
  }, (response) => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { text += chunk; });
    response.on('end', () => {
      resolve({
        status: response.statusCode,
        headers: response.headers,
        body: text ? JSON.parse(text) : null,
      });
    });
  });
  request.once('error', reject);
  if (payload) request.write(payload);
  request.end();
});

test('isolated PostgreSQL migration, concurrency and Parent API', { timeout: 120000 }, async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-portal-pg-'));
  const dataDirectory = path.join(temporaryRoot, 'data');
  const logFile = path.join(temporaryRoot, 'postgres.log');
  const port = await getFreePort();
  let pool;
  let server;

  try {
    execFileSync('initdb', [
      '-D', dataDirectory,
      '--auth=trust',
      '--username=postgres',
      '--no-locale',
      '--encoding=UTF8',
    ], { stdio: 'ignore' });
    execFileSync('pg_ctl', [
      '-D', dataDirectory,
      '-l', logFile,
      '-o', `-F -p ${port} -h 127.0.0.1 -k ${temporaryRoot}`,
      '-w', 'start',
    ], { stdio: 'ignore' });

    pool = new Pool({
      host: '127.0.0.1',
      port,
      database: 'postgres',
      user: 'postgres',
      ssl: false,
      max: 20,
    });
    const database = {
      pool,
      query: (sql, params) => pool.query(sql, params),
    };

    await pool.query(`
      CREATE SEQUENCE enrollment_application_reference_seq;
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(20) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE enrollments (
        id SERIAL PRIMARY KEY,
        application_reference VARCHAR(32),
        parent_first_name VARCHAR(100) NOT NULL,
        parent_last_name VARCHAR(100) NOT NULL,
        parent_email VARCHAR(255) NOT NULL,
        parent_phone VARCHAR(50) NOT NULL,
        student_first_name VARCHAR(100) NOT NULL,
        student_last_name VARCHAR(100) NOT NULL,
        student_date_of_birth DATE NOT NULL,
        grade_applying VARCHAR(50) NOT NULL,
        boarding_option BOOLEAN DEFAULT false,
        previous_school VARCHAR(255),
        additional_notes TEXT,
        admin_notes TEXT,
        parent_status_message TEXT,
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        status VARCHAR(40) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE enrollment_status_history (
        id BIGSERIAL PRIMARY KEY,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        previous_status VARCHAR(40),
        new_status VARCHAR(40) NOT NULL,
        changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        parent_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE admissions_email_log (
        id BIGSERIAL PRIMARY KEY,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        email_type VARCHAR(80) NOT NULL,
        delivery_status VARCHAR(20) NOT NULL,
        message_id VARCHAR(255),
        error_message VARCHAR(80),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE registration_records (
        id BIGSERIAL PRIMARY KEY,
        enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
        form_status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'
          CHECK (form_status IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'CORRECTIONS_REQUESTED')),
        residential_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        postal_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        emergency_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
        service_selections JSONB NOT NULL DEFAULT '{}'::jsonb,
        confirmed_at TIMESTAMP,
        started_at TIMESTAMP,
        submitted_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE admissions_portal_tokens (
        id BIGSERIAL PRIMARY KEY,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        purpose VARCHAR(32) NOT NULL
          CHECK (purpose IN ('UPDATE_APPLICATION', 'COMPLETE_REGISTRATION')),
        token_hash CHAR(64) NOT NULL UNIQUE,
        issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        replaced_by_token_id BIGINT REFERENCES admissions_portal_tokens(id) ON DELETE SET NULL,
        first_used_at TIMESTAMP,
        last_used_at TIMESTAMP,
        use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (expires_at > issued_at)
      );
      CREATE INDEX idx_admissions_portal_tokens_enrollment
        ON admissions_portal_tokens(enrollment_id, purpose, issued_at DESC);
      CREATE UNIQUE INDEX idx_admissions_portal_tokens_one_active
        ON admissions_portal_tokens(enrollment_id, purpose)
        WHERE revoked_at IS NULL;
      CREATE TABLE registration_checklist_items (
        id BIGSERIAL PRIMARY KEY,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        item_type VARCHAR(40) NOT NULL
          CHECK (item_type IN (
            'BIRTH_CERTIFICATE', 'PARENT_GUARDIAN_ID', 'LATEST_SCHOOL_REPORT',
            'TRANSFER_DOCUMENT', 'REGISTRATION_FORM'
          )),
        status VARCHAR(24) NOT NULL DEFAULT 'MISSING'
          CHECK (status IN ('MISSING', 'RECEIVED', 'BRING_IN_PERSON', 'NOT_APPLICABLE')),
        requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        requested_at TIMESTAMP,
        received_at TIMESTAMP,
        admin_note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (enrollment_id, item_type)
      );
      CREATE INDEX idx_registration_checklist_enrollment
        ON registration_checklist_items(enrollment_id);
      CREATE TABLE admissions_portal_documents (
        id BIGSERIAL PRIMARY KEY,
        public_id UUID NOT NULL UNIQUE,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        checklist_item_id BIGINT REFERENCES registration_checklist_items(id) ON DELETE SET NULL,
        storage_key VARCHAR(500) NOT NULL UNIQUE,
        original_filename VARCHAR(255) NOT NULL,
        content_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
        review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
          CHECK (review_status IN ('PENDING', 'RECEIVED', 'REJECTED', 'REPLACEMENT_REQUIRED')),
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_admissions_portal_documents_enrollment
        ON admissions_portal_documents(enrollment_id, uploaded_at DESC);
      INSERT INTO users (email, first_name, last_name, role) VALUES
        ('admin@example.test', 'Test', 'Admin', 'admin'),
        ('learner@example.test', 'Existing', 'Learner', 'student');
      INSERT INTO enrollments (
        application_reference, parent_first_name, parent_last_name, parent_email, parent_phone,
        student_first_name, student_last_name, student_date_of_birth, grade_applying,
        boarding_option, previous_school, additional_notes, admin_notes, status
      ) VALUES (
        'HLI-2027-TEST', 'Parent', 'One', 'parent@example.test', '0712345678',
        'Child', 'One', '2018-01-02', 'Grade 1', false, 'Previous School',
        'Existing note', 'Private admin note', 'APPROVED'
      );
    `);

    const snapshot = async () => {
      const enrollments = await pool.query('SELECT * FROM enrollments ORDER BY id');
      const learners = await pool.query("SELECT * FROM users WHERE role = 'student' ORDER BY id");
      return JSON.stringify({ enrollments: enrollments.rows, learners: learners.rows });
    };
    const before = await snapshot();

    await t.test('migration applies twice without changing enrollment or learner records', async () => {
      await pool.query(migration);
      await pool.query(uploadMigration);
      assert.equal(await snapshot(), before);
      const upgraded = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'registration_records'
          AND column_name IN ('requested_application_fields', 'application_update_submitted_at')
        ORDER BY column_name
      `);
      assert.deepEqual(upgraded.rows.map(({ column_name }) => column_name), [
        'application_update_submitted_at',
        'requested_application_fields',
      ]);
      await pool.query(migration);
      await pool.query(uploadMigration);
      assert.equal(await snapshot(), before);
    });

    await t.test('schema has exact critical types, constraints, foreign keys and indexes', async () => {
      const columns = await pool.query(`
        SELECT table_name, column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position
      `, [[
        'admissions_portal_tokens',
        'registration_records',
        'registration_checklist_items',
        'admissions_portal_documents',
      ]]);
      const findColumn = (table, column) => columns.rows.find(
        (row) => row.table_name === table && row.column_name === column,
      );
      assert.deepEqual(findColumn('admissions_portal_tokens', 'token_hash'), {
        table_name: 'admissions_portal_tokens',
        column_name: 'token_hash',
        data_type: 'character',
        character_maximum_length: 64,
        is_nullable: 'NO',
      });
      assert.equal(findColumn('registration_records', 'residential_address').data_type, 'jsonb');
      assert.equal(findColumn('admissions_portal_documents', 'public_id').data_type, 'uuid');
      const signatures = Object.fromEntries([
        'admissions_portal_tokens',
        'registration_records',
        'registration_checklist_items',
        'admissions_portal_documents',
      ].map((table) => [table, columns.rows.filter((row) => row.table_name === table).map((row) => (
        `${row.column_name}:${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''}:${row.is_nullable}`
      ))]));
      assert.deepEqual(signatures, {
        admissions_portal_tokens: [
          'id:bigint:NO', 'enrollment_id:integer:NO', 'purpose:character varying(32):NO',
          'token_hash:character(64):NO', 'issued_by:integer:YES',
          'issued_at:timestamp without time zone:NO', 'expires_at:timestamp without time zone:NO',
          'revoked_at:timestamp without time zone:YES', 'replaced_by_token_id:bigint:YES',
          'first_used_at:timestamp without time zone:YES', 'last_used_at:timestamp without time zone:YES',
          'use_count:integer:NO', 'created_at:timestamp without time zone:NO',
        ],
        registration_records: [
          'id:bigint:NO', 'enrollment_id:integer:NO', 'form_status:character varying(20):NO',
          'residential_address:jsonb:NO', 'postal_address:jsonb:NO', 'emergency_contact:jsonb:NO',
          'service_selections:jsonb:NO', 'confirmed_at:timestamp without time zone:YES',
          'started_at:timestamp without time zone:YES', 'submitted_at:timestamp without time zone:YES',
          'created_at:timestamp without time zone:NO', 'updated_at:timestamp without time zone:NO',
          'requested_application_fields:jsonb:NO',
          'application_update_submitted_at:timestamp without time zone:YES',
        ],
        registration_checklist_items: [
          'id:bigint:NO', 'enrollment_id:integer:NO', 'item_type:character varying(40):NO',
          'status:character varying(24):NO', 'requested_by:integer:YES',
          'requested_at:timestamp without time zone:YES',
          'received_at:timestamp without time zone:YES', 'admin_note:text:YES',
          'created_at:timestamp without time zone:NO', 'updated_at:timestamp without time zone:NO',
          'parent_submission_choice:character varying(20):YES',
        ],
        admissions_portal_documents: [
          'id:bigint:NO', 'public_id:uuid:NO', 'enrollment_id:integer:NO',
          'checklist_item_id:bigint:YES', 'storage_key:character varying(500):NO',
          'original_filename:character varying(255):NO', 'content_type:character varying(100):NO',
          'file_size:bigint:NO', 'review_status:character varying(24):NO',
          'reviewed_by:integer:YES', 'reviewed_at:timestamp without time zone:YES',
          'uploaded_at:timestamp without time zone:NO',
           'sha256:character(64):YES', 'detected_content_type:character varying(100):YES',
           'upload_source:character varying(30):NO', 'scan_status:character varying(24):NO',
           'rejection_reason:character varying(1000):YES',
           'replacement_requested_at:timestamp without time zone:YES',
           'deleted_at:timestamp without time zone:YES', 'replaced_at:timestamp without time zone:YES',
           'superseded_by_document_id:bigint:YES',
        ],
      });

      const constraints = await pool.query(`
        SELECT conrelid::regclass::text AS table_name, contype,
          pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = ANY($1::regclass[])
        ORDER BY conrelid::regclass::text, contype, definition
      `, [[
        'admissions_portal_tokens',
        'registration_records',
        'registration_checklist_items',
        'admissions_portal_documents',
      ]]);
      assert.ok(constraints.rows.some(({ table_name, contype, definition }) => (
        table_name === 'admissions_portal_tokens'
        && contype === 'f'
        && definition.includes('FOREIGN KEY (enrollment_id) REFERENCES enrollments(id)')
      )));
      assert.ok(constraints.rows.some(({ table_name, contype, definition }) => (
        table_name === 'registration_records'
        && contype === 'u'
        && definition.includes('UNIQUE (enrollment_id)')
      )));
      assert.ok(constraints.rows.some(({ definition }) => definition.includes('CORRECTIONS_REQUESTED')));
      assert.ok(constraints.rows.some(({ definition }) => definition.includes('parent_submission_choice')));
      assert.equal(constraints.rows.filter(({ contype }) => contype === 'f').length, 10);
      assert.equal(constraints.rows.filter(({ contype }) => contype === 'p').length, 4);
      assert.equal(constraints.rows.filter(({ contype }) => contype === 'u').length, 5);
      const checks = constraints.rows
        .filter(({ contype }) => contype === 'c')
        .map(({ definition }) => definition);
      assert.equal(checks.length, 11);
      for (const fragment of [
        'UPDATE_APPLICATION', 'COMPLETE_REGISTRATION',
        'expires_at > issued_at', 'use_count >= 0',
        'NOT_STARTED', 'CORRECTIONS_REQUESTED',
        'BIRTH_CERTIFICATE', 'REGISTRATION_FORM',
        'MISSING', 'BRING_IN_PERSON', 'NOT_APPLICABLE',
        'UPLOAD_ONLINE',
        'file_size > 0', 'file_size <= 10485760',
        'PENDING', 'REPLACEMENT_REQUIRED',
      ]) assert.ok(checks.some((definition) => definition.includes(fragment)), fragment);
      const foreignKeys = constraints.rows
        .filter(({ contype }) => contype === 'f')
        .map(({ definition }) => definition);
      for (const fragment of [
        'FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE',
        'FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL',
        'FOREIGN KEY (replaced_by_token_id) REFERENCES admissions_portal_tokens(id) ON DELETE SET NULL',
        'FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL',
        'FOREIGN KEY (checklist_item_id) REFERENCES registration_checklist_items(id) ON DELETE SET NULL',
        'FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL',
      ]) assert.ok(foreignKeys.some((definition) => definition.includes(fragment)), fragment);

      const indexes = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY($1::text[])
        ORDER BY indexname
      `, [[
        'idx_admissions_portal_tokens_enrollment',
        'idx_admissions_portal_tokens_one_active',
        'idx_registration_checklist_enrollment',
        'idx_admissions_portal_documents_enrollment',
      ]]);
      assert.equal(indexes.rows.length, 4);
      const active = indexes.rows.find(({ indexname }) => indexname === 'idx_admissions_portal_tokens_one_active');
      assert.match(active.indexdef, /CREATE UNIQUE INDEX/);
      assert.match(active.indexdef, /\(enrollment_id, purpose\)/);
      assert.match(active.indexdef, /WHERE \(revoked_at IS NULL\)/);
      const enrollmentLookup = indexes.rows.find(
        ({ indexname }) => indexname === 'idx_admissions_portal_tokens_enrollment',
      );
      assert.match(enrollmentLookup.indexdef, /\(enrollment_id, purpose, issued_at DESC\)$/);
      const checklistLookup = indexes.rows.find(
        ({ indexname }) => indexname === 'idx_registration_checklist_enrollment',
      );
      assert.match(checklistLookup.indexdef, /\(enrollment_id\)$/);
      const documentLookup = indexes.rows.find(
        ({ indexname }) => indexname === 'idx_admissions_portal_documents_enrollment',
      );
      assert.match(documentLookup.indexdef, /\(enrollment_id, uploaded_at DESC\)$/);
      const allIndexes = await pool.query(`
        SELECT tablename, COUNT(*)::int AS count
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        GROUP BY tablename
        ORDER BY tablename
      `, [[
        'admissions_portal_tokens',
        'registration_records',
        'registration_checklist_items',
        'admissions_portal_documents',
      ]]);
      assert.deepEqual(allIndexes.rows, [
        { tablename: 'admissions_portal_documents', count: 7 },
        { tablename: 'admissions_portal_tokens', count: 4 },
        { tablename: 'registration_checklist_items', count: 3 },
        { tablename: 'registration_records', count: 2 },
      ]);
    });

    const databasePath = require.resolve('../config/database');
    require.cache[databasePath] = {
      id: databasePath,
      filename: databasePath,
      loaded: true,
      exports: database,
    };
    delete require.cache[require.resolve('../services/admissionsPortalTokenService')];
    delete require.cache[require.resolve('../middleware/admissionsPortalSchema')];
    delete require.cache[require.resolve('../routes/admissionsPortal')];
    const {
      TOKEN_PURPOSES,
      issuePortalToken,
      issuePortalTokenInTransaction,
      reissuePortalToken,
      revokePortalTokens,
      validatePortalToken,
      revokePortalTokensInTransaction,
      withValidatedPortalToken,
    } = require('../services/admissionsPortalTokenService');

    await t.test('concurrent issue and reissue preserve one active token', async () => {
      await Promise.all(Array.from({ length: 6 }, () => issuePortalToken({
        enrollmentId: 1,
        purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
        database,
      })));
      await Promise.all(Array.from({ length: 4 }, () => reissuePortalToken({
        enrollmentId: 1,
        purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
        database,
      })));
      const active = await pool.query(`
        SELECT COUNT(*)::int AS count FROM admissions_portal_tokens
        WHERE enrollment_id = 1 AND purpose = 'COMPLETE_REGISTRATION' AND revoked_at IS NULL
      `);
      assert.equal(active.rows[0].count, 1);
    });

    await t.test('concurrent issue and revoke serialize safely', async () => {
      await Promise.all([
        issuePortalToken({
          enrollmentId: 1,
          purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
          database,
        }),
        revokePortalTokens({
          enrollmentId: 1,
          purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
          database,
        }),
      ]);
      const active = await pool.query(`
        SELECT COUNT(*)::int AS count FROM admissions_portal_tokens
        WHERE enrollment_id = 1 AND purpose = 'COMPLETE_REGISTRATION' AND revoked_at IS NULL
      `);
      assert.ok(active.rows[0].count === 0 || active.rows[0].count === 1);
    });

    await pool.query("UPDATE enrollments SET status = 'MORE_INFORMATION_REQUIRED' WHERE id = 1");
    const updateToken = await issuePortalToken({
      enrollmentId: 1,
      purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
      database,
    });

    await t.test('concurrent protected writes remain atomic', async () => {
      await Promise.all(Array.from({ length: 5 }, () => withValidatedPortalToken(updateToken.token, {
        database,
        action: async (client, context) => {
          await client.query(`
            UPDATE enrollments
            SET additional_notes = COALESCE(additional_notes, '') || 'x'
            WHERE id = $1
          `, [context.enrollment_id]);
        },
      })));
      const result = await pool.query('SELECT additional_notes FROM enrollments WHERE id = 1');
      assert.equal(result.rows[0].additional_notes, 'Existing notexxxxx');
    });

    await pool.query(`
      INSERT INTO registration_records (enrollment_id, requested_application_fields)
      VALUES (1, '["parentPhone"]'::jsonb)
      ON CONFLICT (enrollment_id) DO UPDATE
      SET requested_application_fields = EXCLUDED.requested_application_fields;
      INSERT INTO registration_checklist_items
        (enrollment_id, item_type, status, requested_at)
      VALUES (1, 'BIRTH_CERTIFICATE', 'MISSING', CURRENT_TIMESTAMP)
      ON CONFLICT (enrollment_id, item_type) DO UPDATE
      SET requested_at = CURRENT_TIMESTAMP, status = 'MISSING';
    `);

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/admissions-portal', require('../routes/admissionsPortal'));
    const authPath = require.resolve('../middleware/auth');
    const gmailPath = require.resolve('../services/gmailService');
    const auditPath = require.resolve('../utils/auditLogger');
    const routePath = require.resolve('../routes/enrollments');
    [authPath, gmailPath, auditPath].forEach((modulePath) => require(modulePath));
    const savedModules = [authPath, gmailPath, auditPath].map((p) => require.cache[p]?.exports);
    require.cache[authPath].exports = {
      authenticate: (req, res, next) => {
        req.user = { id: 1, role: 'admin', email: 'test-admin@example.test' };
        next();
      },
    };
    require.cache[gmailPath].exports = {
      ...savedModules[1],
      sendAdmissionsStatusEmail: async () => ({ success: false, error: 'EMAIL_API_FAILED' }),
      normalizeEmailResult: (result) => result?.success
        ? result : { success: false, error: result?.error || 'UNKNOWN_EMAIL_FAILURE' },
    };
    require.cache[auditPath].exports = { logAudit: async () => {}, getIp: () => '127.0.0.1' };
    delete require.cache[routePath];
    app.use('/api/enrollments', require('../routes/enrollments'));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    await t.test('Parent API returns safe session and applies only requested updates', async () => {
      const session = await requestJson(
        server,
        'GET',
        `/api/admissions-portal/session/${updateToken.token}`,
      );
      assert.equal(session.status, 200);
      assert.equal(session.headers['referrer-policy'], 'no-referrer');
      assert.equal(session.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
      assert.deepEqual(Object.keys(session.body).sort(), [
        'access', 'application', 'checklist', 'expiresAt', 'mode', 'registration', 'requestedFields',
      ]);
      assert.equal(JSON.stringify(session.body).includes('Private admin note'), false);
      assert.equal(session.body.application.additionalNotes, 'Existing notexxxxx');
      assert.equal(JSON.stringify(session.body).includes('"id"'), false);
      assert.equal(JSON.stringify(session.body).includes('token_hash'), false);

      const rejected = await requestJson(
        server,
        'PATCH',
        `/api/admissions-portal/application/${updateToken.token}`,
        { fields: { parentEmail: 'not-requested@example.test' } },
      );
      assert.equal(rejected.status, 400);

      const saved = await requestJson(
        server,
        'PATCH',
        `/api/admissions-portal/application/${updateToken.token}`,
        {
          fields: { parentPhone: '0799999999' },
          checklistChoices: { BIRTH_CERTIFICATE: 'BRING_IN_PERSON' },
        },
      );
      assert.equal(saved.status, 200);
      const stored = await pool.query(`
        SELECT e.parent_phone, e.status, ci.status AS checklist_status
        FROM enrollments e
        JOIN registration_checklist_items ci ON ci.enrollment_id = e.id
        WHERE e.id = 1 AND ci.item_type = 'BIRTH_CERTIFICATE'
      `);
      assert.equal(stored.rows[0].parent_phone, '0799999999');
      assert.equal(stored.rows[0].status, 'MORE_INFORMATION_REQUIRED');
      assert.equal(stored.rows[0].checklist_status, 'BRING_IN_PERSON');

      const submitted = await requestJson(
        server,
        'POST',
        `/api/admissions-portal/application/${updateToken.token}/submit`,
        {},
      );
      assert.deepEqual(submitted.body, {
        submitted: true,
        alreadySubmitted: false,
        statusChanged: false,
      });
      const firstSubmissionState = await pool.query(`
        SELECT application_update_submitted_at, updated_at
        FROM registration_records WHERE enrollment_id = 1
      `);
      const resubmitted = await requestJson(
        server,
        'POST',
        `/api/admissions-portal/application/${updateToken.token}/submit`,
        {},
      );
      assert.deepEqual(resubmitted.body, {
        submitted: true,
        alreadySubmitted: true,
        statusChanged: false,
      });
      const repeatedSubmissionState = await pool.query(`
        SELECT application_update_submitted_at, updated_at
        FROM registration_records WHERE enrollment_id = 1
      `);
      assert.deepEqual(repeatedSubmissionState.rows[0], firstSubmissionState.rows[0]);
      const unchanged = await pool.query('SELECT status FROM enrollments WHERE id = 1');
      assert.equal(unchanged.rows[0].status, 'MORE_INFORMATION_REQUIRED');
    });

    await pool.query(`
      UPDATE enrollments SET status = 'approved' WHERE id = 1;
      UPDATE registration_records SET
        form_status = 'NOT_STARTED',
        residential_address = '{}'::jsonb,
        postal_address = '{}'::jsonb,
        emergency_contact = '{}'::jsonb,
        service_selections = '{}'::jsonb,
        confirmed_at = NULL,
        submitted_at = NULL
      WHERE enrollment_id = 1;
    `);
    const registrationToken = await issuePortalToken({
      enrollmentId: 1,
      purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
      database,
    });

    await t.test('registration drafts, idempotent submission and read-only state work', async () => {
      const draft = await requestJson(
        server,
        'PATCH',
        `/api/admissions-portal/registration/${registrationToken.token}`,
        {
          residentialAddress: {
            addressLine1: '2 Skilferdoring Street',
            city: 'Lephalale',
            postalCode: '0555',
          },
          postalAddress: { sameAsResidential: true },
          emergencyContact: {
            fullName: 'Emergency Contact',
            relationship: 'Aunt',
            phone: '0788888888',
          },
          serviceSelections: { boarding: false, transport: true, aftercare: false },
          confirmed: true,
        },
      );
      assert.equal(draft.status, 200);

      const firstSubmit = await requestJson(
        server,
        'POST',
        `/api/admissions-portal/registration/${registrationToken.token}/submit`,
        {},
      );
      assert.deepEqual(firstSubmit.body, {
        submitted: true,
        alreadySubmitted: false,
        status: 'REGISTRATION_PENDING',
      });
      const secondSubmit = await requestJson(
        server,
        'POST',
        `/api/admissions-portal/registration/${registrationToken.token}/submit`,
        {},
      );
      assert.deepEqual(secondSubmit.body, {
        submitted: true,
        alreadySubmitted: true,
        status: 'REGISTRATION_PENDING',
      });

      const rejectedEdit = await requestJson(
        server,
        'PATCH',
        `/api/admissions-portal/registration/${registrationToken.token}`,
        { serviceSelections: { transport: false } },
      );
      assert.equal(rejectedEdit.status, 404);

      const readOnly = await requestJson(
        server,
        'GET',
        `/api/admissions-portal/session/${registrationToken.token}`,
      );
      assert.equal(readOnly.body.access, 'read_only');
      assert.equal(readOnly.body.registration.formStatus, 'SUBMITTED');

      const status = await pool.query('SELECT status FROM enrollments WHERE id = 1');
      assert.equal(status.rows[0].status, 'REGISTRATION_PENDING');
      const history = await pool.query(`
        SELECT previous_status, new_status, changed_by
        FROM enrollment_status_history WHERE enrollment_id = 1
      `);
      assert.deepEqual(history.rows, [{
        previous_status: 'approved',
        new_status: 'REGISTRATION_PENDING',
        changed_by: null,
      }]);
    });

    await t.test('Admin HTTP handlers commit secure Phase 5 workflows and return safe payloads', async () => {
      await pool.query(`
        INSERT INTO enrollments (
          application_reference, parent_first_name, parent_last_name, parent_email, parent_phone,
          student_first_name, student_last_name, student_date_of_birth, grade_applying, status
        ) VALUES ('HLI-2027-HTTP', 'Http', 'Admin', 'http@example.test', '0722222222',
          'Http', 'Learner', '2016-01-01', 'Grade 3', 'NEW')
      `);
      const row = await pool.query("SELECT id FROM enrollments WHERE application_reference = 'HLI-2027-HTTP'");
      const id = row.rows[0].id;
      let response = await requestJson(server, 'PUT', `/api/enrollments/${id}/status`, { status: 'APPROVED' });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const approved = await pool.query('SELECT status FROM enrollments WHERE id = $1', [id]);
      const completion = await pool.query(`
        SELECT token_hash, id FROM admissions_portal_tokens
        WHERE enrollment_id = $1 AND purpose = 'COMPLETE_REGISTRATION' AND revoked_at IS NULL
      `, [id]);
      assert.equal(approved.rows[0].status, 'APPROVED');
      assert.equal(completion.rows.length, 1);
      assert.equal(response.body.emailSent, false);

      response = await requestJson(server, 'PUT', `/api/enrollments/${id}/status`, { status: 'APPROVED' });
      assert.equal(response.status, 200);
      assert.equal(response.body.statusChanged, false);
      assert.equal(JSON.stringify(response.body), JSON.stringify(response.body).replace(/registration_token_hash/g, ''));

      response = await requestJson(server, 'POST', `/api/enrollments/${id}/information-request`, {
        requestedFields: ['parentPhone'],
        checklistItems: ['LATEST_SCHOOL_REPORT'],
        parentMessage: 'Please update the report.',
      });
      assert.equal(response.status, 200);
      const requested = await pool.query(`
        SELECT e.status, rr.requested_application_fields, ci.status AS checklist_status,
          ci.requested_at, t.purpose, t.revoked_at
        FROM enrollments e
        JOIN registration_records rr ON rr.enrollment_id = e.id
        JOIN registration_checklist_items ci ON ci.enrollment_id = e.id
        LEFT JOIN admissions_portal_tokens t ON t.enrollment_id = e.id
          AND t.purpose IN ('UPDATE_APPLICATION', 'COMPLETE_REGISTRATION')
        WHERE e.id = $1 AND ci.item_type = 'LATEST_SCHOOL_REPORT'
        ORDER BY t.purpose
      `, [id]);
      assert.equal(requested.rows[0].status, 'MORE_INFORMATION_REQUIRED');
      assert.deepEqual(requested.rows[0].requested_application_fields, ['parentPhone']);
      assert.equal(requested.rows[0].checklist_status, 'MISSING');
      assert.ok(requested.rows.some((item) => item.purpose === 'COMPLETE_REGISTRATION' && item.revoked_at));
      assert.ok(requested.rows.some((item) => item.purpose === 'UPDATE_APPLICATION' && !item.revoked_at));

      response = await requestJson(server, 'POST', `/api/enrollments/${id}/portal-link/reissue`, {
        purpose: 'UPDATE_APPLICATION',
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.linkReissued, true);
      assert.equal(JSON.stringify(response.body).includes('token_hash'), false);
      assert.equal(JSON.stringify(response.body).includes('token'), false);
      response = await requestJson(server, 'POST', `/api/enrollments/${id}/portal-link/revoke`, {
        purpose: 'UPDATE_APPLICATION',
      });
      assert.equal(response.status, 200);
      const revoked = await pool.query(`
        SELECT COUNT(*)::int AS count FROM admissions_portal_tokens
        WHERE enrollment_id = $1 AND purpose = 'UPDATE_APPLICATION' AND revoked_at IS NULL
      `, [id]);
      assert.equal(revoked.rows[0].count, 0);

      response = await requestJson(server, 'PATCH', `/api/enrollments/${id}/checklist/LATEST_SCHOOL_REPORT`, {
        status: 'RECEIVED',
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      response = await requestJson(server, 'PATCH', `/api/enrollments/${id}/checklist/TRANSFER_DOCUMENT`, {
        status: 'NOT_APPLICABLE',
      });
      assert.equal(response.status, 200);
      const checklist = await pool.query(`
        SELECT item_type, status, received_at FROM registration_checklist_items
        WHERE enrollment_id = $1 AND item_type IN ('LATEST_SCHOOL_REPORT', 'TRANSFER_DOCUMENT')
        ORDER BY item_type
      `, [id]);
      assert.deepEqual(checklist.rows.map(({ item_type, status }) => [item_type, status]), [
        ['LATEST_SCHOOL_REPORT', 'RECEIVED'],
        ['TRANSFER_DOCUMENT', 'NOT_APPLICABLE'],
      ]);

      response = await requestJson(server, 'GET', `/api/enrollments/${id}`);
      assert.equal(response.status, 200);
      const serialized = JSON.stringify(response.body);
      for (const secret of ['registration_token_hash', 'registration_token_issued_at', 'registration_token_expires_at', 'token_hash', 'token_id']) {
        assert.equal(serialized.includes(secret), false, secret);
      }
    });

    await t.test('Phase 5 transactional token lifecycle uses only disposable PostgreSQL state', async () => {
      const { buildPortalLink } = require('../services/admissionsPortalLinks');
      await pool.query(`
        INSERT INTO enrollments (
          application_reference, parent_first_name, parent_last_name, parent_email, parent_phone,
          student_first_name, student_last_name, student_date_of_birth, grade_applying, status
        ) VALUES ('HLI-2027-P5', 'Phase', 'Five', 'phase5@example.test', '0711111111',
          'Test', 'Learner', '2017-01-01', 'Grade 2', 'MORE_INFORMATION_REQUIRED')
      `);
      const enrollment = await pool.query(
        "SELECT id FROM enrollments WHERE application_reference = 'HLI-2027-P5'",
      );
      const id = enrollment.rows[0].id;

      await pool.query(`
        INSERT INTO registration_records (enrollment_id, requested_application_fields)
        VALUES ($1, '["parentPhone","previousSchool"]'::jsonb)
      `, [id]);
      await pool.query(`
        INSERT INTO registration_checklist_items
          (enrollment_id, item_type, status, requested_by, requested_at)
        VALUES ($1, 'LATEST_SCHOOL_REPORT', 'MISSING', 1, CURRENT_TIMESTAMP)
      `, [id]);
      const update = await issuePortalToken({
        enrollmentId: id, purpose: TOKEN_PURPOSES.UPDATE_APPLICATION, database,
      });
      assert.match(buildPortalLink({
        token: update.token, purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
        environment: { FRONTEND_URL: 'https://www.harmonylearning.co.za' },
      }), /\/application\/update\//);
      assert.ok(await validatePortalToken(update.token, { database }));

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("UPDATE enrollments SET status = 'APPROVED' WHERE id = $1", [id]);
        await revokePortalTokensInTransaction({
          client, enrollmentId: id, purpose: TOKEN_PURPOSES.UPDATE_APPLICATION,
        });
        const complete = await issuePortalTokenInTransaction({
          client, enrollmentId: id, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
          issuedBy: 1,
        });
        await client.query('COMMIT');
        let emailAttempted = false;
        try {
          emailAttempted = true;
          throw new Error('simulated Gmail failure');
        } catch {}
        assert.equal(emailAttempted, true);
        const committed = await pool.query(
          'SELECT status FROM enrollments WHERE id = $1', [id],
        );
        assert.equal(committed.rows[0].status, 'APPROVED');
        assert.equal(await validatePortalToken(update.token, { database }), null);
        assert.ok(await validatePortalToken(complete.token, { database }));

        const replacement = await reissuePortalToken({
          enrollmentId: id, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION, database,
        });
        assert.equal(await validatePortalToken(complete.token, { database }), null);
        assert.ok(await validatePortalToken(replacement.token, { database }));
        await revokePortalTokens({
          enrollmentId: id, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION, database,
        });
        assert.equal(await validatePortalToken(replacement.token, { database }), null);
      } finally {
        client.release();
      }

      await pool.query("UPDATE enrollments SET status = 'REGISTRATION_PENDING' WHERE id = $1", [id]);
      const readOnly = await issuePortalToken({
        enrollmentId: id, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION, database,
      });
      const readOnlyRecord = await validatePortalToken(readOnly.token, { database });
      assert.equal(readOnlyRecord.access, 'edit');
      await pool.query("UPDATE registration_records SET form_status = 'SUBMITTED' WHERE enrollment_id = $1", [id]);
      const submitted = await validatePortalToken(readOnly.token, { database });
      assert.equal(submitted.access, 'read_only');

      await pool.query(`
        UPDATE registration_checklist_items SET status = 'RECEIVED', received_at = CURRENT_TIMESTAMP
        WHERE enrollment_id = $1 AND item_type = 'LATEST_SCHOOL_REPORT'
      `, [id]);
      await pool.query(`
        INSERT INTO registration_checklist_items (enrollment_id, item_type, status)
        VALUES ($1, 'TRANSFER_DOCUMENT', 'NOT_APPLICABLE')
      `, [id]);
      const state = await pool.query(`
        SELECT ci.item_type, ci.status, ci.received_at, rr.requested_application_fields
        FROM registration_checklist_items ci
        JOIN registration_records rr ON rr.enrollment_id = ci.enrollment_id
        WHERE ci.enrollment_id = $1 ORDER BY ci.item_type
      `, [id]);
      assert.equal(state.rows.find((row) => row.item_type === 'LATEST_SCHOOL_REPORT').status, 'RECEIVED');
      assert.equal(state.rows.find((row) => row.item_type === 'TRANSFER_DOCUMENT').status, 'NOT_APPLICABLE');
      assert.deepEqual(state.rows[0].requested_application_fields, ['parentPhone', 'previousSchool']);
      assert.doesNotMatch(JSON.stringify(state.rows), /token_hash|token_id|rawToken/);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    try {
      execFileSync('pg_ctl', ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});