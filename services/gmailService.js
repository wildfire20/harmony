// Gmail service — uses @replit/connectors-sdk proxy (google-mail integration)
// The SDK handles OAuth2 token refresh and auth headers automatically.
const { ReplitConnectors } = require('@replit/connectors-sdk');

function createEmailMessage(to, subject, htmlBody) {
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    htmlBody
  ];

  const message = messageParts.join('\n');
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendEmail(to, subject, htmlBody) {
  try {
    // Never cache the connectors instance — tokens expire
    const connectors = new ReplitConnectors();
    const encodedMessage = createEmailMessage(to, subject, htmlBody);

    const response = await connectors.proxy(
      'google-mail',
      '/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodedMessage })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gmail API error:', JSON.stringify(data));
      return { success: false, error: data?.error?.message || 'Gmail API error' };
    }

    console.log('✅ Email sent successfully, message ID:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('Error sending email:', error.message);
    return { success: false, error: error.message };
  }
}

async function sendEnrollmentNotification(enrollmentData) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'harmonylearninginstitute@gmail.com';

  const subject = `New Enrollment Application - ${enrollmentData.student_first_name} ${enrollmentData.student_last_name}`;

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc2626, #1e40af); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; border-bottom: 2px solid #dc2626; padding-bottom: 5px; }
        .field { margin: 8px 0; }
        .label { font-weight: bold; color: #6b7280; }
        .value { color: #111827; }
        .footer { background: #1e40af; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>New Enrollment Application</h1>
          <p>Harmony Learning Institute</p>
        </div>

        <div class="content">
          <div class="section">
            <div class="section-title">Student Information</div>
            <div class="field"><span class="label">Name:</span> <span class="value">${enrollmentData.student_first_name} ${enrollmentData.student_last_name}</span></div>
            <div class="field"><span class="label">Date of Birth:</span> <span class="value">${new Date(enrollmentData.student_date_of_birth).toLocaleDateString('en-ZA')}</span></div>
            <div class="field"><span class="label">Grade Applying For:</span> <span class="value">${enrollmentData.grade_applying}</span></div>
            <div class="field"><span class="label">Boarding:</span> <span class="value">${enrollmentData.boarding_option ? 'Yes' : 'No'}</span></div>
          </div>

          <div class="section">
            <div class="section-title">Parent/Guardian Information</div>
            <div class="field"><span class="label">Name:</span> <span class="value">${enrollmentData.parent_first_name} ${enrollmentData.parent_last_name}</span></div>
            <div class="field"><span class="label">Email:</span> <span class="value">${enrollmentData.parent_email}</span></div>
            <div class="field"><span class="label">Phone:</span> <span class="value">${enrollmentData.parent_phone}</span></div>
          </div>

          ${enrollmentData.previous_school ? `
          <div class="section">
            <div class="section-title">Previous School</div>
            <div class="field"><span class="value">${enrollmentData.previous_school}</span></div>
          </div>
          ` : ''}

          ${enrollmentData.additional_notes ? `
          <div class="section">
            <div class="section-title">Additional Notes</div>
            <div class="field"><span class="value">${enrollmentData.additional_notes}</span></div>
          </div>
          ` : ''}

          <div class="section" style="text-align: center;">
            <p><strong>Application submitted on:</strong> ${new Date().toLocaleString('en-ZA')}</p>
            <p>Please log in to the admin portal to review this application.</p>
          </div>
        </div>

        <div class="footer">
          <p>Harmony Learning Institute</p>
          <p>2 Skilferdoring Street, Onverwacht, Lephalale</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(adminEmail, subject, htmlBody);
}

module.exports = {
  sendEmail,
  sendEnrollmentNotification
};
