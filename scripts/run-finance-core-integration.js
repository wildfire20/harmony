#!/usr/bin/env node
/*
 * Explicit release-gate runner.  Never infer a database from DATABASE_URL,
 * PG*, or the application's development defaults.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (!String(process.env.FINANCE_TEST_DATABASE_URL || '').trim()) {
  console.error(
    'Finance PostgreSQL release gate refused: set FINANCE_TEST_DATABASE_URL to a disposable test database.',
  );
  process.exitCode = 2;
} else {
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      path.join(__dirname, '..', 'tests', 'finance-core-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'payment-correction-disposition-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'finance-invoice-cancellation-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'admin-discount-assignments-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'parent-admin-contact-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'parent-enquiries-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'learner-behaviour-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'class-attendance-postgres.integration.test.js'),
      path.join(__dirname, '..', 'tests', 'parent-reregistration-postgres.integration.test.js'),
    ],
    { stdio: 'inherit', env: process.env },
  );
  process.exitCode = result.status == null ? 1 : result.status;
}
