require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

(async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/calendar_parent_visibility.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
    await client.query(sql);
    const verified = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='school_events'
        AND column_name IN ('parent_visible','class_id')
    `);
    if (verified.rows.length !== 2) throw new Error('Calendar Parent visibility schema verification failed');
    await client.query('COMMIT');
    console.log('Calendar Parent visibility migration applied');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
})().catch(error => {
  console.error('Calendar Parent visibility migration failed:', error.message);
  process.exitCode = 1;
});