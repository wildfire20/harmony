require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'parent_activation_phase2.sql'), 'utf8');
  await db.query(sql);
  console.log('Parent activation Phase 2 migration applied');
  await db.pool.end();
})().catch((error) => {
  console.error('Parent activation migration failed:', error.message);
  process.exitCode = 1;
});