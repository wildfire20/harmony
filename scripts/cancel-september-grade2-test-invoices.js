require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  createFinanceReadonlyPool,
  beginVerifiedReadonlySession,
} = require('./finance-readonly-database');

const OPERATION_KEY = 'cancel-september-2026-grade2-test-one-offs:v1';
const REASON = 'Cancel verified accidental September 2026 Grade 2 one-off test invoices';
const EXPECTED_INVOICE_IDS = Array.from({ length: 118 }, (_, index) => 11355 + index);
const EXPECTED_PREFLIGHT_SHA256 = 'bf020e432445cc350d8652a0b779a285fc0a3d38e5eea09ea087b71f537b5ab0';
const EXPECTED_FEES = new Map([
  [4, { name: 'grade 2 fees  for fun  day', amount: '1200.00', invoiceCount: 59 }],
  [5, { name: 'test im tierd', amount: '300.00', invoiceCount: 59 }],
]);

const stable = (value) => JSON.stringify(value, (key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.keys(item).sort().reduce((out, name) => {
      out[name] = item[name];
      return out;
    }, {});
  }
  return item;
});

function sha256(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function parseArgs(argv) {
  if (argv.length === 0) return { apply: false };
  if (argv.length === 1 && argv[0] === '--apply') return { apply: true };
  throw new Error('Usage: node scripts/cancel-september-grade2-test-invoices.js [--apply]');
}

function createApplyPool(env) {
  const connectionString = String(env.FINANCE_SEPTEMBER_CLEANUP_APPLY_DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error('FINANCE_SEPTEMBER_CLEANUP_APPLY_DATABASE_URL is required with --apply');
  }
  return new Pool({
    connectionString,
    ssl: env.FINANCE_SEPTEMBER_CLEANUP_APPLY_DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
}

async function verifyCancellationSchema(client) {
  const result = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'invoices'::regclass
      AND conname = 'invoices_status_check'
  `);
  if (result.rowCount !== 1 || !result.rows[0].definition.includes('Cancelled')) {
    throw new Error('finance_invoice_cancellation migration is required before cleanup');
  }
}

async function readCandidates(client, lock = false) {
  const result = await client.query(`
    SELECT i.id AS invoice_id, i.student_id, f.id AS fee_id,
           li.id AS line_item_id, f.name AS fee_name,
           f.amount::text AS fee_amount, f.is_active AS fee_active,
           i.due_date::text AS invoice_date, i.invoice_kind,
           i.invoice_source, i.finance_origin,
           i.amount_due::text AS invoice_amount,
           i.amount_paid::text AS amount_paid, i.status,
           li.amount::text AS line_amount,
           COALESCE((
             SELECT jsonb_agg(pt.id ORDER BY pt.id)
             FROM payment_transactions pt
             WHERE pt.invoice_id=i.id AND pt.reverses_transaction_id IS NULL
           ), '[]'::jsonb) AS original_payment_ids,
           COALESCE((
             SELECT jsonb_agg(pt.id ORDER BY pt.id)
             FROM payment_transactions pt
             LEFT JOIN payment_transactions reversal
               ON reversal.reverses_transaction_id=pt.id
             WHERE pt.invoice_id=i.id
               AND pt.reverses_transaction_id IS NULL
               AND reversal.id IS NULL
           ), '[]'::jsonb) AS live_payment_ids,
           COALESCE((
             SELECT jsonb_agg(reversal.id ORDER BY reversal.id)
             FROM payment_transactions pt
             JOIN payment_transactions reversal
               ON reversal.reverses_transaction_id=pt.id
             WHERE pt.invoice_id=i.id
           ), '[]'::jsonb) AS reversal_ids
    FROM invoices i
    JOIN invoice_line_items li
      ON li.invoice_id=i.id
     AND li.metadata->>'category'='one_off'
    JOIN student_one_off_fees f
      ON f.id=(li.metadata->>'fee_id')::integer
    WHERE i.due_date >= DATE '2026-09-01'
      AND i.due_date < DATE '2026-10-01'
      AND (
        (f.id=4 AND f.name='grade 2 fees  for fun  day' AND f.amount=1200)
        OR
        (f.id=5 AND f.name='test im tierd' AND f.amount=300)
      )
    ORDER BY i.id
    ${lock ? 'FOR UPDATE OF i, li, f' : ''}
  `);
  return result.rows;
}

function assertExactIdentity(rows) {
  if (rows.length !== EXPECTED_INVOICE_IDS.length) {
    throw new Error(`Candidate count changed: expected 118, found ${rows.length}`);
  }
  const ids = rows.map((row) => Number(row.invoice_id));
  if (stable(ids) !== stable(EXPECTED_INVOICE_IDS)) {
    throw new Error('Candidate invoice identity set changed');
  }
  for (const [feeId, expected] of EXPECTED_FEES) {
    const feeRows = rows.filter((row) => Number(row.fee_id) === feeId);
    if (feeRows.length !== expected.invoiceCount ||
        feeRows.some((row) => row.fee_name !== expected.name ||
          row.fee_amount !== expected.amount ||
          row.fee_active !== false)) {
      throw new Error(`One-off fee ${feeId} identity changed`);
    }
  }
  if (rows.some((row) =>
    row.invoice_date < '2026-09-01' || row.invoice_date >= '2026-10-01' ||
    row.invoice_kind === 'monthly' || row.finance_origin === 'canonical' ||
    row.invoice_amount !== row.fee_amount || row.line_amount !== row.fee_amount ||
    row.amount_paid !== '0.00' || row.live_payment_ids.length > 0)) {
    throw new Error('Candidate safety contract changed');
  }
}

function assertApprovedPreflight(rows, expectedPreflightSha256 = EXPECTED_PREFLIGHT_SHA256) {
  assertExactIdentity(rows);
  if (rows.some((row) => row.status !== 'Unpaid')) {
    throw new Error('Candidate invoice status changed before first application');
  }
  const actual = sha256(rows);
  if (actual !== expectedPreflightSha256) {
    throw new Error(`Candidate preflight fingerprint changed (expected ${expectedPreflightSha256}, got ${actual})`);
  }
}

async function readProtectedBaseline(client) {
  const protectedInvoice = await client.query(`
    SELECT id, student_id, student_number, amount_due::text, amount_paid::text,
           due_date::text, status, description, invoice_kind, finance_origin
    FROM invoices WHERE id=11091
  `);
  const october = await client.query(`
    SELECT count(*)::integer AS invoice_count,
           COALESCE(sum(amount_due),0)::text AS total_due,
           COALESCE(sum(amount_paid),0)::text AS total_paid,
           min(id) AS min_invoice_id, max(id) AS max_invoice_id
    FROM invoices
    WHERE billing_period=DATE '2026-10-01'
      AND invoice_kind='monthly' AND finance_origin='canonical'
  `);
  if (protectedInvoice.rowCount !== 1 ||
      Number(october.rows[0].invoice_count) !== 316 ||
      october.rows[0].total_due !== '829725.00' ||
      Number(october.rows[0].min_invoice_id) !== 11473 ||
      Number(october.rows[0].max_invoice_id) !== 11788) {
    throw new Error('Protected September/October baseline changed');
  }
  return { protectedInvoice: protectedInvoice.rows[0], october: october.rows[0] };
}

async function completedAudit(client, expectedPreflightSha256 = EXPECTED_PREFLIGHT_SHA256) {
  const result = await client.query(`
    SELECT user_id, user_role, details
    FROM audit_logs
    WHERE action='september_test_invoices_cancelled'
      AND details->>'operation_key'=$1
    ORDER BY id
  `, [OPERATION_KEY]);
  if (!result.rowCount) return false;
  if (result.rowCount !== 1 ||
      stable((result.rows[0].details?.invoice_ids || []).map(Number)) !== stable(EXPECTED_INVOICE_IDS) ||
      result.rows[0].details?.preflight_sha256 !== expectedPreflightSha256) {
    throw new Error('Cancellation audit evidence is incomplete or altered');
  }
  return true;
}

async function execute({
  env = process.env,
  apply = false,
  logger = console.log,
  pool: suppliedPool = null,
  injectedFailure = false,
  expectedPreflightSha256 = EXPECTED_PREFLIGHT_SHA256,
} = {}) {
  const pool = suppliedPool || (apply ? createApplyPool(env) : createFinanceReadonlyPool(env));
  const ownsPool = !suppliedPool;
  const client = await pool.connect();
  try {
    if (!apply) {
      const session = await beginVerifiedReadonlySession(client, () => {});
      await verifyCancellationSchema(client);
      const rows = await readCandidates(client);
      if (rows.every((row) => row.status === 'Cancelled')) {
        assertExactIdentity(rows);
        if (!await completedAudit(client, expectedPreflightSha256)) throw new Error('Cancelled rows lack completed audit evidence');
        await client.query('ROLLBACK');
        const result = { status: 'verified_completed_noop', candidateCount: 118, transaction_read_only: session.transactionReadOnly };
        logger(JSON.stringify(result));
        return result;
      }
      assertApprovedPreflight(rows, expectedPreflightSha256);
      await readProtectedBaseline(client);
      await client.query('ROLLBACK');
      const result = {
        status: 'eligible_first_application',
        candidateCount: rows.length,
        invoiceIds: EXPECTED_INVOICE_IDS,
        preflight_sha256: expectedPreflightSha256,
        transaction_read_only: session.transactionReadOnly,
      };
      logger(JSON.stringify(result));
      return result;
    }

    const actorId = Number(env.FINANCE_SEPTEMBER_CLEANUP_ADMIN_USER_ID);
    if (!Number.isSafeInteger(actorId) || actorId <= 0) {
      throw new Error('FINANCE_SEPTEMBER_CLEANUP_ADMIN_USER_ID must identify the applying administrator');
    }
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'`);
    await client.query(`SELECT set_config('harmony.finance_command', 'canonical', true)`);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [OPERATION_KEY]);
    for (const table of ['invoices', 'invoice_line_items', 'student_one_off_fees', 'payment_transactions', 'audit_logs', 'users']) {
      await client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    }
    await verifyCancellationSchema(client);
    const actor = await client.query(`
      SELECT id, first_name, last_name, role
      FROM users
      WHERE id=$1 AND is_active=true AND role IN ('admin','super_admin')
      FOR UPDATE
    `, [actorId]);
    if (actor.rowCount !== 1) throw new Error('Applying administrator is unavailable');

    const rows = await readCandidates(client, true);
    if (rows.every((row) => row.status === 'Cancelled')) {
      assertExactIdentity(rows);
      if (!await completedAudit(client, expectedPreflightSha256)) throw new Error('Cancelled rows lack completed audit evidence');
      await client.query('ROLLBACK');
      const result = { applied: false, noop: true, verified: true, candidateCount: 118 };
      logger(JSON.stringify(result));
      return result;
    }
    assertApprovedPreflight(rows, expectedPreflightSha256);
    const before = await readProtectedBaseline(client);

    const updated = await client.query(`
      UPDATE invoices
      SET status='Cancelled', updated_at=CURRENT_TIMESTAMP
      WHERE id=ANY($1::integer[]) AND status='Unpaid'
      RETURNING id
    `, [EXPECTED_INVOICE_IDS]);
    if (updated.rowCount !== 118) throw new Error('Not every verified invoice was cancelled');
    if (injectedFailure) throw new Error('Injected cancellation failure');

    const learnerIds = [...new Set(rows.map((row) => Number(row.student_id)))].sort((a, b) => a - b);
    const actorName = `${actor.rows[0].first_name || ''} ${actor.rows[0].last_name || ''}`.trim();
    await client.query(`
      INSERT INTO audit_logs
        (user_id,user_name,user_role,action,entity_type,entity_id,details)
      VALUES ($1,$2,$3,'september_test_invoices_cancelled','invoice',NULL,
        jsonb_build_object(
          'operation_key',$4,'reason',$5,'invoice_ids',$6::jsonb,
          'learner_ids',$7::jsonb,'invoice_count',118,'learner_count',$8,
          'preflight_sha256',$9,'cancelled_at',CURRENT_TIMESTAMP
        ))
    `, [
      actorId, actorName, actor.rows[0].role, OPERATION_KEY, REASON,
      JSON.stringify(EXPECTED_INVOICE_IDS), JSON.stringify(learnerIds),
      learnerIds.length, expectedPreflightSha256,
    ]);

    const afterRows = await readCandidates(client, true);
    assertExactIdentity(afterRows);
    if (afterRows.some((row) => row.status !== 'Cancelled') ||
        !await completedAudit(client, expectedPreflightSha256)) {
      throw new Error('Post-cancellation verification failed');
    }
    const after = await readProtectedBaseline(client);
    if (stable(before) !== stable(after)) throw new Error('Protected invoices changed during cancellation');
    await client.query('COMMIT');
    const result = { applied: true, candidateCount: 118, invoiceIds: EXPECTED_INVOICE_IDS };
    logger(JSON.stringify(result));
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (ownsPool) await pool.end();
  }
}

if (require.main === module) {
  try {
    const { apply } = parseArgs(process.argv.slice(2));
    execute({ apply }).catch((error) => {
      console.error(`September test-invoice cancellation failed: ${error.message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`September test-invoice cancellation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  execute,
  parseArgs,
  assertExactIdentity,
  assertApprovedPreflight,
  sha256,
  EXPECTED_INVOICE_IDS,
  EXPECTED_PREFLIGHT_SHA256,
};