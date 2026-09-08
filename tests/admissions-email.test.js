const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const originalUser = process.env.GMAIL_USER;
const originalPassword = process.env.GMAIL_APP_PASSWORD;

const loadServiceWithTransport = (transport) => {
  const nodemailerPath = require.resolve('nodemailer');
  const servicePath = require.resolve('../services/gmailService');
  require(nodemailerPath);
  require.cache[nodemailerPath].exports = {
    createTransport: () => transport,
  };
  delete require.cache[servicePath];
  return require(servicePath);
};

test.afterEach(() => {
  if (originalUser === undefined) delete process.env.GMAIL_USER;
  else process.env.GMAIL_USER = originalUser;
  if (originalPassword === undefined) delete process.env.GMAIL_APP_PASSWORD;
  else process.env.GMAIL_APP_PASSWORD = originalPassword;
  delete require.cache[require.resolve('../services/gmailService')];
  delete require.cache[require.resolve('nodemailer')];
});

test('application and Admin confirmations use Gmail SMTP without exposing credentials', async () => {
  process.env.GMAIL_USER = 'sender@example.com';
  process.env.GMAIL_APP_PASSWORD = 'test app password';
  const sent = [];
  const service = loadServiceWithTransport({
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: `message-${sent.length}` };
    },
  });
  const enrollment = {
    application_reference: 'HLI-2027-0099',
    parent_email: 'parent@example.com',
    parent_first_name: 'Parent',
    student_first_name: 'Learner',
    student_last_name: 'Example',
    grade_applying: 'grade-5',
    parent_last_name: 'Example',
    created_at: new Date('2026-09-08T12:00:00Z'),
  };

  assert.equal((await service.sendApplicationConfirmation(enrollment)).success, true);
  assert.equal((await service.sendEnrollmentNotification(enrollment)).success, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'parent@example.com');
  assert.equal(sent[0].from.address, 'sender@example.com');
  assert.match(sent[0].subject, /Application Received/);
  assert.match(sent[1].subject, /HLI-2027-0099/);
  assert.doesNotMatch(JSON.stringify(sent), /test app password/);
});

test('approval email uses SMTP and excludes internal Admin notes', async () => {
  process.env.GMAIL_USER = 'sender@example.com';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  let sentMessage;
  const service = loadServiceWithTransport({
    sendMail: async (message) => {
      sentMessage = message;
      return { messageId: 'approval-message' };
    },
  });
  const result = await service.sendAdmissionsStatusEmail({
    application_reference: 'HLI-2027-0099',
    parent_email: 'parent@example.com',
    admin_notes: 'PRIVATE ADMIN NOTE',
  }, 'APPROVED', 'Parent-safe update');

  assert.equal(result.success, true);
  assert.match(sentMessage.subject, /Application Approved/);
  assert.match(sentMessage.html, /Parent-safe update/);
  assert.doesNotMatch(sentMessage.html, /PRIVATE ADMIN NOTE/);
});

test('missing configuration and SMTP failures return sanitized categories', async () => {
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  let service = loadServiceWithTransport({});
  assert.deepEqual(
    await service.sendEmail('parent@example.com', 'Subject', '<p>Body</p>'),
    { success: false, error: 'EMAIL_CONFIGURATION_MISSING' },
  );

  process.env.GMAIL_USER = 'sender@example.com';
  process.env.GMAIL_APP_PASSWORD = 'secret-value';
  service = loadServiceWithTransport({
    sendMail: async () => {
      const error = new Error('Authentication failed using secret-value');
      error.code = 'EAUTH';
      error.responseCode = 535;
      throw error;
    },
  });
  assert.deepEqual(
    await service.sendEmail('parent@example.com', 'Subject', '<p>Body</p>'),
    { success: false, error: 'SMTP_AUTH_FAILED' },
  );
});

test('verification authenticates without sending an email', async () => {
  process.env.GMAIL_USER = 'sender@example.com';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  let verified = 0;
  let sent = 0;
  const service = loadServiceWithTransport({
    verify: async () => { verified += 1; },
    sendMail: async () => { sent += 1; },
  });
  assert.deepEqual(await service.verifyEmailTransport(), { success: true });
  assert.equal(verified, 1);
  assert.equal(sent, 0);
});

const mockResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const loadEnrollmentRouterWithMocks = ({ database, emailService }) => {
  const routePath = require.resolve('../routes/enrollments');
  const dbPath = require.resolve('../config/database');
  const emailPath = require.resolve('../services/gmailService');
  const authPath = require.resolve('../middleware/auth');
  const auditPath = require.resolve('../utils/auditLogger');
  const dependencies = [dbPath, emailPath, authPath, auditPath];
  dependencies.forEach((dependency) => require(dependency));
  const originals = dependencies.map((dependency) => require.cache[dependency].exports);

  require.cache[dbPath].exports = database;
  require.cache[emailPath].exports = emailService;
  require.cache[authPath].exports = { authenticate: (req, res, next) => next() };
  require.cache[auditPath].exports = {
    logAudit: async () => {},
    getIp: () => '127.0.0.1',
  };
  delete require.cache[routePath];
  const router = require(routePath);

  return {
    router,
    restore() {
      delete require.cache[routePath];
      dependencies.forEach((dependency, index) => {
        require.cache[dependency].exports = originals[index];
      });
    },
  };
};

