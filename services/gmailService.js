const { google } = require('googleapis');
const { STATUS_LABELS } = require('../utils/admissions');

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const REQUIRED_SENDER_ADDRESS = 'autom8streamlining@gmail.com';
const SENDER_NAME = 'Harmony Learning Institute Admissions — powered by AutoM8';
const REPLY_TO = 'harmonylearninginstitute@gmail.com';

const EMAIL_ERROR_CATEGORIES = Object.freeze({
  AUTH: 'EMAIL_AUTH_FAILED',
  PERMISSION: 'EMAIL_PERMISSION_DENIED',
  API: 'EMAIL_API_FAILED',
  TIMEOUT: 'EMAIL_API_TIMEOUT',
  RATE_LIMITED: 'EMAIL_RATE_LIMITED',
  REJECTED: 'EMAIL_REJECTED',
  SENDER: 'EMAIL_SENDER_MISMATCH',
  CONFIGURATION: 'EMAIL_CONFIGURATION_MISSING',
  UNKNOWN: 'UNKNOWN_EMAIL_FAILURE',
});
const SAFE_EMAIL_ERRORS = new Set(Object.values(EMAIL_ERROR_CATEGORIES));

const getGmailApiConfig = (environment = process.env) => {
  const clientId = String(environment.GOOGLE_GMAIL_CLIENT_ID || '').trim();
  const clientSecret = String(environment.GOOGLE_GMAIL_CLIENT_SECRET || '').trim();
  const refreshToken = String(environment.GOOGLE_GMAIL_REFRESH_TOKEN || '').trim();
  const user = String(environment.GMAIL_USER || '').trim();
  return {
    configured: Boolean(clientId && clientSecret && refreshToken && user),
    senderValid: user === REQUIRED_SENDER_ADDRESS,
    clientId,
    clientSecret,
    refreshToken,
    user,
  };
};

const sanitizeEmailError = (error) => {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const statusCode = Number(error?.response?.status || error?.status || error?.code || 0);
  const providerStatus = String(error?.response?.data?.error?.status || '').toUpperCase();
  const providerError = String(
    error?.response?.data?.error
    || error?.response?.data?.error_description
    || error?.message
    || '',
  ).toLowerCase();
  if (statusCode === 401 || providerStatus === 'UNAUTHENTICATED' || providerError.includes('invalid_grant')) {
    return EMAIL_ERROR_CATEGORIES.AUTH;
  }
  if (statusCode === 403 || providerStatus === 'PERMISSION_DENIED') {
    return EMAIL_ERROR_CATEGORIES.PERMISSION;
  }
  if (statusCode === 429 || providerStatus === 'RESOURCE_EXHAUSTED') {
    return EMAIL_ERROR_CATEGORIES.RATE_LIMITED;
  }
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT' || code === 'ECONNABORTED') {
    return EMAIL_ERROR_CATEGORIES.TIMEOUT;
  }
  if (statusCode >= 500) {
    return EMAIL_ERROR_CATEGORIES.API;
  }
  if (statusCode === 400 || providerStatus === 'INVALID_ARGUMENT') {
    return EMAIL_ERROR_CATEGORIES.REJECTED;
  }
  return EMAIL_ERROR_CATEGORIES.UNKNOWN;
};

const normalizeEmailResult = (result) => {
  if (result?.success) {
    return {
      success: true,
      ...(result.skipped ? { skipped: true } : {}),
      ...(result.messageId ? { messageId: String(result.messageId) } : {}),
    };
  }
  const error = SAFE_EMAIL_ERRORS.has(result?.error)
    ? result.error
    : EMAIL_ERROR_CATEGORIES.UNKNOWN;
  return { success: false, error };
};

const createGmailOAuthClient = (environment = process.env) => {
  const config = getGmailApiConfig(environment);
  if (!config.configured) return null;
  const oauthClient = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauthClient.setCredentials({
    refresh_token: config.refreshToken,
  });
  return oauthClient;
};

const createGmailApiClient = (environment = process.env) => {
  const auth = createGmailOAuthClient(environment);
  return auth ? google.gmail({ version: 'v1', auth }) : null;
};

