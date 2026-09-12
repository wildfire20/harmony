require('dotenv').config();
const db = require('../config/database');

(async () => {
  const column = await db.query(`
    SELECT column_name,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='school_events'
      AND column_name IN ('parent_visible','class_id')
  `);
  const visibility = column.rows.find(row => row.column_name === 'parent_visible');
  const counts = visibility
    ? await db.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE parent_visible=true)::int AS parent_visible
        FROM school_events WHERE is_active=true`)
    : { rows: [{ total: null, parent_visible: null }] };
  console.log(JSON.stringify({
    audit: true,
    ready: column.rows.length === 2 && visibility?.is_nullable === 'NO',
    legacy_default_private: String(visibility?.column_default || '').toLowerCase().includes('false'),
    active_events: counts.rows[0],
  }, null, 2));
})().catch(error => {
  console.error('Calendar visibility audit failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.pool.end());