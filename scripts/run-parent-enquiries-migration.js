require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const { checkEnquirySchema } = require('../services/parentEnquiryService');

async function run(database = db) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'parent_enquiries.sql'), 'utf8'));
    await checkEnquirySchema(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
if (require.main === module) run().then(() => console.log('Parent enquiries migration applied successfully.'))
  .catch(() => { console.error('Parent enquiries migration failed. No migration success was reported.'); process.exitCode = 1; })
  .finally(() => db.pool.end());
module.exports = { run };
