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
const { execute, parseArgs, readManifest } = require('../scripts/populate-october-finance');
const { getMonthlyBillingReadiness } = require('../services/monthlyBillingReadiness');

const url = process.env.FINANCE_TEST_DATABASE_URL;
const run = url ? test : test.skip;

test('October CLI rejects every option except --apply and validates manifest hash', () => {
  assert.deepEqual(parseArgs([]), { apply: false, manifestPath: 'private_backups/october-preview-after-boarding-M9Enle.json' });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, manifestPath: 'private_backups/october-preview-after-boarding-M9Enle.json' });
  assert.throws(() => parseArgs(['--manifest=x']), /Usage/);
  assert.throws(() => parseArgs(['--unknown']), /Usage/);
  const bad = path.join(os.tmpdir(), `october-bad-${crypto.randomBytes(6).toString('hex')}.json`);
  fs.writeFileSync(bad, '{}');
  assert.throws(() => readManifest(bad), /hash mismatch/);
  fs.rmSync(bad, { force: true });
});

function isolatedPool(schema) {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-csearch_path=${schema}`);
  return new Pool({ connectionString: parsed.toString(), max: 1 });
}

async function installFinanceMigrations(pool, schema) {
  // Keep this disposable suite on the same production-shaped base fixture as
  // the finance-core integration suite, then execute the real migrations.
  const source = fs.readFileSync(path.join(__dirname, 'finance-core-postgres.integration.test.js'), 'utf8');
  const base = source.match(/const baseSchema = `([\s\S]*?)`;\n\nconst seedPrices/)[1];
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(base);
    await client.query('ALTER TABLE learner_discount_assignments ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT');
    await client.query('ALTER TABLE learner_discount_assignments ALTER COLUMN amount DROP NOT NULL');
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mini_phase1_finance_truth.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'finance_core_architecture.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'finance_operations_readiness_v3.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'finance_billing_policy_readiness_v4.sql'), 'utf8'));
  } finally { client.release(); }
}

function fixture(file) {
  const learners = Array.from({ length: 316 }, (_, i) => ({ student_id: i + 2, student_number: `S${String(i + 1).padStart(3, '0')}`, student_name: `Synthetic Learner ${i + 1}`, boarder: i < 51, transport: i < 51 || (i >= 51 && i < 57), aftercare: i < 51 || (i >= 57 && i < 63) }));
  const proposals = learners.flatMap((p) => {
    const keys = ['tuition']; if (p.boarder) keys.push('boarding', 'transport', 'aftercare');
    else { if (p.transport) keys.push('transport'); if (p.aftercare) keys.push('aftercare'); }
    return keys.map((service_key) => ({ ...p, service_key, effective_start: '2026-10-01', source: 'active_student', policy_source: 'active_student', status: 'proposal', review_required: true, reason: 'required by effective-date policy', existing_state: null }));
  });
  const discounts = [
    { ...learners[0], discount_type: 'staff', calculation_method: 'percentage', amount: 0, percentage: 50, applicable_service_key: 'tuition', starts_on: '2026-10-01' },
    ...learners.slice(1, 6).map((p) => ({ ...p, discount_type: 'sibling', calculation_method: 'fixed', amount: 100, percentage: null, applicable_service_key: 'tuition', starts_on: '2026-10-01' })),
  ].map((p) => ({ ...p, source: 'legacy_indicator', status: 'proposal', reason: 'explicit assignment proposed from legacy indicator' }));
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
    summary: { active_learners: 316, proposal_rows: proposals.length, already_effective: 0, new_proposals: proposals.length, changes_required: 0, gross_total: 2350 * 316, by_service: { tuition: 316, boarding: 51, transport: 57, aftercare: 57 } },
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
    await installFinanceMigrations(pool, schema);
    await pool.query(`INSERT INTO users (id,student_number,first_name,last_name,role,is_active,is_boarder,uses_transport,uses_aftercare,has_teacher_discount,has_sibling_discount)
      VALUES (1,'ADMIN','Synthetic','Administrator','super_admin',true,false,false,false,false,false)`);
    const learners = Array.from({ length: 316 }, (_, i) => `(${i + 2},'S${String(i + 1).padStart(3, '0')}','Synthetic','Learner ${i + 1}','student',true,${i < 51},${i < 51 || (i >= 51 && i < 57)},${i < 51 || (i >= 57 && i < 63)},${i === 0},${i > 0 && i < 6})`).join(',');
    await pool.query(`INSERT INTO users (id,student_number,first_name,last_name,role,is_active,is_boarder,uses_transport,uses_aftercare,has_teacher_discount,has_sibling_discount) VALUES ${learners}`);
    await pool.query(`INSERT INTO service_prices (service_key,amount,billing_mode,bundle_key,included_service_keys,label,display_order) VALUES
      ('tuition',2350,'standalone',NULL,'[]','Tuition',1),('boarding',1600,'bundle','harmony_boarding_package','["transport","aftercare"]','Boarding',2),('transport',650,'standalone',NULL,'[]','Transport',3),('aftercare',550,'standalone',NULL,'[]','Aftercare',4)`);
    const options = { manifestPath: file, allowFixture: true, pool, logger: () => {} };
    const planned = await execute({ ...options, apply: false, env: {} });
    assert.equal(planned.plan, true);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '0');
    const first = await execute({ ...options, apply: true, env: {} });
    assert.equal(first.applied, true);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '481');
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '6');
    const staff = await pool.query(`SELECT amount FROM learner_discount_assignments WHERE discount_type='staff'`);
    assert.equal(staff.rows[0].amount, null);
    const audits = await pool.query('SELECT details FROM audit_logs');
    assert.equal(audits.rowCount, 1);
    assert.equal(audits.rows[0].details.actor.id, 1);
    assert.equal(audits.rows[0].details.actor.role, 'super_admin');
    assert.equal(audits.rows[0].details.enrollment_ids.length, 481);
    assert.equal(audits.rows[0].details.discount_ids.length, 6);
    assert.equal((await getMonthlyBillingReadiness('2026-10', pool)).ready, true);
    const completedPlan = await execute({ ...options, apply: false, env: {} });
    assert.equal(completedPlan.status, 'verified_completed_noop');
    assert.equal(completedPlan.noop, true);
    assert.equal((await execute({ ...options, apply: true, env: {} })).noop, true);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '481');
    await pool.query('DELETE FROM audit_logs; DELETE FROM learner_discount_assignments; DELETE FROM service_enrollments;');
    await assert.rejects(() => execute({ ...options, apply: true, injectedFailure: true, env: {} }));
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count, '0');
    await assert.rejects(() => execute({ ...options, apply: true, injectedAuditFailure: true, env: {} }), /audit insert failure/);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '0');
    await assert.rejects(() => execute({ ...options, apply: true, injectedAfterAuditFailure: true, env: {} }), /after verified audit/);
    assert.equal((await pool.query('SELECT count(*) FROM service_enrollments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count, '0');

    await pool.query(`INSERT INTO users (id,student_number,first_name,last_name,role,is_active)
      VALUES (400,'S400','Changed','Roster','student',true)`);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Active roster IDs\/student numbers differ/);
    await pool.query('DELETE FROM users WHERE id=400');

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
    await assert.rejects(() => execute({ ...options, apply: false, env: {} }),
      /Conflicting|Partial|partial|Overlapping/);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Conflicting or partial October enrollment state/);
    assert.equal((await pool.query('SELECT count(*) FROM learner_discount_assignments')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count, '0');
    await pool.query(`DELETE FROM service_enrollments`);

    await pool.query(`INSERT INTO service_enrollments
      (student_id,service_key,effective_start,effective_end,state,idempotency_key)
      VALUES (2,'tuition','2026-09-01','2026-10-01','ended','pre-october-conflict')`);
    await assert.rejects(() => execute({ ...options, apply: false, env: {} }),
      /Overlapping enrollment conflicts/);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }),
      /Overlapping enrollment conflicts/);
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: url });
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.end();
    fs.rmSync(file, { force: true });
  }
});

// A small synthetic roster (below the 316-learner scale) reused across the
// schema-marker, altered-evidence, and concurrency checks below: these do
// not need the full dataset to exercise the guard being tested.
function smallFixture(file) {
  const learners = [
    { student_id: 2, student_number: 'S001', student_name: 'Synthetic Learner 1', boarder: false, transport: false, aftercare: false },
    { student_id: 3, student_number: 'S002', student_name: 'Synthetic Learner 2', boarder: false, transport: false, aftercare: false },
  ];
  const proposals = learners.map((p) => ({ ...p, service_key: 'tuition', effective_start: '2026-10-01', source: 'active_student', policy_source: 'active_student', status: 'proposal', review_required: true, reason: 'required by effective-date policy', existing_state: null }));
  const discounts = [{ ...learners[0], discount_type: 'staff', calculation_method: 'percentage', amount: 0, percentage: 50, applicable_service_key: 'tuition', starts_on: '2026-10-01', source: 'legacy_indicator', status: 'proposal', reason: 'explicit assignment proposed from legacy indicator' }];
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
    summary: { active_learners: 2, proposal_rows: proposals.length, already_effective: 0, new_proposals: proposals.length, changes_required: 0, gross_total: 2350 * 2, by_service: { tuition: 2 } },
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
}

async function seedSmallRoster(pool, boardingBillingMode = 'bundle') {
  await pool.query(`INSERT INTO users (id,student_number,first_name,last_name,role,is_active,is_boarder,uses_transport,uses_aftercare,has_teacher_discount,has_sibling_discount)
    VALUES (1,'ADMIN','Synthetic','Administrator','super_admin',true,false,false,false,false,false),
           (2,'S001','Synthetic','Learner 1','student',true,false,false,false,true,false),
           (3,'S002','Synthetic','Learner 2','student',true,false,false,false,false,false)`);
  // Before finance_billing_policy_readiness_v4 runs, the billing-mode CHECK
  // constraint does not accept 'bundle' yet; callers below the v4 marker
  // pass 'bundle_component' instead. The manifest's boarding price
  // requirement is never reached in that case because schema-marker
  // verification throws first.
  await pool.query(`INSERT INTO service_prices (service_key,amount,billing_mode,bundle_key,included_service_keys,label,display_order) VALUES
    ('tuition',2350,'standalone',NULL,'[]','Tuition',1),('boarding',1600,'${boardingBillingMode}','harmony_boarding_package','["transport","aftercare"]','Boarding',2),('transport',650,'standalone',NULL,'[]','Transport',3),('aftercare',550,'standalone',NULL,'[]','Aftercare',4)`);
}

run('October population rejects missing/old schema markers', async () => {
  const schema = `october_test_${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(os.tmpdir(), `${schema}.json`);
  smallFixture(file);
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  const pool = isolatedPool(schema);
  try {
    // Install only through v3 (finance_operations_readiness/finance_core_architecture
    // both land at 3, below the required >= 4 threshold).
    const source = fs.readFileSync(path.join(__dirname, 'finance-core-postgres.integration.test.js'), 'utf8');
    const base = source.match(/const baseSchema = `([\s\S]*?)`;\n\nconst seedPrices/)[1];
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(base);
      await client.query('ALTER TABLE learner_discount_assignments ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT');
      await client.query('ALTER TABLE learner_discount_assignments ALTER COLUMN amount DROP NOT NULL');
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mini_phase1_finance_truth.sql'), 'utf8'));
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'finance_core_architecture.sql'), 'utf8'));
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'finance_operations_readiness_v3.sql'), 'utf8'));
    } finally { client.release(); }
    await seedSmallRoster(pool, 'bundle_component');
    const options = { manifestPath: file, allowFixture: true, pool, logger: () => {} };
    await assert.rejects(() => execute({ ...options, apply: false, env: {} }), /schema markers .* must both be >= 4/);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }), /schema markers .* must both be >= 4/);
    await pool.query(`UPDATE finance_schema_versions SET version = 1 WHERE schema_key = 'finance_operations_readiness'`);
    await assert.rejects(() => execute({ ...options, apply: false, env: {} }), /schema markers .* must both be >= 4/);
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: url });
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.end();
    fs.rmSync(file, { force: true });
  }
});

