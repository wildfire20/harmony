/**
 * SMS Service – tries Twilio if configured, otherwise logs OTP to console/DB
 * for admin retrieval. The system works without SMS credentials.
 */

const sendSMS = async (phoneNumber, message) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (accountSid && authToken && fromNumber) {
    try {
      const twilio = require('twilio');
      const client = twilio(accountSid, authToken);
      await client.messages.create({
        body: message,
        from: fromNumber,
        to: phoneNumber,
      });
      console.log(`✅ SMS sent to ${phoneNumber}`);
      return { sent: true, method: 'sms' };
    } catch (err) {
      console.warn(`⚠️ Twilio SMS failed: ${err.message}`);
      return { sent: false, method: 'failed', error: err.message };
    }
  }

  // No Twilio configured – log for admin visibility
  console.log(`📱 [SMS not configured] To: ${phoneNumber} | Message: ${message}`);
  return { sent: false, method: 'not_configured' };
};

module.exports = { sendSMS };
