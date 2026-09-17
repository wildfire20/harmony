/*
 * Controlled October 2026 finance population.
 *
 * The preview is an immutable contract.  This command intentionally has two
 * different connection variables: planning can only use the read-only target,
 * while --apply requires the explicitly named apply target.
 */
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  createFinanceReadonlyPool,
  beginVerifiedReadonlySession,
} = require('./finance-readonly-database');
const { getMonthlyBillingReadiness } = require('../services/monthlyBillingReadiness');

const MANIFEST_PATH = 'private_backups/october-preview-after-boarding-M9Enle.json';
const MANIFEST_SHA256 = '3d0449f275ac2acbada3a41f606b7df64135700a464fcc83b4d9f71eb8c2f392';
const OPERATION_KEY = `finance-october-2026:${MANIFEST_SHA256}`;
const AUDIT_ACTION = 'finance_october_population';
const REASON = 'Approved October 2026 finance bootstrap; controlled population from approved preview';

function readManifest(path = MANIFEST_PATH, { allowFixture = false } = {}) {
  const bytes = fs.readFileSync(path);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!allowFixture && hash !== MANIFEST_SHA256) {
    throw new Error(`Approved October preview hash mismatch (expected ${MANIFEST_SHA256}, got ${hash})`);
  }
  const manifest = JSON.parse(bytes);
  const enrollmentKeys = manifest.proposals.map((p) => `${p.student_id}:${p.service_key}:${p.effective_start}`);
  const discountKeys = manifest.discounts.proposals.map((p) => `${p.student_id}:${p.discount_type}:${p.applicable_service_key}:${p.starts_on}`);
  const serviceCounts = manifest.proposals.reduce((a, p) => ({ ...a, [p.service_key]: (a[p.service_key] || 0) + 1 }), {});
  const staff = manifest.discounts.proposals.filter((p) => p.discount_type === 'staff');
  const siblings = manifest.discounts.proposals.filter((p) => p.discount_type === 'sibling');
  if (manifest.effective_start !== '2026-10-01' ||
      manifest.summary.new_proposals !== manifest.proposals.length ||
      manifest.summary.already_effective !== 0 ||
      manifest.summary.changes_required !== 0 ||
      new Set(enrollmentKeys).size !== enrollmentKeys.length ||
      new Set(discountKeys).size !== discountKeys.length ||
      (!allowFixture && (staff.length !== 1 || siblings.length !== 5)) ||
      !same(serviceCounts, { tuition: 316, boarding: 51, transport: 57, aftercare: 57 }) && !allowFixture) {
    throw new Error('Approved October preview has unexpected semantics');
  }
  return { manifest, hash };
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const pathArg = argv.find((arg) => arg.startsWith('--manifest='));
  return { apply, manifestPath: pathArg ? pathArg.slice(11) : MANIFEST_PATH };
}

function poolFor(env, apply) {
  if (!apply) return createFinanceReadonlyPool(env);
  const url = String(env.FINANCE_OCTOBER_APPLY_DATABASE_URL || '').trim();
  if (!url) throw new Error('FINANCE_OCTOBER_APPLY_DATABASE_URL is required with --apply; refusing to infer a database');
  return new Pool({ connectionString: url, ssl: env.FINANCE_OCTOBER_APPLY_DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 1 });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stable = (value) => JSON.stringify(value, (key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.keys(item).sort().reduce((out, k) => { out[k] = item[k]; return out; }, {});
  }
  return item;
});
function expectedEnrollments(manifest) {
  return manifest.proposals.map((p) => ({
    student_id: Number(p.student_id), student_number: p.student_number,
    service_key: p.service_key, effective_start: p.effective_start,
  }));
}
function expectedDiscounts(manifest) {
  return manifest.discounts.proposals.map((p) => ({
    student_id: Number(p.student_id), student_number: p.student_number,
    discount_type: p.discount_type, calculation_method: p.calculation_method,
    // The historical preview serializer emitted 0 for percentage discounts;
    // the canonical row must use NULL (the real table CHECK requires it).
    amount: p.discount_type === 'staff' ? null : (p.amount == null ? null : Number(p.amount)),
    percentage: p.percentage == null ? null : Number(p.percentage),
    applicable_service_key: p.applicable_service_key, starts_on: p.starts_on,
    ends_on: null, approved_by: 1, reason: REASON, is_active: true,
  }));
}

