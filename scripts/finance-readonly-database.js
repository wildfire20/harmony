const { Pool } = require('pg');

function createFinanceReadonlyPool(env = process.env) {
  const connectionString = String(env.FINANCE_READONLY_DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error(
      'FINANCE_READONLY_DATABASE_URL is required; refusing to infer a database',
    );
  }

  return new Pool({
    connectionString,
    ssl: env.FINANCE_READONLY_DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

async function beginVerifiedReadonlySession(client, logger = console.log) {
  await client.query('BEGIN READ ONLY');
  const readOnlyResult = await client.query('SHOW transaction_read_only');
  const transactionReadOnly = readOnlyResult.rows[0]?.transaction_read_only;
  if (transactionReadOnly !== 'on') {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('PostgreSQL did not enable transaction_read_only; refusing to continue');
  }

  const identityResult = await client.query(`
    SELECT current_database() AS database,
           current_schema() AS schema,
           inet_server_addr()::text AS server_address,
           inet_server_port() AS server_port
  `);
  const identity = identityResult.rows[0];
  logger([
    'Finance read-only target:',
    `database: ${identity.database}`,
    `schema: ${identity.schema}`,
    `server: ${identity.server_address || 'local'}:${identity.server_port || 'default'}`,
    `transaction_read_only: ${transactionReadOnly}`,
  ].join('\n'));

  return {
    database: identity.database,
    schema: identity.schema,
    serverAddress: identity.server_address,
    serverPort: identity.server_port,
    transactionReadOnly,
  };
}

module.exports = {
  createFinanceReadonlyPool,
  beginVerifiedReadonlySession,
};