const getFinalRouteHandler = (router, pathName, method) => {
  const layer = router.stack.find((item) => item.route?.path === pathName && item.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${pathName} route`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const createResendDatabase = ({ lockAcquired = true, deliveryStatus = 'failed', enrollmentStatus = 'APPROVED' } = {}) => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (String(sql).includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: lockAcquired }] };
      if (String(sql).includes('SELECT * FROM enrollments')) {
        return {
          rows: [{
            id: 19,
            status: enrollmentStatus,
            application_reference: 'HLI-2027-0019',
            parent_email: 'stored-parent@example.com',
            parent_status_message: 'Stored parent message',
          }],
        };
      }
      if (String(sql).includes('SELECT delivery_status')) return { rows: [{ delivery_status: deliveryStatus }] };
      return { rows: [] };
    },
    release() {},
  };
  return { database: { pool: { connect: async () => client } }, queries };
};

test('resend handler rejects unauthenticated and non-Admin callers', async () => {
  const { createAdmissionsEmailResendHandler } = require('../routes/enrollments');
  const handler = createAdmissionsEmailResendHandler();
  let response = mockResponse();
  await handler({ user: null, body: {}, params: {} }, response);
  assert.equal(response.statusCode, 401);

  response = mockResponse();
  await handler({ user: { role: 'teacher' }, body: {}, params: {} }, response);
  assert.equal(response.statusCode, 403);

  response = mockResponse();
  await handler({
    user: { role: 'admin' },
    body: { emailType: 'application_confirmation' },
    params: { id: 'invalid' },
  }, response);
  assert.equal(response.statusCode, 400);
});

test('resend handler returns a safe server error when database acquisition fails', async () => {
  const { createAdmissionsEmailResendHandler } = require('../routes/enrollments');
  const handler = createAdmissionsEmailResendHandler({
    database: { pool: { connect: async () => { throw new Error('private database failure'); } } },
  });
  const response = mockResponse();
  await handler({
    user: { role: 'admin' },
    body: { emailType: 'application_confirmation' },
    params: { id: '19' },
  }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: 'Failed to resend admissions email' });
});

test('resend handler uses stored recipients and atomically prevents concurrent duplicates', async () => {
  const { createAdmissionsEmailResendHandler } = require('../routes/enrollments');
  let sentEnrollment;
  const available = createResendDatabase();
  const handler = createAdmissionsEmailResendHandler({
    database: available.database,
    sendConfirmation: async (enrollment) => {
      sentEnrollment = enrollment;
      return { success: true, messageId: 'resend-id' };
    },
  });
  const response = mockResponse();
  await handler({
    user: { role: 'admin' },
    params: { id: '19' },
    body: { emailType: 'application_confirmation', recipient: 'attacker@example.com' },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(sentEnrollment.parent_email, 'stored-parent@example.com');
  assert.ok(available.queries.some(({ sql }) => String(sql).includes('pg_try_advisory_xact_lock')));
  assert.ok(available.queries.some(({ sql }) => String(sql).includes('INSERT INTO admissions_email_log')));

  let duplicateSendCount = 0;
  const busy = createResendDatabase({ lockAcquired: false });
  const busyHandler = createAdmissionsEmailResendHandler({
    database: busy.database,
    sendConfirmation: async () => { duplicateSendCount += 1; },
  });
  const busyResponse = mockResponse();
  await busyHandler({
    user: { role: 'admin' },
    params: { id: '19' },
    body: { emailType: 'application_confirmation' },
  }, busyResponse);
  assert.equal(busyResponse.statusCode, 409);
  assert.equal(duplicateSendCount, 0);
});

test('resend failure is safely logged after the failed transport attempt', async () => {
  const { createAdmissionsEmailResendHandler } = require('../routes/enrollments');
  const fixture = createResendDatabase();
  const handler = createAdmissionsEmailResendHandler({
    database: fixture.database,
    sendStatusEmail: async () => ({ success: false, error: 'SMTP_AUTH_FAILED' }),
  });
  const response = mockResponse();
  await handler({
    user: { role: 'super_admin' },
    params: { id: '19' },
    body: { emailType: 'status_approved' },
  }, response);
  assert.equal(response.statusCode, 502);
  const logInsert = fixture.queries.find(({ sql }) => String(sql).includes('INSERT INTO admissions_email_log'));
  assert.ok(logInsert);
  assert.equal(logInsert.params[2], 'failed');
  assert.equal(logInsert.params[4], 'SMTP_AUTH_FAILED');
});

test('application remains persisted when both SMTP deliveries fail', async () => {
  const events = [];
  const enrollment = {
    id: 19,
    application_reference: 'HLI-2027-0019',
    status: 'NEW',
    parent_email: 'stored-parent@example.com',
  };
  const database = {
    pool: { connect: async () => { throw new Error('not used'); } },
    async query(sql) {
      if (String(sql).includes('INSERT INTO enrollments')) {
        events.push('application-persisted');
        return { rows: [enrollment] };
      }
      if (String(sql).includes('INSERT INTO admissions_email_log')) {
        events.push('email-attempt-logged');
        return { rows: [] };
      }
      throw new Error('Unexpected query');
    },
  };
  const emailService = {
    sendApplicationConfirmation: async () => {
      events.push('parent-email-attempted');
      return { success: false, error: 'SMTP_AUTH_FAILED' };
    },
    sendEnrollmentNotification: async () => {
      events.push('admin-email-attempted');
      return { success: false, error: 'SMTP_AUTH_FAILED' };
    },
    sendAdmissionsStatusEmail: async () => ({ success: false, error: 'SMTP_AUTH_FAILED' }),
  };
  const loaded = loadEnrollmentRouterWithMocks({ database, emailService });
  try {
    const handler = getFinalRouteHandler(loaded.router, '/', 'post');
    const response = mockResponse();
    await handler({
      body: {
        parentFirstName: 'Parent',
        parentLastName: 'Example',
        parentEmail: 'stored-parent@example.com',
        parentPhone: '0123456789',
        studentFirstName: 'Learner',
        studentLastName: 'Example',
        studentDateOfBirth: '2015-01-01',
        gradeApplying: 'grade-5',
        boardingOption: false,
      },
    }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.enrollment.id, 19);
    assert.equal(events[0], 'application-persisted');
    assert.equal(events.filter((event) => event.endsWith('email-attempted')).length, 2);
    assert.equal(events.filter((event) => event === 'email-attempt-logged').length, 2);
  } finally {
    loaded.restore();
  }
});

test('approved status remains committed after SMTP failure and duplicate save does not resend', async () => {
  const events = [];
  let storedStatus = 'NEW';
  let statusEmailCalls = 0;
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'ROLLBACK') {
        events.push(text.toLowerCase());
        return { rows: [] };
      }
      if (text === 'COMMIT') {
        events.push('commit');
        return { rows: [] };
      }
      if (text.includes('SELECT * FROM enrollments')) {
        return { rows: [{
          id: 19,
          status: storedStatus,
          application_reference: 'HLI-2027-0019',
          parent_email: 'stored-parent@example.com',
        }] };
      }
      if (text.includes('UPDATE enrollments')) {
        storedStatus = params[0];
        events.push('status-persisted');
        return { rows: [{
          id: 19,
          status: storedStatus,
          application_reference: 'HLI-2027-0019',
          parent_email: 'stored-parent@example.com',
        }] };
      }
      if (text.includes('INSERT INTO enrollment_status_history')) return { rows: [] };
      throw new Error(`Unexpected client query: ${text}`);
    },
    release() {},
  };
  const database = {
    pool: { connect: async () => client },
    async query(sql) {
      if (String(sql).includes('INSERT INTO admissions_email_log')) {
        events.push('email-attempt-logged');
        return { rows: [] };
      }
      throw new Error('Unexpected database query');
    },
  };
  const emailService = {
    sendApplicationConfirmation: async () => ({ success: true }),
    sendEnrollmentNotification: async () => ({ success: true }),
    sendAdmissionsStatusEmail: async () => {
      statusEmailCalls += 1;
      events.push('status-email-attempted');
      return { success: false, error: 'SMTP_AUTH_FAILED' };
    },
  };
  const loaded = loadEnrollmentRouterWithMocks({ database, emailService });
  try {
    const handler = getFinalRouteHandler(loaded.router, '/:id/status', 'put');
    let response = mockResponse();
    const request = {
      user: { id: 1, role: 'admin', email: 'admin@example.com' },
      params: { id: '19' },
      body: { status: 'APPROVED', adminNotes: 'Private', parentMessage: 'Safe' },
    };
    await handler(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.emailSent, false);
    assert.equal(storedStatus, 'APPROVED');
    assert.ok(events.indexOf('commit') < events.indexOf('status-email-attempted'));
    assert.equal(statusEmailCalls, 1);

    response = mockResponse();
    await handler(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.statusChanged, false);
    assert.equal(statusEmailCalls, 1);
  } finally {
    loaded.restore();
  }
});