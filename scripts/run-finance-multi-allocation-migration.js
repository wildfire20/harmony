require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const { verifyFinanceMultiAllocationSchema } = require('./finance-multi-allocation-schema-verifier');

async function main() {
  const pool = db.pool || db;
  const client = await pool.connect();
  let committed = false;
  try {
    const before = await verifyFinanceMultiAllocationSchema(client);
    if (!before.prerequisite.ok) {
      throw new Error(`Prerequisite Mini Phase 1 finance schema is missing: ${before.prerequisite.missing.join('; ')}`);
    }
    if (before.duplicateOneOffAssignmentSnapshots.length) {
      throw new Error('Duplicate one-off assignment snapshots exist; resolve them through audited reconciliation before migrating');
    }
    if (before.target.ok) {
      console.log('Finance multi-allocation schema already applied and verified');
      return;
    }

    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('finance_multi_allocation_migration'))`);
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', 'finance_multi_allocation.sql'),
      'utf8',
    );
    await client.query(sql);
    const after = await verifyFinanceMultiAllocationSchema(client);
    if (!after.ok) {
      throw new Error(`Post-migration verification failed: ${after.target.missing.join('; ')}`);
    }
    await client.query('COMMIT');
    committed = true;
    console.log('Finance multi-allocation schema applied and verified');
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
    if (typeof pool.end === 'function') await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Finance multi-allocation migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };