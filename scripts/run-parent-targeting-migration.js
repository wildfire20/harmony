require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'parent_targeting_phase4.sql'),
    'utf8',
  );
  await db.query(sql);
  console.log('Parent communication targeting migration applied');
  await db.pool.end();
})().catch((error) => {
  console.error('Parent communication targeting migration failed:', error.message);
  process.exitCode = 1;
});