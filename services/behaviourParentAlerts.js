const db = require('../config/database');
const { createParentNotifications, EVENT } = require('./parentNotificationService');
const { sendEmail, getEmailProvider } = require('./gmailService');
const { getResendConfig } = require('./resendService');
const LOCK = 7272028;
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);

// Incident details stay behind the authenticated portal, including for legacy/unverified contacts.
const SUBJECT = 'Harmony Parent Portal — New demerit recorded';
const HTML = '<div style="font-family:Arial,sans-serif;color:#19324a;max-width:560px;margin:auto">' +
  '<h2>New demerit recorded</h2><p>A new demerit has been recorded for a learner linked to your Parent Portal account.</p>' +
  '<p>Please sign in and open <strong>Merits &amp; Demerits</strong> to view the details.</p>' +
  '<p><a href="https://www.harmonylearning.co.za/parent/behaviour">Open Parent Portal</a></p>' +
  '<p>Harmony Learning Institute</p><p><a href="https://www.auto-m8.co.za/">Powered by AutoM8</a></p></div>';

async function queueDemeritAlerts(client, record) {
  if (record.kind !== 'demerit') return;
  const recipients = (await client.query(`SELECT p.id AS parent_id,p.email,p.first_name AS parent_first_name,
    ps.student_id AS learner_id FROM parent_students ps JOIN users p ON p.id=ps.parent_id
    WHERE ps.student_id=$1 AND p.role='parent' AND p.is_active=true FOR SHARE OF ps,p`, [record.student_id])).rows;
  const dedupeKey = `behaviour-demerit:${record.id}`;
  const result = await createParentNotifications({
    eventType: EVENT.DEMERIT, title: 'New demerit recorded',
    summary: 'A demerit has been recorded for this learner. Open Merits & Demerits to view the details.',
    destination: 'behaviour', dedupeKey, learnerId: record.student_id,
    recipients, executor: client, deliver: false, required: true, important: true, email: false,
  });
  for (const parent of result.createdRecipients) {
    const email = typeof parent.email === 'string' ? parent.email.trim() : '';
    await client.query(`INSERT INTO behaviour_parent_emails(record_id,parent_id,notification_id,recipient_email,subject,html,status,error_category)
      SELECT $1,$2,n.id,$3,$4,$5,$6,$7 FROM parent_notifications n WHERE n.parent_id=$2 AND n.dedupe_key=$8
      ON CONFLICT(record_id,parent_id) DO NOTHING`,
    [record.id,parent.parent_id,email || null,SUBJECT,HTML,validEmail(email)?'queued':'skipped',validEmail(email)?null:'NO_VALID_PARENT_EMAIL',dedupeKey]);
  }
}

async function correctDemeritAlerts(client, record) {
  if (record.kind !== 'demerit') return;
  await client.query(`UPDATE behaviour_parent_emails SET status='skipped',error_category='RECORD_CORRECTED'
    WHERE record_id=$1 AND status IN ('queued','sending','check_required')`, [record.id]);
  await client.query(`UPDATE parent_notifications SET title='Demerit entry corrected',
    summary='A demerit entry was corrected and is excluded from totals. Open Merits & Demerits to view the history.'
    WHERE event_type=$1 AND learner_id=$2 AND dedupe_key=$3`, [EVENT.DEMERIT,record.student_id,`behaviour-demerit:${record.id}`]);
}

