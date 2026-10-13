require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const { checkEnquirySchema } = require('../services/parentEnquiryService');

async function run(database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query(`SELECT
      to_regclass('parent_enquiry_admin_reads') IS NOT NULL AS enquiry_read_tracking,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
        AND table_name='pending_payments' AND column_name='payment_date') AS proof_payment_date`)).rows[0];
    console.log('Parent Portal schema before migration:', before);
    for (const file of ['parent_enquiries.sql', 'parent_reregistration.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
    }
    await checkEnquirySchema(client);
    await client.query('SELECT payment_date FROM pending_payments LIMIT 0');
    await client.query('SELECT payment_date FROM parent_reregistration_proofs LIMIT 0');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
if (require.main === module) run()
  .then(() => console.log('Parent Portal enquiry and re-registration migrations applied successfully.'))
  .catch(error => { console.error('Parent Portal migration failed.', { code: error.code || 'SCHEMA_NOT_READY' }); process.exitCode = 1; })
  .finally(() => db.pool.end());
module.exports = { run };