async function verifyContract(client, manifest, lock = false) {
  const actor = await client.query(
    `SELECT id, first_name, last_name, role
     FROM users
     WHERE id = 1 AND is_active = true AND role = 'super_admin'${lock ? ' FOR UPDATE' : ''}`,
  );
  if (actor.rowCount !== 1) throw new Error('Required active super_admin actor id 1 is unavailable');
  const users = await client.query(`
    SELECT id AS student_id, student_number, first_name, last_name,
           COALESCE(is_boarder,false) AS is_boarder,
           COALESCE(uses_transport,false) AS uses_transport,
           COALESCE(uses_aftercare,false) AS uses_aftercare,
           COALESCE(has_teacher_discount,false) AS has_teacher_discount,
           COALESCE(has_sibling_discount,false) AS has_sibling_discount
    FROM users WHERE role = 'student' AND is_active = true ORDER BY id${lock ? ' FOR UPDATE' : ''}
  `);
  const byId = new Map(users.rows.map((u) => [Number(u.student_id), u]));
  const roster = manifest.proposals.filter((p) => p.service_key === 'tuition').map((p) => ({
    student_id: Number(p.student_id), student_number: p.student_number,
    student_name: p.student_name,
  }));
  if (roster.length !== users.rowCount || !roster.every((p) => {
    const u = byId.get(p.student_id);
    return u && u.student_number === p.student_number &&
      `${u.first_name || ''} ${u.last_name || ''}`.trim() === p.student_name;
  })) throw new Error('Active roster IDs/student numbers differ from approved preview');
  const expected = expectedEnrollments(manifest);
  const calculated = [];
  for (const u of users.rows) {
    const keys = ['tuition'];
    if (u.is_boarder) keys.push('boarding', 'transport', 'aftercare');
    else {
      if (u.uses_transport) keys.push('transport');
      if (u.uses_aftercare) keys.push('aftercare');
    }
    for (const key of [...new Set(keys)]) calculated.push({
      student_id: Number(u.student_id), student_number: u.student_number,
      service_key: key, effective_start: manifest.effective_start,
    });
  }
  if (!same(calculated, expected)) throw new Error('Legacy selections/service assignments differ from approved preview');
  const discounts = expectedDiscounts(manifest);
  const calculatedDiscounts = users.rows.flatMap((u) => {
    const rows = [];
    if (u.has_teacher_discount) rows.push({ student_id: Number(u.student_id), student_number: u.student_number, discount_type: 'staff', calculation_method: 'percentage', amount: null, percentage: 50, applicable_service_key: 'tuition', starts_on: manifest.effective_start, ends_on: null, approved_by: 1, reason: REASON, is_active: true });
    if (u.has_sibling_discount) rows.push({ student_id: Number(u.student_id), student_number: u.student_number, discount_type: 'sibling', calculation_method: 'fixed', amount: 100, percentage: null, applicable_service_key: 'tuition', starts_on: manifest.effective_start, ends_on: null, approved_by: 1, reason: REASON, is_active: true });
    return rows;
  });
  if (!same(calculatedDiscounts, discounts)) throw new Error('Legacy discount selections differ from approved preview');
  const prices = await client.query(`SELECT service_key, amount, billing_mode, bundle_key, included_service_keys FROM service_prices WHERE service_key = ANY($1::text[]) ORDER BY service_key${lock ? ' FOR SHARE' : ''}`, [['tuition', 'boarding', 'transport', 'aftercare']]);
  for (const entry of manifest.prices) {
    const required = entry.required;
    const row = prices.rows.find((p) => p.service_key === entry.service_key);
    const included = Array.isArray(row?.included_service_keys) ? row.included_service_keys : JSON.parse(row?.included_service_keys || '[]');
    if (!row || Number(row.amount) !== Number(required.amount) || (row.billing_mode || 'standalone') !== required.billing_mode ||
      (row.bundle_key || null) !== (required.bundle_key || null) || !same(included, required.included_service_keys)) {
      throw new Error(`Approved price policy mismatch for ${entry.service_key}`);
    }
  }
  return { actor: actor.rows[0], users: users.rows, expected, discounts };
}

