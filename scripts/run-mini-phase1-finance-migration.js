require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const { verifyMiniPhase1FinanceSchema } = require('./mini-phase1-finance-schema-verifier');

async function main() {
  const auditOnly = process.argv.includes('--audit') || process.env.AUDIT_ONLY === 'true';
  const pool = db.pool || db;
  const client = await pool.connect();
  let committed = false;
  try {
    if (!auditOnly) await client.query('BEGIN');
    const readiness = await verifyMiniPhase1FinanceSchema(client);
    if (auditOnly) {
      console.log(JSON.stringify({ audit: true, ...readiness }));
      if (!readiness.ok) process.exitCode = 1;
      return;
    }
    if (readiness.ok) {
      await client.query('COMMIT');
      committed = true;
      console.log('Mini Phase 1 finance schema already applied and verified');
      return;
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mini_phase1_finance_truth.sql'), 'utf8');
    await client.query(sql);
    const afterMigration = await verifyMiniPhase1FinanceSchema(client);
    if (!afterMigration.ok) throw new Error(`Verification failed: ${afterMigration.missing.join('; ')}`);
    await client.query('COMMIT');
    committed = true;
    console.log('Mini Phase 1 finance schema applied and verified');
  } finally {
    if (!committed && !auditOnly) await client.query('ROLLBACK').catch(() => {});
    client.release();
    if (typeof pool.end === 'function') await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const operation = process.argv.includes('--audit') || process.env.AUDIT_ONLY === 'true'
      ? 'audit'
      : 'migration';
    const section = error.auditSection ? ` [section: ${error.auditSection}]` : '';
    console.error(`Mini Phase 1 finance ${operation} failed${section}:`, error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };