const db = require('../config/database');

const SERVICE_KEYS = Object.freeze(['tuition', 'boarding', 'transport', 'aftercare']);
const SERVICE_KEY_SET = new Set(SERVICE_KEYS);

function normalizeServiceKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!SERVICE_KEY_SET.has(key)) {
    throw new Error(`Unsupported service enrollment category: ${key || '(empty)'}`);
  }
  return key;
}

function normalizeDate(value, field) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(text)) {
    throw new Error(`${field} must be an ISO calendar date`);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${field} must be an ISO calendar date`);
  }
  return text;
}

function periodBounds(period) {
  const text = String(period || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new Error('billing period must use YYYY-MM');
  }
  const [year, month] = text.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: `${text}-01`, end };
}

async function listEffectiveEnrollments(studentId, period, executor = db) {
  const bounds = periodBounds(period);
  const result = await executor.query(`
    SELECT id, student_id, service_key,
           effective_start::text AS effective_start,
           effective_end::text AS effective_end,
           state, idempotency_key, created_at, updated_at
    FROM service_enrollments
    WHERE student_id = $1::integer
      AND state = 'active'
      AND effective_start <= $2::date
      AND (effective_end IS NULL OR effective_end >= $3::date)
    ORDER BY service_key, effective_start, id
  `, [Number(studentId), bounds.end, bounds.start]);
  return result.rows;
}

async function listEffectiveEnrollmentsForStudents(studentIds, period, executor = db) {
  const ids = [...new Set((studentIds || []).map(Number).filter(Number.isSafeInteger))];
  if (!ids.length) return [];
  const bounds = periodBounds(period);
  const result = await executor.query(`
    SELECT id, student_id, service_key,
           effective_start::text AS effective_start,
           effective_end::text AS effective_end,
           state, idempotency_key, created_at, updated_at
    FROM service_enrollments
    WHERE student_id = ANY($1::integer[])
      AND state = 'active'
      AND effective_start <= $2::date
      AND (effective_end IS NULL OR effective_end >= $3::date)
    ORDER BY student_id, service_key, effective_start, id
  `, [ids, bounds.end, bounds.start]);
  return result.rows;
}

async function listEnrollments(studentId, executor = db) {
  const result = await executor.query(`
    SELECT id, student_id, service_key,
           effective_start::text AS effective_start,
           effective_end::text AS effective_end,
           state, idempotency_key, created_at, updated_at
    FROM service_enrollments
    WHERE student_id = $1::integer
    ORDER BY effective_start, service_key, id
  `, [Number(studentId)]);
  return result.rows;
}

async function createEnrollment(input, executor = db) {
  const studentId = Number(input?.studentId ?? input?.student_id);
  if (!Number.isSafeInteger(studentId) || studentId < 1) {
    throw new Error('studentId is required');
  }
  const serviceKey = normalizeServiceKey(input?.serviceKey ?? input?.service_key);
  const effectiveStart = normalizeDate(
    input?.effectiveStart ?? input?.effective_start,
    'effectiveStart',
  );
  const endInput = input?.effectiveEnd ?? input?.effective_end;
  const effectiveEnd = endInput
    ? normalizeDate(endInput, 'effectiveEnd')
    : null;
  if (effectiveEnd && effectiveEnd < effectiveStart) {
    throw new Error('effectiveEnd cannot precede effectiveStart');
  }
  const state = input?.state || 'active';
  if (!['active', 'ended', 'cancelled'].includes(state)) {
    throw new Error('Invalid service enrollment state');
  }
  const rawIdempotencyKey = input?.idempotencyKey ?? input?.idempotency_key;
  const idempotencyKey = rawIdempotencyKey == null || String(rawIdempotencyKey).trim() === ''
    ? null
    : String(rawIdempotencyKey).trim();

  if (idempotencyKey) {
    const existingByKey = await executor.query(`
      SELECT id, student_id, service_key,
             effective_start::text AS effective_start,
             effective_end::text AS effective_end,
             state, idempotency_key, created_at, updated_at
      FROM service_enrollments
      WHERE idempotency_key = $1
    `, [idempotencyKey]);
    if (existingByKey.rows.length) return existingByKey.rows[0];
  }

  // A caller may use this repository with a transaction-bound client.  The
  // overlap check is intentionally explicit: historical dates are never
  // inferred or silently merged.
  const overlap = await executor.query(`
    SELECT id
    FROM service_enrollments
    WHERE student_id = $1::integer
      AND service_key = $2
      AND state = 'active'
      AND effective_start <= COALESCE($4::date, 'infinity'::date)
      AND COALESCE(effective_end, 'infinity'::date) >= $3::date
      AND NOT (effective_start = $3::date AND idempotency_key IS NOT DISTINCT FROM $5)
    LIMIT 1
  `, [studentId, serviceKey, effectiveStart, effectiveEnd, idempotencyKey]);
  if (overlap.rows.length) {
    throw new Error('An active enrollment overlaps the requested effective period');
  }

  const inserted = await executor.query(`
    INSERT INTO service_enrollments
      (student_id, service_key, effective_start, effective_end, state, idempotency_key)
    VALUES ($1::integer, $2, $3::date, $4::date, $5, $6)
    ON CONFLICT (student_id, service_key, effective_start) DO NOTHING
    RETURNING id, student_id, service_key,
              effective_start::text AS effective_start,
              effective_end::text AS effective_end,
              state, idempotency_key, created_at, updated_at
  `, [studentId, serviceKey, effectiveStart, effectiveEnd, state, idempotencyKey]);
  if (inserted.rows.length) return inserted.rows[0];
  const existing = await executor.query(`
    SELECT id, student_id, service_key,
           effective_start::text AS effective_start,
           effective_end::text AS effective_end,
           state, idempotency_key, created_at, updated_at
    FROM service_enrollments
    WHERE student_id = $1::integer AND service_key = $2
      AND effective_start = $3::date
  `, [studentId, serviceKey, effectiveStart]);
  return existing.rows[0] || null;
}

async function endEnrollment(id, effectiveEnd, executor = db) {
  const end = normalizeDate(effectiveEnd, 'effectiveEnd');
  const result = await executor.query(`
    UPDATE service_enrollments
    SET effective_end = $2::date, state = 'ended', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::integer AND state = 'active'
    RETURNING id, student_id, service_key,
              effective_start::text AS effective_start,
              effective_end::text AS effective_end,
              state, idempotency_key, created_at, updated_at
  `, [Number(id), end]);
  return result.rows[0] || null;
}

module.exports = {
  SERVICE_KEYS,
  normalizeServiceKey,
  normalizeDate,
  periodBounds,
  listEffectiveEnrollments,
  listEffectiveEnrollmentsForStudents,
  getEffectiveEnrollments: listEffectiveEnrollments,
  getEffectiveEnrollmentsForLearners: listEffectiveEnrollmentsForStudents,
  findEffectiveEnrollments: listEffectiveEnrollments,
  findForBillingPeriod: listEffectiveEnrollments,
  listEnrollments,
  createEnrollment,
  createServiceEnrollment: createEnrollment,
  endEnrollment,
};