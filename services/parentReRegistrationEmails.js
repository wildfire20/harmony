/* Durable two-event outbox. No parent form or approval depends on mail availability. */
const db = require('../config/database');
const { sendEmail, getEmailProvider } = require('./gmailService');
const { getResendConfig } = require('./resendService');
const LOCK = 7272027;
function dailyLimit(environment = process.env) {
  const value = Number(environment.PARENT_REREGISTRATION_EMAIL_DAILY_LIMIT || 50);
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : 50;
}
async function processOne({ database = db, send = sendEmail, environment = process.env, ready } = {}) {
  if (environment.PARENT_REREGISTRATION_EMAILS_ENABLED === 'false') return { disabled: true };
  const config = getResendConfig(environment);
  if (!(ready === undefined ? getEmailProvider(environment) === 'resend' && config.configured && config.senderValid : ready)) return { waiting_for_configuration: true };
  const client = await database.pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK])).rows[0].locked;
    if (!locked) return { busy: true };
    const row = (await client.query(`SELECT e.*,r.student_id FROM parent_reregistration_emails e
      JOIN parent_reregistrations r ON r.id=e.registration_id
      WHERE e.status IN ('queued','sending') AND e.next_attempt_at<=NOW()
        AND (e.kind='received' OR NOT EXISTS (SELECT 1 FROM parent_reregistration_emails receipt
          WHERE receipt.registration_id=e.registration_id AND receipt.kind='received' AND receipt.status IN ('queued','sending')))
      ORDER BY e.created_at,e.id LIMIT 1`)).rows[0];
    if (!row) return { empty: true };
    // The provider keeps keys for 24h. Never retry an uncertain old send outside that window.
    if (row.first_attempt_at && Date.now() - new Date(row.first_attempt_at).getTime() >= 23 * 60 * 60 * 1000) {
      await client.query("UPDATE parent_reregistration_emails SET status='check_required',error_category='CHECK_RESEND_BEFORE_RETRY' WHERE id=$1", [row.id]);
      return { check_required: true };
    }
    const recipient = (await client.query(`SELECT u.id FROM users u JOIN parent_students ps ON ps.parent_id=u.id
      JOIN users child ON child.id=ps.student_id WHERE u.id=$1 AND ps.student_id=$2 AND u.email=$3
      AND u.role='parent' AND u.is_active=true AND (to_jsonb(u)->>'email_verified_at') IS NOT NULL
      AND child.role='student' AND child.is_active=true`, [row.recipient_id, row.student_id, row.recipient_email])).rows[0];
    if (!recipient) {
      await client.query("UPDATE parent_reregistration_emails SET status='skipped',error_category='RECIPIENT_NO_LONGER_ELIGIBLE' WHERE id=$1", [row.id]);
      return { skipped: true };
    }
    // This budget is for re-registration only; OTPs and school notices also use the plan allowance.
    await client.query(`INSERT INTO parent_reregistration_email_budget(budget_day) VALUES((NOW() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`);
    const budget = await client.query(`UPDATE parent_reregistration_email_budget SET attempts=attempts+1
      WHERE budget_day=(NOW() AT TIME ZONE 'UTC')::date AND attempts<$1 RETURNING attempts`, [dailyLimit(environment)]);
    if (!budget.rows.length) return { daily_limit: true };
    // Autocommit before the API request so a process crash leaves a durable, retryable attempt.
    await client.query("UPDATE parent_reregistration_emails SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,NOW()) WHERE id=$1", [row.id]);
    let result;
    try {
      result = await send(row.recipient_email, row.subject, row.html, {
        fromName: 'Harmony Learning Institute — Parent Portal',
        idempotencyKey: `harmony-reregistration-${row.registration_id}-${row.kind}`,
      });
    } catch { result = { success: false, error: 'UNKNOWN_EMAIL_FAILURE' }; }
    if (result?.success) {
      await client.query("UPDATE parent_reregistration_emails SET status='accepted',accepted_at=NOW(),error_category=NULL WHERE id=$1", [row.id]);
      return { accepted: true };
    }
    const category = String(result?.error || 'UNKNOWN_EMAIL_FAILURE');
    const known = ['EMAIL_RATE_LIMITED','EMAIL_API_TIMEOUT','EMAIL_API_FAILED','UNKNOWN_EMAIL_FAILURE','EMAIL_AUTH_FAILED',
      'EMAIL_PERMISSION_DENIED','EMAIL_SENDER_MISMATCH','EMAIL_CONFIGURATION_MISSING','EMAIL_REJECTED'];
    const error = known.includes(category) ? category : 'UNKNOWN_EMAIL_FAILURE';
    const retryable = error !== 'EMAIL_REJECTED';
    const definitelyRejected = ['EMAIL_RATE_LIMITED','EMAIL_AUTH_FAILED','EMAIL_PERMISSION_DENIED','EMAIL_SENDER_MISMATCH','EMAIL_CONFIGURATION_MISSING'].includes(error);
    // A rejected retry does not prove an earlier timed-out request was not accepted.
    const clearUncertainty = definitelyRejected && !row.first_attempt_at;
    await client.query(`UPDATE parent_reregistration_emails SET status=$2,error_category=$3,
      first_attempt_at=CASE WHEN $4::boolean THEN NULL ELSE first_attempt_at END,
      next_attempt_at=NOW()+interval '1 hour' WHERE id=$1`, [row.id, retryable ? 'queued' : 'failed', error, clearUncertainty]);
    return { deferred: retryable, failed: !retryable };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}
function startEmailWorker() {
  let running = false;
  let warned = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processOne(); warned = false; }
    catch { if (!warned) console.warn('Re-registration email queue is unavailable. Portal confirmations remain available.'); warned = true; }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { processOne, startEmailWorker, dailyLimit };
