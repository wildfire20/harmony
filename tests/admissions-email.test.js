const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const gmailEnvironmentKeys = [
  'GOOGLE_GMAIL_CLIENT_ID',
  'GOOGLE_GMAIL_CLIENT_SECRET',
  'GOOGLE_GMAIL_REFRESH_TOKEN',
  'GMAIL_USER',
];
const originalGmailEnvironment = Object.fromEntries(
  gmailEnvironmentKeys.map((key) => [key, process.env[key]]),
);

const configureGmailEnvironment = () => {
  process.env.GOOGLE_GMAIL_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_GMAIL_REFRESH_TOKEN = 'test-refresh-token';
  process.env.GMAIL_USER = 'autom8streamlining@gmail.com';
};

const loadServiceWithGoogle = ({ send, getAccessToken, getTokenInfo }) => {
  const googlePath = require.resolve('googleapis');
  const servicePath = require.resolve('../services/gmailService');
  require(googlePath);
  class OAuth2 {
    setCredentials(credentials) {
      this.credentials = credentials;
    }
    async getAccessToken() {
      return getAccessToken ? getAccessToken() : { token: 'test-access-token' };
    }
    async getTokenInfo(token) {
      return getTokenInfo
        ? getTokenInfo(token)
        : { scopes: ['https://www.googleapis.com/auth/gmail.send'] };
    }
  }
  require.cache[googlePath].exports = {
    google: {
      auth: { OAuth2 },
      gmail: () => ({
        users: {
          messages: {
            send: send || (async () => ({ data: { id: 'gmail-message-id' } })),
          },
        },
      }),
    },
  };
  delete require.cache[servicePath];
  return require(servicePath);
};

const decodeMimePart = (rawMessage, contentType) => {
  const escapedType = contentType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rawMessage.match(new RegExp(
    `Content-Type: ${escapedType}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([^\\r\\n]+)`,
  ));
  assert.ok(match, `Expected ${contentType} MIME part`);
  return Buffer.from(match[1], 'base64').toString('utf8');
};