async function processOne({ database = db, send = sendEmail, environment = process.env, ready } = {}) {
  const config = getResendConfig(environment);
  if (!(ready === undefined ? getEmailProvider(environment)==='resend' && config.configured && config.senderValid : ready))
    return { waiting_for_configuration: true };
  const client = await database.pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked',[LOCK])).rows[0].locked;
    if (!locked) return { busy: true };
    const row = (await client.query(`SELECT e.*,b.student_id FROM behaviour_parent_emails e
      JOIN behaviour_records b ON b.id=e.record_id WHERE e.status IN ('queued','sending')
      AND e.next_attempt_at<=NOW() ORDER BY e.next_attempt_at,e.id LIMIT 1`)).rows[0];
    if (!row) return { empty: true };
    const eligible = validEmail(row.recipient_email) && (await client.query(`SELECT 1 FROM users p
      JOIN parent_students ps ON ps.parent_id=p.id JOIN users s ON s.id=ps.student_id
      JOIN behaviour_records b ON b.student_id=s.id AND b.id=$4
      WHERE p.id=$1 AND ps.student_id=$2 AND trim(p.email)=$3 AND p.role='parent' AND p.is_active=true
      AND s.role='student' AND s.is_active=true AND b.kind='demerit' AND b.status='active'`,
    [row.parent_id,row.student_id,row.recipient_email,row.record_id])).rowCount;
    if (!eligible) {
      await client.query("UPDATE behaviour_parent_emails SET status='skipped',error_category='RECIPIENT_OR_RECORD_NO_LONGER_ELIGIBLE' WHERE id=$1",[row.id]);
      return { skipped: true };
    }
    // Resend retains idempotency keys for 24h. An old uncertain send needs review, never blind retry.
    if (row.first_attempt_at && Date.now()-new Date(row.first_attempt_at).getTime() >= 23*60*60*1000) {
      await client.query("UPDATE behaviour_parent_emails SET status='check_required',error_category='CHECK_RESEND_BEFORE_RETRY' WHERE id=$1",[row.id]);
      return { check_required: true };
    }
    // Commit the attempt before external I/O, so a restart reuses the same provider key and payload.
    await client.query("UPDATE behaviour_parent_emails SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,NOW()) WHERE id=$1",[row.id]);
    let result;
    try {
      result = await send(row.recipient_email,row.subject,row.html,{
        fromName:'Harmony Learning Institute — Parent Portal',replyTo:'harmonylearninginstitute@gmail.com',
        idempotencyKey:`harmony-demerit-${row.record_id}-${row.parent_id}`,
      });
    } catch { result = { success:false,error:'UNKNOWN_EMAIL_FAILURE' }; }
    if (result?.success) {
      await client.query("UPDATE behaviour_parent_emails SET status='accepted',accepted_at=NOW(),error_category=NULL WHERE id=$1 AND status='sending'",[row.id]);
      return { accepted:true };
    }
    const known = ['EMAIL_RATE_LIMITED','EMAIL_API_TIMEOUT','EMAIL_API_FAILED','UNKNOWN_EMAIL_FAILURE','EMAIL_AUTH_FAILED',
      'EMAIL_PERMISSION_DENIED','EMAIL_SENDER_MISMATCH','EMAIL_CONFIGURATION_MISSING','EMAIL_REJECTED'];
    const error = known.includes(result?.error) ? result.error : 'UNKNOWN_EMAIL_FAILURE';
    const definitelyRejected = ['EMAIL_RATE_LIMITED','EMAIL_AUTH_FAILED','EMAIL_PERMISSION_DENIED','EMAIL_SENDER_MISMATCH','EMAIL_CONFIGURATION_MISSING'].includes(error);
    await client.query(`UPDATE behaviour_parent_emails SET status=$2,error_category=$3,
      first_attempt_at=CASE WHEN $4::boolean THEN NULL ELSE first_attempt_at END,next_attempt_at=NOW()+interval '1 hour'
      WHERE id=$1 AND status='sending'`,[row.id,error==='EMAIL_REJECTED'?'failed':'queued',error,definitelyRejected && !row.first_attempt_at]);
    return { deferred:error!=='EMAIL_REJECTED',failed:error==='EMAIL_REJECTED' };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});
    client.release();
  }
}

function startEmailWorker() {
  let running=false,warned=false;
  const tick=async()=>{
    if(running)return;running=true;
    try {
      for(let i=0;i<5;i++) {
        const result=await processOne();
        if(!result.accepted && !result.skipped)break;
        // Pace small batches below Resend's normal request rate.
        if(result.accepted && i<4)await new Promise(resolve=>setTimeout(resolve,600));
      }
      warned=false;
    } catch { if(!warned)console.warn('Demerit email queue is unavailable. Saved Parent Portal alerts remain available.');warned=true; }
    finally { running=false; }
  };
  const timer=setInterval(tick,15000);timer.unref();
  return ()=>clearInterval(timer);
}
module.exports={queueDemeritAlerts,correctDemeritAlerts,processOne,startEmailWorker};
