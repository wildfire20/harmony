require('dotenv').config();
const db = require('../config/database');
const { runParentPhaseMigration } = require('./run-parent-phase-migration');

(async () => runParentPhaseMigration({
  database: db,
  phase: 'parent_activation_phase2',
  migrationFiles: ['parent_activation_phase2.sql'],
  successMessage: 'Parent activation Phase 2 migration applied',
}))().catch((error) => {
  console.error('Parent activation migration failed:', error.message);
  process.exitCode = 1;
});