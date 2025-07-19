#!/usr/bin/env node
require('dotenv').config();
const diagnosePaymentIssue = require('./diagnose-payment-issue');

console.log('🚀 Starting payment diagnosis on Railway...');

diagnosePaymentIssue()
  .then(() => {
    console.log('\n✅ Diagnosis completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Diagnosis failed:', error);
    process.exit(1);
  });
