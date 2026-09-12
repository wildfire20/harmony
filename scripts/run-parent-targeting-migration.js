require('dotenv').config();
const db = require('../config/database');
const { runParentPhaseMigration } = require('./run-parent-phase-migration');

(async () => runParentPhaseMigration({
  database: db,
  phase: 'parent_targeting_phase4',
  migrationFiles: ['parent_targeting_phase4.sql'],
  successMessage: 'Parent communication targeting migration applied',
}))().catch((error) => {
  console.error('Parent communication targeting migration failed:', error.message);
  process.exitCode = 1;
});