async function existingState(client, manifest) {
  const start = manifest.effective_start;
  const e = await client.query(`SELECT id, student_id, service_key, effective_start::text AS effective_start, effective_end::text AS effective_end, state, idempotency_key FROM service_enrollments WHERE effective_start = $1::date OR idempotency_key LIKE $2 ORDER BY id FOR UPDATE`, [start, `${OPERATION_KEY}:%`]);
  const d = await client.query(`SELECT id, student_id, discount_type, calculation_method, amount, percentage, applicable_service_key, starts_on::text AS starts_on, ends_on::text AS ends_on, approved_by, reason, is_active FROM learner_discount_assignments WHERE starts_on = $1::date OR reason = $2 ORDER BY id FOR UPDATE`, [start, REASON]);
  return { enrollments: e.rows, discounts: d.rows };
}

function assertState(state, contract, manifest) {
  const enrollmentPayload = (r) => ({
    student_id: Number(r.student_id), service_key: r.service_key, effective_start: r.effective_start,
    effective_end: r.effective_end || null, state: r.state, idempotency_key: r.idempotency_key,
  });
  const expectedEnrollmentPayload = contract.expected.map((r) => ({
    student_id: r.student_id, service_key: r.service_key, effective_start: manifest.effective_start,
    effective_end: null, state: 'active',
    idempotency_key: `${OPERATION_KEY}:${r.student_id}:${r.service_key}`,
  }));
  if (state.enrollments.length && !same(state.enrollments.map(enrollmentPayload), expectedEnrollmentPayload)) {
    throw new Error('Conflicting or partial October enrollment state');
  }
  const discountPayload = (r) => ({
    student_id: Number(r.student_id), discount_type: r.discount_type, calculation_method: r.calculation_method,
    amount: r.amount == null ? null : Number(r.amount), percentage: r.percentage == null ? null : Number(r.percentage),
    applicable_service_key: r.applicable_service_key, starts_on: r.starts_on, ends_on: r.ends_on || null,
    approved_by: Number(r.approved_by), reason: r.reason, is_active: r.is_active,
  });
  const expectedDiscountPayload = contract.discounts.map((row) => {
    const payload = { ...row };
    delete payload.student_number;
    return payload;
  });
  if (state.discounts.length && !same(state.discounts.map(discountPayload), expectedDiscountPayload)) {
    throw new Error('Conflicting or partial October discount state');
  }
}

