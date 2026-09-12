/*
 * Shared, read-only schema readiness entry point.
 *
 * The implementation lives in the preflight module for backwards
 * compatibility with its public exports.  It is loaded lazily so migration
 * runners can use exactly the same checks without loading application startup
 * code (or opening a database connection).
 */
function implementation() {
  // eslint-disable-next-line global-require
  const preflight = require('./audit-parent-rollout-preflight');
  return preflight._checkSchemaReadinessInternal;
}

async function checkSchemaReadiness(client) {
  return implementation()(client);
}

async function checkSchemaPhaseReadiness(client, phase) {
  const result = await checkSchemaReadiness(client);
  if (!Object.prototype.hasOwnProperty.call(result.readiness, phase)) {
    throw new Error(`Unknown parent schema phase: ${phase}`);
  }
  return result.readiness[phase];
}

module.exports = { checkSchemaReadiness, checkSchemaPhaseReadiness };