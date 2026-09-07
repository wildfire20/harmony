const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');

async function run() {
  const migrationPath = path.join(__dirname, '..', 'migrations', 'admissions_management_phase.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await db.pool.query(sql);
    const verification = await db.pool.query(`
      SELECT
        to_regclass('public.enrollment_application_reference_seq') IS NOT NULL AS reference_sequence,
        to_regclass('public.enrollment_status_history') IS NOT NULL AS status_history,
        to_regclass('public.admissions_email_log') IS NOT NULL AS email_log,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'enrollments'
            AND column_name = 'application_reference'
        ) AS application_reference
    `);
    const checks = verification.rows[0];
    if (!Object.values(checks).every(Boolean)) throw new Error('Admissions migration verification failed');
    console.log('Admissions migration applied and verified.');
  } finally {
    await db.pool.end();
  }
}

run().catch((error) => {
  console.error('Admissions migration failed:', error.message);
  process.exitCode = 1;
});