const logEmailTransportStatus = () => {
  const config = getGmailApiConfig();
  if (config.configured && config.senderValid) {
    console.log('Admissions email transport: Gmail API OAuth configured');
  } else if (config.configured) {
    console.warn(`Admissions email transport: unavailable — ${EMAIL_ERROR_CATEGORIES.SENDER}`);
  } else {
    console.warn('Admissions email transport: unavailable — missing Gmail API OAuth configuration');
  }
};

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const sanitizeHeader = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(sanitizeHeader(value), 'utf8').toString('base64')}?=`;
const htmlToPlainText = (html) => String(html || '')
  .replace(/<a\b[^>]*href=["']https:\/\/www\.auto-m8\.co\.za\/?["'][^>]*>Powered by AutoM8<\/a>/gi, 'Powered by AutoM8 — https://www.auto-m8.co.za/')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|h1|h2|li)>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#039;/gi, "'")
  .replace(/\n[ \t]+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const createRawMessage = ({ to, subject, htmlBody, fromAddress }) => {
  const safeTo = sanitizeHeader(to);
  const safeFromAddress = sanitizeHeader(fromAddress);
  if (!safeTo || !safeFromAddress) throw Object.assign(new Error('Invalid email envelope'), { status: 400 });
  const boundary = 'harmony-admissions-alternative';
  const textBody = htmlToPlainText(htmlBody);
  const mimeMessage = [
    `From: ${encodeHeader(SENDER_NAME)} <${safeFromAddress}>`,
    `To: ${safeTo}`,
    `Reply-To: ${REPLY_TO}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(textBody, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(htmlBody || ''), 'utf8').toString('base64'),
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(mimeMessage, 'utf8').toString('base64url');
};

async function sendEmail(to, subject, htmlBody) {
  const config = getGmailApiConfig();
  if (!config.configured) {
    console.error(`Admissions email failed: ${EMAIL_ERROR_CATEGORIES.CONFIGURATION}`);
    return { success: false, error: EMAIL_ERROR_CATEGORIES.CONFIGURATION };
  }
  if (!config.senderValid) {
    console.error(`Admissions email failed: ${EMAIL_ERROR_CATEGORIES.SENDER}`);
    return { success: false, error: EMAIL_ERROR_CATEGORIES.SENDER };
  }

  try {
    const gmail = createGmailApiClient();
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: createRawMessage({
          to,
          subject,
          htmlBody,
          fromAddress: config.user,
        }),
      },
    }, { timeout: 30000 });
    return { success: true, messageId: result.data.id };
  } catch (error) {
    const category = sanitizeEmailError(error);
    console.error(`Admissions email failed: ${category}`);
    return { success: false, error: category };
  }
}

async function verifyEmailTransport() {
  const config = getGmailApiConfig();
  if (!config.configured) {
    return { success: false, error: EMAIL_ERROR_CATEGORIES.CONFIGURATION };
  }
  if (!config.senderValid) {
    return { success: false, error: EMAIL_ERROR_CATEGORIES.SENDER };
  }
  try {
    const oauthClient = createGmailOAuthClient();
    const accessTokenResult = await oauthClient.getAccessToken();
    const accessToken = typeof accessTokenResult === 'string' ? accessTokenResult : accessTokenResult?.token;
    if (!accessToken) return { success: false, error: EMAIL_ERROR_CATEGORIES.AUTH };
    const tokenInfo = await oauthClient.getTokenInfo(accessToken);
    const scopes = [...new Set(tokenInfo.scopes || [])];
    if (scopes.length !== 1 || scopes[0] !== GMAIL_SEND_SCOPE) {
      return { success: false, error: EMAIL_ERROR_CATEGORIES.PERMISSION };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeEmailError(error) };
  }
}

const emailShell = (title, content) => `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#172554">
<div style="max-width:620px;margin:0 auto;padding:24px">
<div style="background:#172554;color:#fff;padding:22px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:22px">${escapeHtml(title)}</h1></div>
<div style="background:#fff;border:1px solid #e2e8f0;padding:24px;line-height:1.65">${content}</div>
<div style="background:#b91c1c;color:#fff;padding:14px;text-align:center">Harmony Learning Institute</div>
<div style="padding:10px;text-align:center;color:#64748b;font-size:11px;border-radius:0 0 12px 12px"><a href="https://www.auto-m8.co.za/" style="color:#64748b;text-decoration:none">Powered by AutoM8</a></div>
</div></body></html>`;

async function sendApplicationConfirmation(enrollment) {
  const ref = escapeHtml(enrollment.application_reference);
  return sendEmail(
    enrollment.parent_email,
    'Harmony Learning Institute — Application Received',
    emailShell('Application received', `
      <p>Dear ${escapeHtml(enrollment.parent_first_name)},</p>
      <p>Thank you for applying to Harmony Learning Institute for the 2027 academic year.</p>
      <p>We have successfully received your application.</p>
      <p><strong>Application Reference:</strong><br><span style="font-size:20px">${ref}</span></p>
      <p>Our admissions team will review the application and contact you regarding the next steps.</p>
      <p>Please keep your application reference for future communication.</p>
    `),
  );
}

