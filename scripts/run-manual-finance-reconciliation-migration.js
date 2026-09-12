require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'manual_finance_reconciliation.sql'),
    'utf8',
  );
  await db.query(sql);
  console.log('Manual finance reconciliation migration applied');
  await db.pool.end();
})().catch((error) => {
  console.error('Manual finance reconciliation migration failed:', error.message);
  process.exitCode = 1;
});