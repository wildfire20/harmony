/*
 * Disposable coverage for the controlled population.  It is deliberately
 * opt-in: no development or production DATABASE_URL is accepted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { execute } = require('../scripts/populate-october-finance');
const { getMonthlyBillingReadiness } = require('../services/monthlyBillingReadiness');

const url = process.env.FINANCE_TEST_DATABASE_URL;
const run = url ? test : test.skip;

function isolatedPool(schema) {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-csearch_path=${schema}`);
  return new Pool({ connectionString: parsed.toString(), max: 1 });
}

function fixture(file) {
  const proposals = [
    { student_id: 2, student_number: 'T001', student_name: 'Test One', service_key: 'tuition', effective_start: '2026-10-01' },
    { student_id: 3, student_number: 'T002', student_name: 'Test Two', service_key: 'tuition', effective_start: '2026-10-01' },
  ].map((p) => ({ ...p, source: 'active_student', policy_source: 'active_student', status: 'proposal', review_required: true, reason: 'required by effective-date policy', existing_state: null }));
  const discounts = [
    { student_id: 2, student_number: 'T001', discount_type: 'staff', calculation_method: 'percentage', amount: 0, percentage: 50, applicable_service_key: 'tuition', starts_on: '2026-10-01', source: 'legacy_indicator', status: 'proposal', reason: 'explicit assignment proposed from legacy indicator' },
    { student_id: 3, student_number: 'T002', discount_type: 'sibling', calculation_method: 'fixed', amount: 100, percentage: null, applicable_service_key: 'tuition', starts_on: '2026-10-01', source: 'legacy_indicator', status: 'proposal', reason: 'explicit assignment proposed from legacy indicator' },
  ];
  const manifest = {
    preview: true, readOnly: true, transaction_read_only: 'on', effective_start: '2026-10-01',
    proposals, prices: [
      { service_key: 'tuition', required: { amount: 2350, billing_mode: 'standalone', bundle_key: null, included_service_keys: [] } },
      { service_key: 'boarding', required: { amount: 1600, billing_mode: 'bundle', bundle_key: 'harmony_boarding_package', included_service_keys: ['transport', 'aftercare'] } },
      { service_key: 'transport', required: { amount: 650, billing_mode: 'standalone', bundle_key: null, included_service_keys: [] } },
      { service_key: 'aftercare', required: { amount: 550, billing_mode: 'standalone', bundle_key: null, included_service_keys: [] } },
    ],
    discounts: { explicit: [], proposals: discounts, suppressed_sibling_count: 0, suppressed_sibling_learners: [] },
    learner_lists: {}, package_examples: {},
    summary: { active_learners: 2, proposal_rows: 2, already_effective: 0, new_proposals: 2, changes_required: 0, gross_total: 2350, by_service: { tuition: 2 } },
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
}

run('controlled October population applies exact rows, retries, and plans without persistence', async () => {
  const schema = `october_test_${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(os.tmpdir(), `${schema}.json`);
  fixture(file);
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  const pool = isolatedPool(schema);
  try {
    await pool.query(`
      CREATE TABLE users (id integer primary key, student_number text, first_name text, last_name text,
        role text, is_active boolean, is_boarder boolean default false, uses_transport boolean default false,
        uses_aftercare boolean default false, has_teacher_discount boolean default false, has_sibling_discount boolean default false);
      CREATE TABLE service_prices (service_key text primary key, amount numeric, billing_mode text,
        bundle_key text, included_service_keys jsonb, label text, display_order integer);
      CREATE TABLE service_enrollments (id serial primary key, student_id integer, service_key text,
        effective_start date, effective_end date, state text, idempotency_key text unique);
      CREATE TABLE learner_discount_assignments (id serial primary key, student_id integer, discount_type text,
        calculation_method text, amount numeric, percentage numeric, applicable_service_key text, starts_on date,
        ends_on date, reason text not null, approved_by integer, is_active boolean,
        CHECK ((calculation_method='fixed' AND amount IS NOT NULL AND percentage IS NULL) OR
               (calculation_method='percentage' AND percentage IS NOT NULL AND amount IS NULL)));
      CREATE TABLE audit_logs (id serial primary key, user_id integer, user_name text, user_role text,
        action text not null, entity_type text, entity_id integer, details jsonb, created_at timestamp default now());
      INSERT INTO users VALUES (1,'ADMIN','Admin','User','super_admin',true,false,false,false,false,false),
        (2,'T001','Test','One','student',true,false,false,false,true,false),
        (3,'T002','Test','Two','student',true,false,false,false,false,true);
      INSERT INTO service_prices VALUES
        ('tuition',2350,'standalone',NULL,'[]','Tuition',1), ('boarding',1600,'bundle','harmony_boarding_package','["transport","aftercare"]','Boarding',2),
        ('transport',650,'standalone',NULL,'[]','Transport',3), ('aftercare',550,'standalone',NULL,'[]','Aftercare',4);
    `);
    const options = { manifestPath: file, allowFixture: true, pool, logger: () => {} };
    const planned = await execute({ ...options, apply: false, env: {} });
    assert.equal(planned.plan, true);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '0');
    const first = await execute({ ...options, apply: true, env: {} });
    assert.equal(first.applied, true);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '2');
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '2');
    const staff = await pool.query(`SELECT amount FROM learner_discount_assignments WHERE discount_type='staff'`);
    assert.equal(staff.rows[0].amount, null);
    const audits = await pool.query('SELECT details FROM audit_logs');
    assert.equal(audits.rowCount, 1);
    assert.equal(audits.rows[0].details.actor.id, 1);
    assert.equal(audits.rows[0].details.actor.role, 'super_admin');
    assert.equal(audits.rows[0].details.enrollment_ids.length, 2);
    assert.equal(audits.rows[0].details.discount_ids.length, 2);
    assert.equal((await getMonthlyBillingReadiness('2026-10', pool)).ready, true);
    assert.equal((await execute({ ...options, apply: true, env: {} })).noop, true);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '2');
    await pool.query('DELETE FROM audit_logs; DELETE FROM learner_discount_assignments; DELETE FROM service_enrollments;');
    await assert.rejects(() => execute({ ...options, apply: true, injectedFailure: true, env: {} }));
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count, '0');

    await pool.query(`INSERT INTO users VALUES
      (4,'T003','Changed','Roster','student',true,false,false,false,false,false)`);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Active roster IDs\/student numbers differ/);
    await pool.query('DELETE FROM users WHERE id=4');

    await pool.query(`UPDATE service_prices SET amount=999 WHERE service_key='tuition'`);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Approved price policy mismatch/);
    await pool.query(`UPDATE service_prices SET amount=2350 WHERE service_key='tuition'`);

    const changedManifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    changedManifest.proposals[0].student_name = 'Changed Identity';
    fs.writeFileSync(file, JSON.stringify(changedManifest));
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Active roster IDs\/student numbers differ/);
    fixture(file);

    await pool.query(`INSERT INTO service_enrollments
      (student_id,service_key,effective_start,effective_end,state,idempotency_key)
      VALUES (2,'tuition','2026-10-01',NULL,'active','unexpected-conflict')`);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Conflicting or partial October enrollment state/);
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count, '0');
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: url });
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.end();
    fs.rmSync(file, { force: true });
  }
});
