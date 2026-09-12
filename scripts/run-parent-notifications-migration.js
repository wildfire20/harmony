require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'parent_notifications_phase3.sql'),
    'utf8',
  );
  await db.query(sql);
  console.log('Parent notification centre Phase 3 migration applied');
  await db.pool.end();
})().catch((error) => {
  console.error('Parent notification centre migration failed:', error.message);
  process.exitCode = 1;
});