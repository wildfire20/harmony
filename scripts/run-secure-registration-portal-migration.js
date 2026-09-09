const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');

const REQUIRED_TABLES = Object.freeze([
  'admissions_portal_tokens',
  'registration_records',
  'registration_checklist_items',
  'admissions_portal_documents',
]);

async function run() {
  const migrationPath = path.join(__dirname, '..', 'migrations', 'secure_registration_portal_phase.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await db.pool.query(sql);
    const verification = await db.pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [REQUIRED_TABLES]);
    const created = verification.rows.map(({ table_name: tableName }) => tableName);
    const missing = REQUIRED_TABLES.filter((tableName) => !created.includes(tableName));
    if (missing.length) {
      throw new Error(`Secure registration portal migration verification failed: missing ${missing.join(', ')}`);
    }
    console.log('Secure registration portal migration applied and verified:', { tables: created });
  } finally {
    await db.pool.end();
  }
}

run().catch((error) => {
  console.error('Secure registration portal migration failed:', error.message);
  process.exitCode = 1;
});