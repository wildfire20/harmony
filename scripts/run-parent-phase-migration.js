const fs = require('node:fs');
const path = require('node:path');
const { checkSchemaPhaseReadiness } = require('./parent-schema-verifier');

/*
 * Manual migration runner shared by the three parent rollout phases.
 * Verification is performed on the transaction's client, so a failed
 * readiness check can never be mistaken for a successful migration.
 */
async function runParentPhaseMigration({
  database,
  phase,
  migrationFiles,
  successMessage,
}) {
  if (!database) throw new Error('A database handle is required');
  const pool = database.pool || database;
  let client;
  let committed = false;
  let primaryError;
  const rememberError = (error) => {
    if (!primaryError) {
      primaryError = error;
    } else {
      primaryError.cleanupErrors = [...(primaryError.cleanupErrors || []), error];
    }
  };

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const migrationFile of migrationFiles) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', migrationFile), 'utf8');
      await client.query(sql);
    }
    const readiness = await checkSchemaPhaseReadiness(client, phase);
    if (readiness.status !== 'APPLIED') {
      throw new Error(
        `${phase} verification failed: ${readiness.missing.join('; ') || 'missing schema objects'}`,
      );
    }
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    // Keep the migration/query/verification/commit error authoritative. Any
    // cleanup failures are attached below rather than replacing it.
    rememberError(error);
  } finally {
    if (client && !committed) {
      try {
        await client.query('ROLLBACK');
      } catch (error) {
        rememberError(error);
      }
    }
    if (client) {
      try {
        await client.release();
      } catch (error) {
        rememberError(error);
      }
    }
    try {
      if (typeof pool.end === 'function') await pool.end();
    } catch (error) {
      rememberError(error);
    }
  }

  if (primaryError) throw primaryError;
  // This is deliberately after commit and all cleanup. A release/end failure
  // therefore cannot produce a misleading "applied" message.
  console.log(successMessage);
}

module.exports = { runParentPhaseMigration };