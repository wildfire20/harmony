require('dotenv').config();
const { verifyEmailTransport } = require('../services/gmailService');

verifyEmailTransport()
  .then((result) => {
    if (!result.success) {
      console.error(`Admissions email transport verification failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log('Admissions email transport verification succeeded');
  })
  .catch(() => {
    console.error('Admissions email transport verification failed: UNKNOWN_EMAIL_FAILURE');
    process.exitCode = 1;
  });