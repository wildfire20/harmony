const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');

async function run() {
  const migrationPath = path.join(__dirname, '..', 'migrations', 'admissions_management_phase.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await db.pool.query(sql);
    const verification = await db.pool.query(`
      WITH reference_summary AS (
        SELECT
          COUNT(*)::BIGINT AS total_applications,
          COUNT(*) FILTER (
            WHERE application_reference IS NULL OR BTRIM(application_reference) = ''
          )::BIGINT AS null_references,
          COALESCE(MAX(
            SUBSTRING(application_reference FROM '^HLI-2027-([0-9]+)$')::BIGINT
          ), 0)::BIGINT AS highest_reference_number
        FROM enrollments
      ),
      duplicate_summary AS (
        SELECT COUNT(*)::BIGINT AS duplicate_references
        FROM (
          SELECT application_reference
          FROM enrollments
          WHERE application_reference IS NOT NULL
          GROUP BY application_reference
          HAVING COUNT(*) > 1
        ) duplicates
      ),
      sequence_summary AS (
        SELECT
          last_value::BIGINT,
          is_called,
          CASE WHEN is_called THEN last_value + 1 ELSE last_value END::BIGINT AS next_sequence_number
        FROM enrollment_application_reference_seq
      ),
      status_summary AS (
        SELECT COALESCE(
          json_object_agg(status, status_count ORDER BY status),
          '{}'::json
        ) AS status_counts
        FROM (
          SELECT status, COUNT(*)::BIGINT AS status_count
          FROM enrollments
          GROUP BY status
        ) counts
      ),
      default_summary AS (
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'enrollments'
          AND column_name = 'status'
      )
      SELECT
        reference_summary.*,
        duplicate_summary.duplicate_references,
        sequence_summary.next_sequence_number,
        sequence_summary.next_sequence_number > reference_summary.highest_reference_number
          AS next_sequence_is_safe,
        status_summary.status_counts,
        default_summary.column_default,
        to_regclass('public.enrollment_status_history') IS NOT NULL AS status_history_ready,
        to_regclass('public.admissions_email_log') IS NOT NULL AS email_log_ready
      FROM reference_summary
      CROSS JOIN duplicate_summary
      CROSS JOIN sequence_summary
      CROSS JOIN status_summary
      CROSS JOIN default_summary
    `);
    const checks = verification.rows[0];
    const defaultIsPending = String(checks.column_default).includes("'pending'");
    if (
      Number(checks.null_references) !== 0
      || Number(checks.duplicate_references) !== 0
      || !checks.next_sequence_is_safe
      || !checks.status_history_ready
      || !checks.email_log_ready
      || !defaultIsPending
    ) {
      throw new Error('Admissions migration verification failed');
    }
    console.log('Admissions migration applied and verified:', {
      totalApplications: Number(checks.total_applications),
      nullReferences: Number(checks.null_references),
      duplicateReferences: Number(checks.duplicate_references),
      highestApplicationReference: checks.highest_reference_number
        ? `HLI-2027-${String(checks.highest_reference_number).padStart(4, '0')}`
        : null,
      nextSequenceNumber: Number(checks.next_sequence_number),
      nextSequenceIsSafe: checks.next_sequence_is_safe,
      statusCounts: checks.status_counts,
      statusDefault: 'pending',
    });
  } finally {
    await db.pool.end();
  }
}

run().catch((error) => {
  console.error('Admissions migration failed:', error.message);
  process.exitCode = 1;
});