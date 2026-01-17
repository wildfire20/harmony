const { google } = require('googleapis');

let connectionSettings = null;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  const data = await response.json();
  connectionSettings = data.items?.[0];

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getGmailClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

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
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  return encodedMessage;
}

async function sendEmail(to, subject, htmlBody) {
  try {
    const gmail = await getGmailClient();
    const encodedMessage = createEmailMessage(to, subject, htmlBody);
    
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });
    
    console.log('Email sent successfully:', result.data.id);
    return { success: true, messageId: result.data.id };
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
        .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
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
  sendEnrollmentNotification,
  getGmailClient
};