run('October population detects altered completed rows and altered audit evidence', async () => {
  const schema = `october_test_${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(os.tmpdir(), `${schema}.json`);
  smallFixture(file);
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  const pool = isolatedPool(schema);
  try {
    await installFinanceMigrations(pool, schema);
    await seedSmallRoster(pool);
    const options = { manifestPath: file, allowFixture: true, pool, logger: () => {} };
    const first = await execute({ ...options, apply: true, env: {} });
    assert.equal(first.applied, true);

    // Tamper with a completed enrollment row's stored state.
    await pool.query(`UPDATE service_enrollments SET effective_end = '2026-10-15' WHERE id = ${first.enrollmentIds[0]}`);
    await assert.rejects(() => execute({ ...options, apply: false, env: {} }), /Conflicting or partial October enrollment state/);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }), /Conflicting or partial October enrollment state/);
    await pool.query(`UPDATE service_enrollments SET effective_end = NULL WHERE id = ${first.enrollmentIds[0]}`);

    // Tamper with the completed audit evidence itself.
    await pool.query(`UPDATE audit_logs SET details = jsonb_set(details, '{preview_sha256}', '"0000"') WHERE action = 'finance_october_population'`);
    await assert.rejects(() => execute({ ...options, apply: false, env: {} }), /Completed audit evidence does not match/);
    await assert.rejects(() => execute({ ...options, apply: true, env: {} }), /Completed audit evidence does not match/);
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: url });
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.end();
    fs.rmSync(file, { force: true });
  }
});

run('October apply blocks concurrent roster/discount writes while validating locks', async () => {
  const schema = `october_test_${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(os.tmpdir(), `${schema}.json`);
  smallFixture(file);
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();
  const pool = isolatedPool(schema);
  try {
    await installFinanceMigrations(pool, schema);
    await seedSmallRoster(pool);
    const options = { manifestPath: file, allowFixture: true, pool, logger: () => {} };
    let releaseHold;
    const held = new Promise((resolve) => { releaseHold = resolve; });
    let concurrentBlocked = false;
    const applyPromise = execute({
      ...options, apply: true, env: {},
      afterLocks: async () => {
        // While the population transaction holds its table locks, a second
        // connection attempting a conflicting write must be blocked, not
        // silently interleaved. Use separate connections and issue both
        // attempts concurrently so neither can outlive the protected
        // transaction's idle timeout.
        const rosterWriter = isolatedPool(schema);
        const discountWriter = isolatedPool(schema);
        try {
          await Promise.all([
            rosterWriter.query(`SET lock_timeout = '500ms'`),
            discountWriter.query(`SET lock_timeout = '500ms'`),
          ]);
          const [rosterAttempt, discountAttempt] = await Promise.allSettled([
            rosterWriter.query(`INSERT INTO users (id,student_number,first_name,last_name,role,is_active) VALUES (999,'S999','Concurrent','Insert','student',true)`),
            discountWriter.query(`INSERT INTO learner_discount_assignments
              (student_id,discount_type,calculation_method,amount,percentage,applicable_service_key,starts_on,reason,approved_by,is_active)
              VALUES (3,'sibling','fixed',100,NULL,'tuition','2026-10-01','concurrent insert',1,true)`),
          ]);
          assert.equal(rosterAttempt.status, 'rejected');
          assert.match(rosterAttempt.reason.message, /lock timeout|canceling statement/i);
          assert.equal(discountAttempt.status, 'rejected');
          assert.match(discountAttempt.reason.message, /lock timeout|canceling statement/i);
          concurrentBlocked = true;
        } finally {
          await Promise.all([rosterWriter.end(), discountWriter.end()]);
        }
        releaseHold();
      },
    });
    await held;
    const result = await applyPromise;
    assert.equal(result.applied, true);
    assert.equal(concurrentBlocked, true);
  } finally {
    await pool.end();
    const cleanup = new Pool({ connectionString: url });
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await cleanup.end();
    fs.rmSync(file, { force: true });
  }
});
