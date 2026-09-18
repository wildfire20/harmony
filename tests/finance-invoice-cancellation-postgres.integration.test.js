/*
 * Real PostgreSQL regression coverage for the one-time September cancellation.
 * The explicit Finance test URL must point to a disposable database. Every run
 * creates and drops its own random schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const {
  execute,
  readCandidates,
  sha256,
  EXPECTED_INVOICE_IDS,
} = require('../scripts/cancel-september-grade2-test-invoices');

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;
const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

function schemaUrl(url, schema) {
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-csearch_path=${schema}`);
  return scoped.toString();
}

async function installFixture(pool, schema) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schema)}`);
    await client.query(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        student_number VARCHAR(50),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(30) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES users(id),
        student_number VARCHAR(50),
        amount_due NUMERIC(12,2) NOT NULL,
        amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
        due_date DATE,
        status VARCHAR(40) NOT NULL,
        description TEXT,
        invoice_kind VARCHAR(40),
        invoice_source VARCHAR(80),
        finance_origin VARCHAR(40),
        billing_period DATE,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT invoices_status_check
          CHECK (status IN ('Unpaid','Partial','Paid','Overpaid','Carried Forward','Cancelled'))
      );
      CREATE TABLE student_one_off_fees (
        id INTEGER PRIMARY KEY,
        student_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false
      );
      CREATE TABLE invoice_line_items (
        id INTEGER PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        amount NUMERIC(12,2) NOT NULL,
        metadata JSONB NOT NULL
      );
      CREATE TABLE payment_transactions (
        id INTEGER PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(id),
        student_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(12,2) NOT NULL,
        reverses_transaction_id INTEGER UNIQUE,
        allocation_category VARCHAR(50),
        transaction_date DATE NOT NULL
      );
      CREATE TABLE payment_proof_allocations (
        id INTEGER PRIMARY KEY,
        payment_transaction_id INTEGER REFERENCES payment_transactions(id),
        invoice_id INTEGER REFERENCES invoices(id),
        amount NUMERIC(12,2) NOT NULL,
        allocation_category VARCHAR(50)
      );
      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_name VARCHAR(255),
        user_role VARCHAR(50),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      INSERT INTO users (id,student_number,first_name,last_name,role)
      VALUES (1,NULL,'Synthetic','Administrator','super_admin')
    `);
    await client.query(`
      INSERT INTO users (id,student_number,first_name,last_name,role)
      SELECT id, 'SYN' || lpad(id::text,3,'0'), 'Learner', id::text, 'student'
      FROM generate_series(2,66) id
    `);
    await client.query(`
      INSERT INTO student_one_off_fees (id,student_id,name,amount,is_active)
      VALUES
        (4,2,'grade 2 fees  for fun  day',1200,false),
        (5,2,'test im tierd',300,false)
    `);
    await client.query(`
      INSERT INTO invoices
        (id,student_id,student_number,amount_due,amount_paid,due_date,status,
         description,invoice_kind,invoice_source,finance_origin,billing_period)
      VALUES (11091,66,'SYN066',2350,0,DATE '2026-09-30','Unpaid',
              NULL,NULL,NULL,NULL,NULL)
    `);
    await client.query(`
      INSERT INTO invoices
        (id,student_id,student_number,amount_due,amount_paid,due_date,status,
         description,invoice_kind,invoice_source,finance_origin,billing_period)
      SELECT id, 2 + ((id - 11355) % 59),
             'SYN' || lpad((2 + ((id - 11355) % 59))::text,3,'0'),
             CASE WHEN id < 11414 THEN 1200 ELSE 300 END,
             0,
             CASE WHEN id < 11414 THEN DATE '2026-09-24' ELSE DATE '2026-09-23' END,
             'Unpaid',NULL,NULL,NULL,NULL,NULL
      FROM generate_series(11355,11472) id
    `);
    await client.query(`
      INSERT INTO invoice_line_items (id,invoice_id,amount,metadata)
      SELECT id - 11354, id,
             CASE WHEN id < 11414 THEN 1200 ELSE 300 END,
             jsonb_build_object(
               'category','one_off',
               'fee_id',CASE WHEN id < 11414 THEN 4 ELSE 5 END
             )
      FROM generate_series(11355,11472) id
    `);
    await client.query(`
      INSERT INTO invoices
        (id,student_id,student_number,amount_due,amount_paid,due_date,status,
         description,invoice_kind,invoice_source,finance_origin,billing_period)
      SELECT id, 2 + ((id - 11473) % 59),
             'SYN' || lpad((2 + ((id - 11473) % 59))::text,3,'0'),
             CASE WHEN id=11473 THEN 2850 ELSE 2625 END,
             0, DATE '2026-10-31','Unpaid',NULL,'monthly','billing_engine',
             'canonical',DATE '2026-10-01'
      FROM generate_series(11473,11788) id
    `);
    await client.query(`
      INSERT INTO payment_transactions
        (id,invoice_id,student_id,amount,reverses_transaction_id,allocation_category,transaction_date)
      VALUES
        (2241,11445,33,300,NULL,'one_off',DATE '2026-09-23'),
        (2266,11445,33,-300,2241,'one_off',DATE '2026-09-23')
    `);
    await client.query(`
      INSERT INTO payment_proof_allocations
        (id,payment_transaction_id,invoice_id,amount,allocation_category)
      VALUES (1,2241,11445,300,'one_off')
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function snapshotProtectedData(pool) {
  const [payments, allocations, targetAmounts, protectedInvoice, october] = await Promise.all([
    pool.query(`
      SELECT id,invoice_id,student_id,amount::text,reverses_transaction_id,
             allocation_category,transaction_date::text
      FROM payment_transactions ORDER BY id
    `),
    pool.query(`
      SELECT id,payment_transaction_id,invoice_id,amount::text,allocation_category
      FROM payment_proof_allocations ORDER BY id
    `),
    pool.query(`
      SELECT id,amount_due::text,amount_paid::text
      FROM invoices
      WHERE id=ANY($1::integer[])
      ORDER BY id
    `, [EXPECTED_INVOICE_IDS]),
    pool.query(`
      SELECT id,student_id,student_number,amount_due::text,amount_paid::text,
             due_date::text,status,description,invoice_kind,finance_origin
      FROM invoices WHERE id=11091
    `),
    pool.query(`
      SELECT count(*)::integer AS invoice_count,
             COALESCE(sum(amount_due),0)::text AS total_due,
             COALESCE(sum(amount_paid),0)::text AS total_paid,
             min(id) AS min_invoice_id,max(id) AS max_invoice_id
      FROM invoices
      WHERE billing_period=DATE '2026-10-01'
        AND invoice_kind='monthly' AND finance_origin='canonical'
    `),
  ]);
  return {
    payments: payments.rows,
    allocations: allocations.rows,
    targetAmounts: targetAmounts.rows,
    protectedInvoice: protectedInvoice.rows,
    october: october.rows,
  };
}

async function runCancellationScenario() {
  const schema = `invoice_cancel_${crypto.randomBytes(8).toString('hex')}`;
  const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  let pool;
  try {
    await installFixture(adminPool, schema);
    pool = new Pool({ connectionString: schemaUrl(databaseUrl, schema), max: 4 });

    const client = await pool.connect();
    let rows;
    try {
      rows = await readCandidates(client);
    } finally {
      client.release();
    }
    assert.deepEqual(rows.map((row) => Number(row.invoice_id)), EXPECTED_INVOICE_IDS);
    const expectedHash = sha256(rows);
    const options = {
      apply: true,
      pool,
      env: { FINANCE_SEPTEMBER_CLEANUP_ADMIN_USER_ID: '1' },
      expectedPreflightSha256: expectedHash,
      logger: () => {},
    };
    const baseline = await snapshotProtectedData(pool);

    await assert.rejects(
      execute({ ...options, injectedFailure: true }),
      /Injected cancellation failure/,
    );
    const rolledBack = await pool.query(`
      SELECT count(*)::integer AS total,
             count(*) FILTER (WHERE status='Unpaid')::integer AS unpaid,
             count(*) FILTER (WHERE status='Cancelled')::integer AS cancelled
      FROM invoices WHERE id=ANY($1::integer[])
    `, [EXPECTED_INVOICE_IDS]);
    assert.deepEqual(rolledBack.rows[0], { total: 118, unpaid: 118, cancelled: 0 });
    assert.equal(
      Number((await pool.query(`
        SELECT count(*) FROM audit_logs
        WHERE action='september_test_invoices_cancelled'
      `)).rows[0].count),
      0,
    );
    assert.deepEqual(await snapshotProtectedData(pool), baseline);

    const applied = await execute(options);
    assert.equal(applied.applied, true);
    assert.equal(applied.candidateCount, 118);
    const cancelled = await pool.query(`
      SELECT count(*)::integer AS total,
             count(*) FILTER (WHERE status='Cancelled')::integer AS cancelled,
             COALESCE(sum(amount_paid),0)::text AS total_paid
      FROM invoices WHERE id=ANY($1::integer[])
    `, [EXPECTED_INVOICE_IDS]);
    assert.deepEqual(cancelled.rows[0], { total: 118, cancelled: 118, total_paid: '0.00' });

    const audit = await pool.query(`
      SELECT user_id,user_role,details
      FROM audit_logs
      WHERE action='september_test_invoices_cancelled'
    `);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].user_id, 1);
    assert.equal(audit.rows[0].user_role, 'super_admin');
    assert.equal(audit.rows[0].details.operation_key, 'cancel-september-2026-grade2-test-one-offs:v1');
    assert.equal(audit.rows[0].details.preflight_sha256, expectedHash);
    assert.deepEqual(audit.rows[0].details.invoice_ids.map(Number), EXPECTED_INVOICE_IDS);
    assert.deepEqual(await snapshotProtectedData(pool), baseline);
  } finally {
    if (pool) await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => {});
    await adminPool.end();
  }
}

if (databaseUrl) {
  test('September cancellation complete PostgreSQL apply and rollback path', {
    timeout: 120000,
  }, runCancellationScenario);
} else {
  test('September cancellation PostgreSQL integration requires FINANCE_TEST_DATABASE_URL', {
    skip: 'Use the explicit finance integration runner with FINANCE_TEST_DATABASE_URL',
  }, () => {});
}