async function execute({ env = process.env, apply = false, manifestPath = MANIFEST_PATH, logger = console.log, injectedFailure = false, allowFixture = false, pool: suppliedPool = null } = {}) {
  const { manifest, hash } = readManifest(manifestPath, { allowFixture });
  const pool = suppliedPool || poolFor(env, apply);
  const ownsPool = !suppliedPool;
  const client = await pool.connect();
  try {
    if (!apply) {
      const session = await beginVerifiedReadonlySession(client, () => {});
      await verifyContract(client, manifest);
      await client.query('ROLLBACK');
      logger(JSON.stringify({ plan: true, transaction_read_only: session.transactionReadOnly, manifest_sha256: hash, operation_key: OPERATION_KEY, enrollments: manifest.proposals.length, discounts: manifest.discounts.proposals.length }));
      return { plan: true };
    }
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'`);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [OPERATION_KEY]);
    const contract = await verifyContract(client, manifest, true);
    const state = await existingState(client, manifest);
    assertState(state, contract, manifest);
    const priorAudit = await client.query(`SELECT user_id, user_role, details FROM audit_logs WHERE action = $1 AND details->>'operation_key' = $2 FOR UPDATE`, [AUDIT_ACTION, OPERATION_KEY]);
    if (priorAudit.rowCount) {
      if (priorAudit.rowCount !== 1 ||
          state.enrollments.length !== contract.expected.length ||
          state.discounts.length !== contract.discounts.length) throw new Error('Completed audit has incomplete rows');
      const details = priorAudit.rows[0].details || {};
      const expectedEnrollmentIds = state.enrollments.map((row) => Number(row.id));
      const expectedDiscountIds = state.discounts.map((row) => Number(row.id));
      const idsEqual = (a, b) => same((a || []).map(Number).sort((x, y) => x - y), (b || []).map(Number).sort((x, y) => x - y));
      if (Number(priorAudit.rows[0].user_id) !== 1 ||
          priorAudit.rows[0].user_role !== 'super_admin' ||
          details.actor?.id !== 1 ||
          details.actor?.role !== 'super_admin' ||
          details.preview_sha256 !== hash ||
          details.effective_start !== manifest.effective_start ||
          !idsEqual(details.enrollment_ids, expectedEnrollmentIds) ||
          !idsEqual(details.discount_ids, expectedDiscountIds) ||
          stable(details.assignments) !== stable(contract.discounts)) {
        throw new Error('Completed audit evidence does not match the approved October population');
      }
      await client.query('ROLLBACK');
      return { applied: false, noop: true };
    }
    if (state.enrollments.length || state.discounts.length) throw new Error('Unexpected pre-existing effective October rows');
    const enrollmentIds = [];
    for (const row of contract.expected) {
      const result = await client.query(`INSERT INTO service_enrollments (student_id, service_key, effective_start, effective_end, state, idempotency_key) VALUES ($1,$2,$3,NULL,'active',$4) RETURNING id`, [row.student_id, row.service_key, row.effective_start, `${OPERATION_KEY}:${row.student_id}:${row.service_key}`]);
      enrollmentIds.push(result.rows[0].id);
    }
    const discountIds = [];
    for (const row of contract.discounts) {
      const result = await client.query(`INSERT INTO learner_discount_assignments (student_id, discount_type, calculation_method, amount, percentage, applicable_service_key, starts_on, ends_on, reason, approved_by, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,1,true) RETURNING id`, [row.student_id, row.discount_type, row.calculation_method, row.amount, row.percentage, row.applicable_service_key, row.starts_on, REASON]);
      discountIds.push(result.rows[0].id);
    }
    if (injectedFailure) throw new Error('Injected late failure');
    const readiness = await getMonthlyBillingReadiness('2026-10', client);
    if (!readiness.ready) throw new Error(`October readiness failed: ${readiness.hardFailures.map((x) => x.code).join(', ')}`);
    const actorName = `${contract.actor.first_name || ''} ${contract.actor.last_name || ''}`.trim();
    await client.query(`INSERT INTO audit_logs (user_id, user_name, user_role, action, entity_type, entity_id, details) VALUES (1,$1,'super_admin',$2,'finance_october_population',NULL,$3)`, [actorName, AUDIT_ACTION, JSON.stringify({ actor: { id: 1, role: 'super_admin' }, operation_key: OPERATION_KEY, preview_sha256: hash, effective_start: manifest.effective_start, reason: REASON, enrollment_ids: enrollmentIds, discount_ids: discountIds, assignments: contract.discounts })]);
    await client.query('COMMIT');
    return { applied: true, enrollmentIds, discountIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); if (ownsPool) await pool.end(); }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  execute({ apply: args.apply, manifestPath: args.manifestPath }).catch((error) => {
    console.error(`October finance population failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { execute, readManifest, expectedEnrollments, expectedDiscounts, OPERATION_KEY, MANIFEST_SHA256, REASON };