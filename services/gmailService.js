// Gmail service — uses @replit/connectors-sdk proxy (google-mail integration).
const { ReplitConnectors } = require('@replit/connectors-sdk');
const { STATUS_LABELS } = require('../utils/admissions');

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

function createEmailMessage(to, subject, htmlBody) {
  const message = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    htmlBody,
  ].join('\n');

  return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail(to, subject, htmlBody) {
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy('google-mail', '/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: createEmailMessage(to, subject, htmlBody) }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Gmail API error:', data?.error?.message || 'Gmail API error');
      return { success: false, error: data?.error?.message || 'Gmail API error' };
    }
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('Error sending email:', error.message);
    return { success: false, error: error.message };
  }
}

const emailShell = (title, content) => `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#172554">
<div style="max-width:620px;margin:0 auto;padding:24px">
<div style="background:#172554;color:#fff;padding:22px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:22px">${escapeHtml(title)}</h1></div>
<div style="background:#fff;border:1px solid #e2e8f0;padding:24px;line-height:1.65">${content}</div>
<div style="background:#b91c1c;color:#fff;padding:14px;text-align:center;border-radius:0 0 12px 12px">Harmony Learning Institute</div>
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

const statusEmailContent = (status, reference, parentMessage) => {
  const safeRef = escapeHtml(reference);
  const safeMessage = parentMessage ? `<p><strong>Message from Admissions:</strong> ${escapeHtml(parentMessage)}</p>` : '';
  const content = {
    UNDER_REVIEW: ['Harmony Application Update', 'Your application is currently being reviewed by our admissions team.'],
    MORE_INFORMATION_REQUIRED: ['Additional Information Required', 'Harmony requires additional information before the application can proceed.'],
    APPROVED: ['Application Approved — Harmony Learning Institute', `We are pleased to inform you that the application referenced ${safeRef} has been approved.<br><br>The next step is to complete the registration process. Further registration instructions will be provided through the secure Harmony registration process.`],
    REGISTRATION_PENDING: ['Harmony Registration Update', 'Your approved application is now awaiting completion of the registration process.'],
    REGISTERED: ['Welcome to Harmony Learning Institute', 'Registration has been completed. Welcome to Harmony Learning Institute.'],
    NOT_ACCEPTED: ['Harmony Application Update', 'Thank you for your interest in Harmony Learning Institute. We are unable to offer placement for this application at this time.'],
  }[status];
  if (!content) return null;
  return {
    subject: `${content[0]} — ${reference}`,
    html: emailShell(STATUS_LABELS[status], `<p>Application Reference: <strong>${safeRef}</strong></p><p>${content[1]}</p>${safeMessage}`),
  };
};

async function sendAdmissionsStatusEmail(enrollment, status, parentMessage) {
  const content = statusEmailContent(status, enrollment.application_reference, parentMessage);
  if (!content) return { success: true, skipped: true };
  return sendEmail(enrollment.parent_email, content.subject, content.html);
}

module.exports = {
  sendEmail,
  sendEnrollmentNotification,
  sendApplicationConfirmation,
  sendAdmissionsStatusEmail,
  statusEmailContent,
  escapeHtml,
};