test.afterEach(() => {
  gmailEnvironmentKeys.forEach((key) => {
    if (originalGmailEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalGmailEnvironment[key];
  });
  delete require.cache[require.resolve('../services/gmailService')];
  delete require.cache[require.resolve('googleapis')];
});

test('application and Admin confirmations use Gmail API with required sender headers', async () => {
  configureGmailEnvironment();
  const sent = [];
  const service = loadServiceWithGoogle({
    send: async (request, options) => {
      sent.push({ request, options });
      return { data: { id: `message-${sent.length}` } };
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
  assert.equal(sent[0].request.userId, 'me');
  assert.equal(sent[0].options.timeout, 30000);
  const firstMessage = Buffer.from(sent[0].request.requestBody.raw, 'base64url').toString('utf8');
  const secondMessage = Buffer.from(sent[1].request.requestBody.raw, 'base64url').toString('utf8');
  const encodedSenderName = Buffer.from(
    'Harmony Learning Institute Admissions — powered by AutoM8',
    'utf8',
  ).toString('base64');
  assert.match(firstMessage, new RegExp(`From: =\\?UTF-8\\?B\\?${encodedSenderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?= <autom8streamlining@gmail\\.com>`));
  assert.match(firstMessage, /Reply-To: harmonylearninginstitute@gmail\.com/);
  assert.match(firstMessage, /To: parent@example\.com/);
  assert.match(secondMessage, /To: harmonylearninginstitute@gmail\.com/);
  assert.match(decodeMimePart(firstMessage, 'text/html'), /href="https:\/\/www\.auto-m8\.co\.za\/"/);
  assert.match(decodeMimePart(firstMessage, 'text/plain'), /Powered by AutoM8 — https:\/\/www\.auto-m8\.co\.za\//);
  assert.doesNotMatch(JSON.stringify(sent), /test-client-secret|test-refresh-token/);
});

test('approval email uses Gmail API and excludes internal Admin notes', async () => {
  configureGmailEnvironment();
  let rawMessage;
  const service = loadServiceWithGoogle({
    send: async (request) => {
      rawMessage = Buffer.from(request.requestBody.raw, 'base64url').toString('utf8');
      return { data: { id: 'approval-message' } };
    },
  });
  const result = await service.sendAdmissionsStatusEmail({
    application_reference: 'HLI-2027-0099',
    parent_email: 'parent@example.com',
    admin_notes: 'PRIVATE ADMIN NOTE',
  }, 'APPROVED', 'Parent-safe update');

  assert.equal(result.success, true);
  const html = decodeMimePart(rawMessage, 'text/html');
  assert.match(html, /Parent-safe update/);
  assert.doesNotMatch(html, /PRIVATE ADMIN NOTE/);
});

test('More Information Required offers online or in-person document submission', async () => {
  configureGmailEnvironment();
  let rawMessage;
  const service = loadServiceWithGoogle({
    send: async (request) => {
      rawMessage = Buffer.from(request.requestBody.raw, 'base64url').toString('utf8');
      return { data: { id: 'information-message' } };
    },
  });
  const result = await service.sendAdmissionsStatusEmail({
    application_reference: 'HLI-2027-0099',
    parent_email: 'parent@example.com',
  }, 'MORE_INFORMATION_REQUIRED', 'Please bring the latest report.');
  assert.equal(result.success, true);
  const html = decodeMimePart(rawMessage, 'text/html');
  const text = decodeMimePart(rawMessage, 'text/plain');
  for (const body of [html, text]) {
    assert.match(body, /not comfortable submitting documents online/i);
    assert.match(body, /2 Skilferdoring Street/);
    assert.match(body, /Onverwacht, Lephalale/);
  }
});

test('missing configuration and Gmail API failures return sanitized categories', async () => {
  gmailEnvironmentKeys.forEach((key) => delete process.env[key]);
  let service = loadServiceWithGoogle({});
  assert.deepEqual(
    await service.sendEmail('parent@example.com', 'Subject', '<p>Body</p>'),
    { success: false, error: 'EMAIL_CONFIGURATION_MISSING' },
  );

  configureGmailEnvironment();
  service = loadServiceWithGoogle({
    send: async () => {
      const error = new Error('Request failed without credential details');
      error.response = { status: 401, data: { error: { status: 'UNAUTHENTICATED' } } };
      throw error;
    },
  });
  assert.deepEqual(
    await service.sendEmail('parent@example.com', 'Subject', '<p>Body</p>'),
    { success: false, error: 'EMAIL_AUTH_FAILED' },
  );
});

test('verification obtains and validates a scoped OAuth token without sending an email', async () => {
  configureGmailEnvironment();
  let tokenRequests = 0;
  let tokenInfoRequests = 0;
  let sent = 0;
  const service = loadServiceWithGoogle({
    getAccessToken: async () => {
      tokenRequests += 1;
      return { token: 'access-token' };
    },
    getTokenInfo: async (token) => {
      tokenInfoRequests += 1;
      assert.equal(token, 'access-token');
      return { scopes: ['https://www.googleapis.com/auth/gmail.send'] };
    },
    send: async () => {
      sent += 1;
      return { data: { id: 'unexpected' } };
    },
  });
  assert.deepEqual(await service.verifyEmailTransport(), { success: true });
  assert.equal(tokenRequests, 1);
  assert.equal(tokenInfoRequests, 1);
  assert.equal(sent, 0);
});

test('verification rejects OAuth tokens without the gmail.send scope', async () => {
  configureGmailEnvironment();
  const service = loadServiceWithGoogle({
    getTokenInfo: async () => ({ scopes: ['openid'] }),
  });
  assert.deepEqual(
    await service.verifyEmailTransport(),
    { success: false, error: 'EMAIL_PERMISSION_DENIED' },
  );
});

test('verification rejects over-scoped OAuth tokens and a mismatched sender', async () => {
  configureGmailEnvironment();
  let service = loadServiceWithGoogle({
    getTokenInfo: async () => ({
      scopes: ['https://www.googleapis.com/auth/gmail.send', 'openid'],
    }),
  });
  assert.deepEqual(
    await service.verifyEmailTransport(),
    { success: false, error: 'EMAIL_PERMISSION_DENIED' },
  );

  process.env.GMAIL_USER = 'different-sender@example.com';
  service = loadServiceWithGoogle({});
  assert.deepEqual(
    await service.verifyEmailTransport(),
    { success: false, error: 'EMAIL_SENDER_MISMATCH' },
  );
  assert.deepEqual(
    await service.sendEmail('parent@example.com', 'Subject', '<p>Body</p>'),
    { success: false, error: 'EMAIL_SENDER_MISMATCH' },
  );
});

test('all supported and legacy admissions outcomes produce an email template', () => {
  const service = loadServiceWithGoogle({});
  for (const status of [
    'UNDER_REVIEW',
    'MORE_INFORMATION_REQUIRED',
    'APPROVED',
    'approved',
    'waitlisted',
    'REGISTRATION_PENDING',
    'REGISTERED',
    'NOT_ACCEPTED',
    'rejected',
  ]) {
    assert.ok(service.statusEmailContent(status, 'HLI-2027-0099', 'Update'), status);
  }
});

test('raw rejected promise details are never persisted to the admissions email log', async () => {
  const loggedErrors = [];
  const enrollment = {
    id: 20,
    application_reference: 'HLI-2027-0020',
    status: 'NEW',
  };
  const database = {
    async query(sql, params) {
      if (String(sql).includes('INSERT INTO enrollments')) return { rows: [enrollment] };
      if (String(sql).includes('INSERT INTO admissions_email_log')) {
        loggedErrors.push(params[4]);
        return { rows: [] };
      }
      throw new Error('Unexpected query');
    },
    pool: { connect: async () => { throw new Error('not used'); } },
  };
  const emailService = {
    sendApplicationConfirmation: async () => { throw new Error('private provider response'); },
    sendEnrollmentNotification: async () => { throw new Error('another private response'); },
    sendAdmissionsStatusEmail: async () => ({ success: true }),
    EMAIL_ERROR_CATEGORIES: {
      UNKNOWN: 'UNKNOWN_EMAIL_FAILURE',
    },
    normalizeEmailResult: (result) => result?.success
      ? result
      : { success: false, error: 'UNKNOWN_EMAIL_FAILURE' },
  };
  const loaded = loadEnrollmentRouterWithMocks({ database, emailService });
  try {
    const handler = getFinalRouteHandler(loaded.router, '/', 'post');
    const response = mockResponse();
    await handler({
      body: {
        parentFirstName: 'Parent',
        parentLastName: 'Example',
        parentEmail: 'parent@example.com',
        parentPhone: '0123456789',
        studentFirstName: 'Learner',
        studentLastName: 'Example',
        studentDateOfBirth: '2015-01-01',
        gradeApplying: 'grade-5',
      },
    }, response);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(loggedErrors, ['UNKNOWN_EMAIL_FAILURE', 'UNKNOWN_EMAIL_FAILURE']);
  } finally {
    loaded.restore();
  }
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
  require.cache[emailPath].exports = {
    EMAIL_ERROR_CATEGORIES: { UNKNOWN: 'UNKNOWN_EMAIL_FAILURE' },
    normalizeEmailResult: (result) => {
      if (result?.success) return result;
      const allowed = new Set([
        'EMAIL_AUTH_FAILED',
        'EMAIL_PERMISSION_DENIED',
        'EMAIL_API_FAILED',
        'EMAIL_API_TIMEOUT',
        'EMAIL_RATE_LIMITED',
        'EMAIL_REJECTED',
        'EMAIL_SENDER_MISMATCH',
        'EMAIL_CONFIGURATION_MISSING',
        'UNKNOWN_EMAIL_FAILURE',
      ]);
      return {
        success: false,
        error: allowed.has(result?.error) ? result.error : 'UNKNOWN_EMAIL_FAILURE',
      };
    },
    ...emailService,
  };
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

test('secure status resend directs Admin to portal reissue', async () => {
  const { createAdmissionsEmailResendHandler } = require('../routes/enrollments');
  const fixture = createResendDatabase();
  const handler = createAdmissionsEmailResendHandler({
    database: fixture.database,
    sendStatusEmail: async () => ({ success: false, error: 'EMAIL_AUTH_FAILED' }),
  });
  const response = mockResponse();
  await handler({
    user: { role: 'super_admin' },
    params: { id: '19' },
    body: { emailType: 'status_approved' },
  }, response);
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /portal-link reissue/i);
  assert.equal(fixture.queries.length, 0);
});

test('secure status resend never invokes the transport directly', async () => {
  const { createAdmissionsEmailResendHandler } = require('../routes/enrollments');
  const fixture = createResendDatabase();
  const handler = createAdmissionsEmailResendHandler({
    database: fixture.database,
    sendStatusEmail: async () => {
      throw new Error('private provider response with credential details');
    },
  });
  const response = mockResponse();
  await handler({
    user: { role: 'admin' },
    params: { id: '19' },
    body: { emailType: 'status_approved' },
  }, response);
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /portal-link reissue/i);
  assert.equal(fixture.queries.length, 0);
});

test('application remains persisted when both Gmail API deliveries fail', async () => {
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
      return { success: false, error: 'EMAIL_AUTH_FAILED' };
    },
    sendEnrollmentNotification: async () => {
      events.push('admin-email-attempted');
      return { success: false, error: 'EMAIL_AUTH_FAILED' };
    },
    sendAdmissionsStatusEmail: async () => ({ success: false, error: 'EMAIL_AUTH_FAILED' }),
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

test('approved status remains committed after Gmail API failure and duplicate save does not resend', async () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://www.harmonylearning.co.za';
  const events = [];
  let storedStatus = 'NEW';
  let statusEmailCalls = 0;
  const attemptedStatuses = [];
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
      if (text.includes('SELECT id FROM enrollments')) return { rows: [{ id: 19 }] };
      if (text.includes('SELECT e.status, rr.form_status')) {
        return { rows: [{ status: storedStatus, form_status: null }] };
      }
      if (text.includes('SELECT id FROM admissions_portal_tokens')) return { rows: [] };
      if (text.includes('INSERT INTO admissions_portal_tokens')) {
        return { rows: [{
          id: 1, enrollment_id: 19, purpose: 'COMPLETE_REGISTRATION',
          issued_at: new Date(), expires_at: new Date(Date.now() + 86400000),
        }] };
      }
      if (text.includes('UPDATE admissions_portal_tokens')) return { rows: [] };
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
    sendAdmissionsStatusEmail: async (enrollment, status) => {
      statusEmailCalls += 1;
      attemptedStatuses.push(status);
      events.push('status-email-attempted');
      return { success: false, error: 'EMAIL_AUTH_FAILED' };
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

    response = mockResponse();
    await handler({ ...request, body: { ...request.body, status: 'waitlisted' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(storedStatus, 'waitlisted');
    assert.equal(statusEmailCalls, 2);
    assert.deepEqual(attemptedStatuses, ['APPROVED', 'waitlisted']);

    response = mockResponse();
    await handler({
      ...request,
      body: { ...request.body, status: 'MORE_INFORMATION_REQUIRED' },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(storedStatus, 'waitlisted');
    assert.equal(statusEmailCalls, 2);
    assert.deepEqual(attemptedStatuses, ['APPROVED', 'waitlisted']);
  } finally {
    loaded.restore();
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});