async function sendEnrollmentNotification(enrollment) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'harmonylearninginstitute@gmail.com';
  const ref = escapeHtml(enrollment.application_reference);
  return sendEmail(
    adminEmail,
    `New Harmony Application — ${ref}`,
    emailShell('New admissions application', `
      <p><strong>Reference:</strong> ${ref}</p>
      <p><strong>Learner:</strong> ${escapeHtml(enrollment.student_first_name)} ${escapeHtml(enrollment.student_last_name)}</p>
      <p><strong>Grade/programme:</strong> ${escapeHtml(enrollment.grade_applying)}</p>
      <p><strong>Parent/guardian:</strong> ${escapeHtml(enrollment.parent_first_name)} ${escapeHtml(enrollment.parent_last_name)}</p>
      <p><strong>Submitted:</strong> ${escapeHtml(new Date(enrollment.created_at).toLocaleString('en-ZA'))}</p>
      <p>Please sign in to the Harmony Admin portal to review the application.</p>
    `),
  );
}

const statusEmailContent = (status, reference, parentMessage, secureLink = null) => {
  const safeRef = escapeHtml(reference);
  const safeMessage = parentMessage ? `<p><strong>Message from Admissions:</strong> ${escapeHtml(parentMessage)}</p>` : '';
  const linkButton = secureLink
    ? `<p style="text-align:center;margin:28px 0"><a href="${escapeHtml(secureLink)}" style="display:inline-block;background:#b91c1c;color:#fff;padding:14px 24px;border-radius:7px;text-decoration:none;font-weight:bold">${status === 'APPROVED' || status === 'approved' ? 'Complete Registration' : 'Update Application'}</a></p><p><strong>Secure link:</strong><br>${escapeHtml(secureLink)}</p>`
    : '';
  const content = {
    UNDER_REVIEW: ['Harmony Application Update', 'Your application is currently being reviewed by our admissions team.'],
    MORE_INFORMATION_REQUIRED: ['Additional Information Required', `Harmony requires additional information before the application can proceed.<br><br>You may provide the requested supporting information online if you are comfortable doing so. If you are not comfortable submitting documents online, you are welcome to bring the required documents to Harmony Learning Institute in person.<br><br><strong>Harmony Learning Institute</strong><br>2 Skilferdoring Street<br>Onverwacht, Lephalale${linkButton}`],
    APPROVED: ['Application Approved — Harmony Learning Institute', `We are pleased to inform you that the application referenced ${safeRef} has been approved.<br><br>The next step is to complete the registration process. Further registration instructions will be provided through the secure Harmony registration process.${linkButton}`],
    approved: ['Application Approved — Harmony Learning Institute', `We are pleased to inform you that the application referenced ${safeRef} has been approved.<br><br>The next step is to complete the registration process. Further registration instructions will be provided through the secure Harmony registration process.${linkButton}`],
    waitlisted: ['Harmony Application Waitlist Update', 'The application has been placed on the waiting list. Our admissions team will contact you if placement becomes available.'],
    REGISTRATION_PENDING: ['Harmony Registration Update', 'Your approved application is now awaiting completion of the registration process.'],
    REGISTERED: ['Welcome to Harmony Learning Institute', 'Registration has been completed. Welcome to Harmony Learning Institute.'],
    NOT_ACCEPTED: ['Harmony Application Update', 'Thank you for your interest in Harmony Learning Institute. We are unable to offer placement for this application at this time.'],
    rejected: ['Harmony Application Update', 'Thank you for your interest in Harmony Learning Institute. We are unable to offer placement for this application at this time.'],
  }[status];
  if (!content) return null;
  return {
    subject: `${content[0]} — ${reference}`,
    html: emailShell(STATUS_LABELS[status], `<p>Application Reference: <strong>${safeRef}</strong></p><p>${content[1]}</p>${safeMessage}`),
  };
};

async function sendAdmissionsStatusEmail(enrollment, status, parentMessage, secureLink = null) {
  const content = statusEmailContent(status, enrollment.application_reference, parentMessage, secureLink);
  if (!content) return { success: true, skipped: true };
  return sendEmail(enrollment.parent_email, content.subject, content.html);
}

module.exports = {
  GMAIL_SEND_SCOPE,
  REQUIRED_SENDER_ADDRESS,
  EMAIL_ERROR_CATEGORIES,
  createGmailApiClient,
  createGmailOAuthClient,
  createRawMessage,
  getGmailApiConfig,
  htmlToPlainText,
  logEmailTransportStatus,
  normalizeEmailResult,
  sanitizeEmailError,
  sendEmail,
  sendEnrollmentNotification,
  sendApplicationConfirmation,
  sendAdmissionsStatusEmail,
  statusEmailContent,
  escapeHtml,
  verifyEmailTransport,
};