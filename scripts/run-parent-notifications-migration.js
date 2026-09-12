require('dotenv').config();
const db = require('../config/database');
const { runParentPhaseMigration } = require('./run-parent-phase-migration');

(async () => runParentPhaseMigration({
  database: db,
  phase: 'parent_notifications_phase3',
  migrationFiles: [
    'parent_notifications_phase3.sql',
    'parent_notifications_phase3_legacy_push_repair.sql',
  ],
  successMessage: 'Parent notification centre Phase 3 migration applied',
}))().catch((error) => {
  console.error('Parent notification centre migration failed:', error.message);
  process.exitCode = 1;
});