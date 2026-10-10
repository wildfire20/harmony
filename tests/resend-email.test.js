const test = require('node:test');
const assert = require('node:assert/strict');
const { getResendConfig, sendResendEmail, verifyResendTransport } = require('../services/resendService');
const { sendEmail, verifyEmailTransport } = require('../services/gmailService');
const { sendParentActivationOtp } = require('../services/parentAuth');

const keys = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
  'GOOGLE_GMAIL_CLIENT_ID', 'GOOGLE_GMAIL_CLIENT_SECRET', 'GOOGLE_GMAIL_REFRESH_TOKEN', 'GMAIL_USER'];
const originalEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = global.fetch;
const message = { to: 'parent@example.com', subject: 'Verification', html: '<p>Code</p>',
  text: 'Code', fromName: 'Harmony Learning Institute — powered by AutoM8',
  replyTo: 'harmonylearninginstitute@gmail.com' };
let calls;

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test.beforeEach(() => {
  keys.forEach(key => delete process.env[key]);
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 're_test_private_key';
  process.env.RESEND_FROM_EMAIL = 'portal@school.example';
  calls = [];
  // No test is allowed to reach an external provider.
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return response(200, { id: 'resend-message-id' });
  };
});

test.after(() => {
  global.fetch = originalFetch;
  for (const key of keys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

test('shared service sends through Resend with brand, text, HTML and Harmony reply address', async () => {
  const result = await sendEmail(message.to, message.subject, '<p>Body</p>', { fromName: message.fromName });
  assert.deepEqual(result, { success: true, messageId: 'resend-message-id' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  const { options } = calls[0];
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer re_test_private_key');
  assert.equal(options.headers['User-Agent'], 'harmony-learning-institute/1.0');
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), {
    from: 'Harmony Learning Institute — powered by AutoM8 <portal@school.example>',
    to: ['parent@example.com'], subject: 'Verification', html: '<p>Body</p>', text: 'Body',
    reply_to: 'harmonylearninginstitute@gmail.com',
  });
});

test('real Parent OTP wrapper uses the same Resend transport and preserves its subject', async () => {
  const result = await sendParentActivationOtp('parent@example.com', '123456', 'Parent');
  assert.equal(result.success, true);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.subject, 'Harmony Parent Portal — verification code');
  assert.equal(payload.from, 'Harmony Parent Portal — powered by AutoM8 <portal@school.example>');
  assert.match(payload.html, /123456/);
  assert.match(payload.text, /123456/);
  assert.equal(payload.reply_to, 'harmonylearninginstitute@gmail.com');
});

test('missing or malformed Resend configuration never calls either provider', async () => {
  for (const from of ['', 'Harmony <portal@school.example>', 'portal@school.example\r\nBcc: other@example.com']) {
    process.env.RESEND_FROM_EMAIL = from;
    assert.equal((await sendEmail(message.to, message.subject, message.html)).success, false);
  }
  process.env.RESEND_FROM_EMAIL = 'portal@school.example';
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await sendEmail(message.to, message.subject, message.html),
    { success: false, error: 'EMAIL_CONFIGURATION_MISSING' });
  process.env.EMAIL_PROVIDER = 'unknown';
  assert.deepEqual(await verifyEmailTransport(), { success: false, error: 'EMAIL_CONFIGURATION_MISSING' });
  assert.deepEqual(await sendEmail(message.to, message.subject, message.html),
    { success: false, error: 'EMAIL_CONFIGURATION_MISSING' });
  assert.equal(calls.length, 0);
});

test('Resend errors are sanitized, returned as failures, and never retried or sent through Gmail', async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const failures = [
      [401, 'invalid_api_key', 'EMAIL_AUTH_FAILED'],
      [403, 'validation_error', 'EMAIL_PERMISSION_DENIED'],
      [403, 'invalid_permission', 'EMAIL_PERMISSION_DENIED'],
      [429, 'rate_limit_exceeded', 'EMAIL_RATE_LIMITED'],
      [429, 'daily_quota_exceeded', 'EMAIL_RATE_LIMITED'],
      [500, 'application_error', 'EMAIL_API_FAILED'],
      [422, 'validation_error', 'EMAIL_REJECTED'],
    ];
    for (const [status, name, error] of failures) {
      calls = [];
      global.fetch = async (url, options) => {
        calls.push({ url, options });
        return response(status, { name, message: 'PRIVATE parent@example.com OTP 123456 re_test_private_key' });
      };
      assert.deepEqual(await sendEmail(message.to, message.subject, message.html), { success: false, error });
      assert.equal(calls.length, 1);
    }
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(logged.join('\n'), /PRIVATE|parent@example|123456|re_test_private_key/);
});

test('timeouts, broken JSON, and success responses without a message ID never confirm sending', async () => {
  global.fetch = async () => { throw new DOMException('private response', 'TimeoutError'); };
  assert.deepEqual(await sendResendEmail(message), { success: false, error: 'EMAIL_API_TIMEOUT' });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('private response'); } });
  assert.deepEqual(await sendResendEmail(message), { success: false, error: 'EMAIL_API_FAILED' });
  for (const body of [{}, { id: '' }, null, { id: 2 }]) {
    global.fetch = async () => response(200, body);
    assert.deepEqual(await sendResendEmail(message), { success: false, error: 'EMAIL_API_FAILED' });
  }
});

test('transport verification reads the matching verified domain without sending email', async () => {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return response(200, { data: [{ id: 'domain-1', name: 'school.example', status: 'verified',
      capabilities: { sending: 'enabled' } }], has_more: false });
  };
  assert.deepEqual(await verifyEmailTransport(), { success: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/domains');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
});

test('verification fails for pending, disabled, mismatched and inaccessible sender domains', async () => {
  for (const row of [
    { name: 'school.example', status: 'pending' },
    { name: 'school.example', status: 'verified', capabilities: { sending: 'disabled' } },
    { name: 'different.example', status: 'verified' },
  ]) {
    global.fetch = async () => response(200, { data: [row], has_more: false });
    assert.equal((await verifyResendTransport()).success, false);
  }
  global.fetch = async () => response(401, { name: 'restricted_api_key' });
  assert.deepEqual(await verifyResendTransport(), { success: false, error: 'EMAIL_PERMISSION_DENIED' });
});

test('verification handles paginated domain lists and fails closed on a broken page', async () => {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return response(200, calls.length === 1
      ? { data: [{ id: 'cursor/1', name: 'different.example', status: 'verified' }], has_more: true }
      : { data: [{ id: 'domain-2', name: 'school.example', status: 'verified' }], has_more: false });
  };
  assert.deepEqual(await verifyResendTransport(), { success: true });
  assert.equal(calls[1].url, 'https://api.resend.com/domains?after=cursor%2F1');
  global.fetch = async () => response(200, { has_more: true });
  assert.deepEqual(await verifyResendTransport(), { success: false, error: 'EMAIL_API_FAILED' });
  assert.equal(getResendConfig({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'portal@school.example' }).senderValid, true);
});
