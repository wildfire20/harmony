const test = require('node:test');
const assert = require('node:assert/strict');
const { sendResendEmail } = require('../services/resendService');
const { adminNotificationAddress } = require('../services/parentReRegistrationEmails');
test('Admin alerts use only the configured school address and reject ambiguous or unsafe recipients',()=>{
  assert.equal(adminNotificationAddress({ADMIN_NOTIFICATION_EMAIL:' office@example.test '}),'office@example.test');
  for(const value of [undefined,'','invalid','one@example.test,two@example.test','office@example.test\r\nBcc:other@example.test']) {
    assert.equal(adminNotificationAddress({ADMIN_NOTIFICATION_EMAIL:value}),null);
  }
});
test('optional provider idempotency header preserves existing mail payloads and stays on the fixed origin',async()=>{
  const original=global.fetch;const calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({id:'synthetic-id'})};};
  try {
    const environment={RESEND_API_KEY:'synthetic-key',RESEND_FROM_EMAIL:'school@example.test'};
    const message={to:'parent@example.test',fromName:'Harmony',subject:'Received',html:'<p>Received.</p>',text:'Received.'};
    assert.equal((await sendResendEmail(message,environment)).success,true);
    assert.equal((await sendResendEmail({...message,idempotencyKey:'harmony-reregistration-1-received'},environment)).success,true);
    assert.equal(calls[0].options.headers['Idempotency-Key'],undefined);assert.equal(calls[1].options.headers['Idempotency-Key'],'harmony-reregistration-1-received');
    assert.deepEqual(JSON.parse(calls[0].options.body),JSON.parse(calls[1].options.body));
    assert.equal(calls[1].url,'https://api.resend.com/emails');assert.equal(calls[1].options.redirect,'error');
    await sendResendEmail({...message,idempotencyKey:'bad\r\nkey'},environment);assert.equal(calls[2].options.headers['Idempotency-Key'],undefined);
  } finally {global.fetch=original;}
});
