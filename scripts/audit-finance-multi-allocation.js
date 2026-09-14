require('dotenv').config();
const db = require('../config/database');
const { verifyFinanceMultiAllocationSchema } = require('./finance-multi-allocation-schema-verifier');

async function main() {
  const pool = db.pool || db;
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await verifyFinanceMultiAllocationSchema(client);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ audit: true, readOnly: true, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (typeof pool.end === 'function') await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const section = error.auditSection ? ` [section: ${error.auditSection}]` : '';
    console.error(`Finance multi-allocation audit failed${section}:`, error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };