const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const { isAdmissionsPortalSchemaReady } = require('../middleware/admissionsPortalSchema');

async function run() {
  const migrationPath = path.join(
    __dirname,
    '..',
    'migrations',
    'admissions_documents_notifications.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  try {
    await db.pool.query(sql);
    const ready = await isAdmissionsPortalSchemaReady(db);
    if (!ready) {
      throw new Error('Admissions documents migration verification failed');
    }
    console.log('Admissions documents migration applied and verified');
  } finally {
    await db.pool.end();
  }
}

run().catch((error) => {
  console.error('Admissions documents migration failed:', error.message);
  process.exitCode = 1;
});