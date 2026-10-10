const API_URL = 'https://api.resend.com';
const TIMEOUT_MS = 30000;

function getResendConfig(environment = process.env) {
  const apiKey = String(environment.RESEND_API_KEY || '').trim();
  const fromEmail = String(environment.RESEND_FROM_EMAIL || '').trim();
  return {
    configured: Boolean(apiKey && fromEmail),
    senderValid: /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(fromEmail),
    apiKey,
    fromEmail,
  };
}

function errorCategory(error) {
  const status = Number(error?.status || 0);
  const name = String(error?.providerName || '');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'EMAIL_API_TIMEOUT';
  if (name === 'restricted_api_key' || name === 'invalid_permission') return 'EMAIL_PERMISSION_DENIED';
  if (status === 401 || name === 'missing_api_key' || name === 'invalid_api_key') return 'EMAIL_AUTH_FAILED';
  if (status === 403) return 'EMAIL_PERMISSION_DENIED';
  if (status === 429 || ['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(name)) return 'EMAIL_RATE_LIMITED';
  if (status >= 500) return 'EMAIL_API_FAILED';
  if ([400, 404, 409, 422].includes(status)) return 'EMAIL_REJECTED';
  return 'UNKNOWN_EMAIL_FAILURE';
}

function configurationError(config) {
  if (!config.configured) return { success: false, error: 'EMAIL_CONFIGURATION_MISSING' };
  if (!config.senderValid) return { success: false, error: 'EMAIL_SENDER_MISMATCH' };
  return null;
}

async function request(config, pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'harmony-learning-institute/1.0',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Keep credentials on the fixed Resend HTTPS origin.
    redirect: 'error',
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw Object.assign(new Error('Invalid email API response'), { status: response.ok ? 502 : response.status });
  }
  if (!response.ok) {
    // Do not retain or log the provider's raw response, which may contain recipients.
    throw Object.assign(new Error('Email API request failed'), {
      status: response.status, providerName: body?.name,
    });
  }
  return body;
}

async function sendResendEmail(message, environment = process.env) {
  const config = getResendConfig(environment);
  const invalid = configurationError(config);
  if (invalid) return invalid;
  try {
    const result = await request(config, '/emails', {
      method: 'POST',
      body: JSON.stringify({
        from: `${String(message.fromName).replace(/[\r\n<>]+/g, ' ').trim()} <${config.fromEmail}>`,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
      }),
    });
    if (typeof result?.id !== 'string' || !result.id.trim()) {
      return { success: false, error: 'EMAIL_API_FAILED' };
    }
    // This confirms acceptance by Resend, not delivery to a recipient's inbox.
    return { success: true, messageId: result.id };
  } catch (error) {
    return { success: false, error: errorCategory(error) };
  }
}

async function verifyResendTransport(environment = process.env) {
  const config = getResendConfig(environment);
  const invalid = configurationError(config);
  if (invalid) return invalid;
  const fromDomain = config.fromEmail.split('@')[1].toLowerCase();
  let after;
  const seenCursors = new Set();
  try {
    do {
      const suffix = after ? `?after=${encodeURIComponent(after)}` : '';
      const result = await request(config, `/domains${suffix}`, { method: 'GET' });
      if (!Array.isArray(result?.data)) return { success: false, error: 'EMAIL_API_FAILED' };
      const domain = result.data.find(row => String(row.name).toLowerCase() === fromDomain);
      if (domain) {
        return domain.status === 'verified' && domain.capabilities?.sending !== 'disabled'
          ? { success: true }
          : { success: false, error: 'EMAIL_PERMISSION_DENIED' };
      }
      if (!result.has_more) break;
      after = result.data.at(-1)?.id;
      if (!after || seenCursors.has(after)) return { success: false, error: 'EMAIL_API_FAILED' };
      seenCursors.add(after);
    } while (true);
    return { success: false, error: 'EMAIL_SENDER_MISMATCH' };
  } catch (error) {
    // A sending-only key cannot list domains. Never report it as fully verified.
    return { success: false, error: errorCategory(error) };
  }
}

module.exports = { getResendConfig, sendResendEmail, verifyResendTransport };
