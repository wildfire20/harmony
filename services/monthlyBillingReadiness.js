/*
 * Read-only monthly billing preflight.
 *
 * This service deliberately has no write/fix path.  It is shared by the
 * operator endpoint and the monthly generation command so that an operator
 * sees the same blockers that the server will enforce.
 */
const db = require('../config/database');
const { periodBounds } = require('./serviceEnrollmentRepository');

const SERVICE_KEYS = ['tuition', 'boarding', 'transport', 'aftercare'];
const BILLING_MODES = new Set(['standalone', 'bundle', 'bundle_component', 'informational']);

function missingSchema(error) {
  return error && (error.code === '42P01' || error.code === '42703');
}

function asPeriod(period) {
  const text = String(period || '').trim();
  periodBounds(text);
  return text;
}

async function read(executor, sql, params = []) {
  try {
    return (await executor.query(sql, params)).rows;
  } catch (error) {
    if (missingSchema(error)) return null;
    throw error;
  }
}

function blocker(code, message, details = {}) {
  return { code, message, ...details };
}

function parseIncluded(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function getMonthlyBillingReadiness(period, executor = db) {
  const requestedPeriod = asPeriod(period);
  const bounds = periodBounds(requestedPeriod);
  const hardFailures = [];
  const warnings = [];

  const students = await read(executor, `
    SELECT id, student_number, first_name, last_name,
           COALESCE(has_sibling_discount, false) AS has_sibling_discount,
           COALESCE(has_teacher_discount, false) AS has_teacher_discount
    FROM users
    WHERE role = 'student' AND is_active = true
    ORDER BY id
  `);
  const prices = await read(executor, `
    SELECT service_key, label, amount, billing_mode, bundle_key,
           included_service_keys
    FROM service_prices
    ORDER BY display_order, service_key
  `);
  const enrollments = await read(executor, `
    SELECT id, student_id, service_key, effective_start::text AS effective_start,
           effective_end::text AS effective_end, state
    FROM service_enrollments
    WHERE state <> 'cancelled'
      AND effective_start <= $1::date
      AND (effective_end IS NULL OR effective_end >= $2::date)
    ORDER BY student_id, service_key, effective_start, id
  `, [bounds.end, bounds.start]);
  const allEnrollments = await read(executor, `
    SELECT id, student_id, service_key, effective_start::text AS effective_start,
           effective_end::text AS effective_end, state
    FROM service_enrollments
    WHERE state <> 'cancelled'
      AND effective_start <= $1::date
      AND (effective_end IS NULL OR effective_end >= $2::date)
    ORDER BY student_id, service_key, effective_start, id
  `, [bounds.end, bounds.start]);
  const assignments = await read(executor, `
    SELECT id, student_id, discount_type, starts_on::text AS starts_on,
           ends_on::text AS ends_on
    FROM learner_discount_assignments
    WHERE is_active = true
      AND starts_on <= $1::date
      AND (ends_on IS NULL OR ends_on >= $2::date)
    ORDER BY student_id, id
  `, [bounds.start, bounds.start]);

  // Generation is an explicit operator action. An empty population is not a
  // successful billing run and must be visible as a hard blocker.
  if (students && students.length === 0) {
    return {
      period: requestedPeriod,
      ready: false,
      hardFailures: [blocker(
        'no_active_learners',
        `No active learners are available for billing in ${requestedPeriod}.`,
      )],
      warnings,
      summary: { activeLearners: 0, enrolledLearners: 0, servicePrices: prices?.length || 0 },
    };
  }

  if (students === null) {
    hardFailures.push(blocker(
      'missing_student_schema',
      'The learner table or required learner columns are unavailable.',
    ));
  }
  if (prices === null) {
    hardFailures.push(blocker(
      'missing_service_configuration',
      'Service pricing configuration is unavailable; configure service prices before billing.',
    ));
  }
  if (enrollments === null) {
    hardFailures.push(blocker(
      'missing_service_enrollments',
      'Service enrollment history is unavailable; monthly billing requires explicit enrollments.',
    ));
  }
  if (assignments === null) {
    hardFailures.push(blocker(
      'missing_discount_assignments',
      'Explicit discount assignments are unavailable; legacy discount indicators cannot be resolved.',
    ));
  }

  const priceMap = new Map();
  (prices || []).forEach((price) => {
    const key = String(price.service_key || '').toLowerCase();
    if (priceMap.has(key)) {
      hardFailures.push(blocker('duplicate_service_price', `Multiple prices are configured for ${key}.`, {
        service_key: key,
      }));
    }
    priceMap.set(key, price);
    const amount = Number(price.amount);
    const mode = String(price.billing_mode || 'standalone');
    const rawIncluded = price.included_service_keys;
    const parsedIncluded = parseIncluded(rawIncluded);
    const stringArray = typeof rawIncluded === 'string' && (() => {
      try { return Array.isArray(JSON.parse(rawIncluded)); } catch (_) { return false; }
    })();
    if (rawIncluded != null && !Array.isArray(rawIncluded) &&
        !stringArray) {
      hardFailures.push(blocker('invalid_bundle_configuration',
        `Service ${key || '(empty)'} has malformed included service configuration.`, {
          service_key: key,
        }));
    }
    if (!SERVICE_KEYS.includes(key) || !Number.isFinite(amount) || amount < 0 ||
        !BILLING_MODES.has(mode)) {
      hardFailures.push(blocker('invalid_service_pricing', `Service price ${key || '(empty)'} is invalid.`, {
        service_key: key, amount: price.amount, billing_mode: mode,
      }));
    }
  });

  // Harmony Finance Phase 4A has one exact billable policy.  General price
  // validation above remains useful for malformed configurations, while this
  // blocker prevents a valid-looking but financially different bundle from
  // reaching invoice generation.
  const harmonyPolicy = {
    tuition: { amount: 2350, billing_mode: 'standalone', bundle_key: null, included: [] },
    boarding: {
      amount: 1600, billing_mode: 'bundle', bundle_key: 'harmony_boarding_package',
      included: ['transport', 'aftercare'],
    },
    transport: { amount: 650, billing_mode: 'standalone', bundle_key: null, included: [] },
    aftercare: { amount: 550, billing_mode: 'standalone', bundle_key: null, included: [] },
  };
  Object.entries(harmonyPolicy).forEach(([serviceKey, required]) => {
    const price = priceMap.get(serviceKey);
    const included = parseIncluded(price?.included_service_keys)
      .map((item) => String(item).toLowerCase()).sort();
    const expectedIncluded = [...required.included].sort();
    if (!price || Number(price.amount) !== required.amount ||
        String(price.billing_mode || 'standalone') !== required.billing_mode ||
        (price.bundle_key || null) !== required.bundle_key ||
        JSON.stringify(included) !== JSON.stringify(expectedIncluded)) {
      hardFailures.push(blocker('invalid_harmony_billing_policy',
        `Harmony billing policy for ${serviceKey} does not match the required Phase 4A configuration.`, {
          service_key: serviceKey,
          required: {
            amount: required.amount, billing_mode: required.billing_mode,
            bundle_key: required.bundle_key, included_service_keys: required.included,
          },
        }));
    }
  });

  const knownServices = new Set(SERVICE_KEYS);
  (prices || []).forEach((price) => {
    const key = String(price.service_key || '').toLowerCase();
    const mode = String(price.billing_mode || 'standalone');
    const included = parseIncluded(price.included_service_keys)
      .map((item) => String(item).toLowerCase());
    if ((mode === 'bundle' || included.length > 0) && !String(price.bundle_key || '').trim()) {
      hardFailures.push(blocker('invalid_bundle_configuration',
        `Bundle price ${key || '(empty)'} must have a bundle key.`, { service_key: key }));
    }
    if (mode === 'bundle_component' && !String(price.bundle_key || '').trim()) {
      hardFailures.push(blocker('invalid_bundle_configuration',
        `Bundle component ${key || '(empty)'} must have a bundle key.`, { service_key: key }));
    }
    included.forEach((includedKey) => {
      if (!knownServices.has(includedKey) || includedKey === key) {
        hardFailures.push(blocker('invalid_bundle_configuration',
          `Bundle ${key || '(empty)'} includes an invalid service.`, {
            service_key: key, included_service_key: includedKey,
          }));
      }
      if (!priceMap.has(includedKey)) {
        hardFailures.push(blocker('invalid_bundle_configuration',
          `Bundle ${key || '(empty)'} includes an unpriced service ${includedKey}.`, {
            service_key: key, included_service_key: includedKey,
          }));
      }
    });
  });

  const enrollmentsByStudent = new Map();
  (enrollments || []).forEach((row) => {
    const id = Number(row.student_id);
    if (!enrollmentsByStudent.has(id)) enrollmentsByStudent.set(id, []);
    enrollmentsByStudent.get(id).push(row);
  });
  const studentIds = new Set((students || []).map((student) => Number(student.id)));
  (students || []).forEach((student) => {
    const rows = enrollmentsByStudent.get(Number(student.id)) || [];
    if (!rows.some((row) => row.service_key === 'tuition')) {
      hardFailures.push(blocker('missing_tuition_enrollment',
        `Learner ${student.student_number || student.id} has no tuition enrollment effective in ${requestedPeriod}.`, {
          student_id: Number(student.id), service_key: 'tuition',
        }));
    }
    rows.forEach((row) => {
      if (!priceMap.has(row.service_key)) {
        hardFailures.push(blocker('missing_service_price',
          `No price is configured for ${row.service_key} used by learner ${student.student_number || student.id}.`, {
            student_id: Number(student.id), service_key: row.service_key,
          }));
      }
    });
    if (rows.some((row) => row.service_key === 'boarding')) {
      ['tuition', 'transport', 'aftercare'].forEach((requiredService) => {
        if (!rows.some((row) => row.service_key === requiredService)) {
          hardFailures.push(blocker('incomplete_boarding_package',
            `Learner ${student.student_number || student.id} has Boarding without ${requiredService} in the effective package.`, {
              student_id: Number(student.id),
              service_key: requiredService,
              package_key: 'harmony_boarding_package',
            }));
        }
      });
    }
  });

  // Detect historical overlaps without relying on the database constraint.  A
  // readiness report must still explain a pre-existing bad dataset.
  const overlapRows = allEnrollments || [];
  for (let i = 0; i < overlapRows.length; i += 1) {
    for (let j = i + 1; j < overlapRows.length; j += 1) {
      const left = overlapRows[i];
      const right = overlapRows[j];
      if (Number(left.student_id) !== Number(right.student_id) ||
          left.service_key !== right.service_key) continue;
      const leftEnd = left.effective_end || '9999-12-31';
      const rightEnd = right.effective_end || '9999-12-31';
      if (left.effective_start <= rightEnd && right.effective_start <= leftEnd) {
        hardFailures.push(blocker('overlapping_service_enrollments',
          `Active ${left.service_key} enrollments ${left.id} and ${right.id} overlap.`, {
            student_id: Number(left.student_id), service_key: left.service_key,
            first_id: Number(left.id), second_id: Number(right.id),
          }));
      }
    }
  }

  const assignmentByStudent = new Map();
  (assignments || []).forEach((assignment) => {
    const id = Number(assignment.student_id);
    if (!assignmentByStudent.has(id)) assignmentByStudent.set(id, []);
    assignmentByStudent.get(id).push(assignment);
  });
  (students || []).forEach((student) => {
    const legacyTypes = [];
    if (student.has_sibling_discount) legacyTypes.push('sibling');
    if (student.has_teacher_discount) legacyTypes.push('staff');
    legacyTypes.forEach((discountType) => {
      const explicit = (assignmentByStudent.get(Number(student.id)) || [])
        .some((assignment) => assignment.discount_type === discountType);
      if (!explicit) {
        hardFailures.push(blocker('unresolved_legacy_discount_indicator',
          `Learner ${student.student_number || student.id} has a legacy ${discountType} discount indicator without an explicit assignment.`, {
            student_id: Number(student.id), discount_type: discountType,
          }));
      }
    });
  });
  (assignments || []).forEach((assignment) => {
    const sameLearner = (assignmentByStudent.get(Number(assignment.student_id)) || []);
    const conflicting = sameLearner.find((other) =>
      other.discount_type !== assignment.discount_type &&
      ['staff', 'sibling'].includes(other.discount_type) &&
      ['staff', 'sibling'].includes(assignment.discount_type));
    if (assignment.discount_type === 'staff' && conflicting) {
      hardFailures.push(blocker('conflicting_discount_assignments',
        `Learner ${assignment.student_id} has overlapping staff and sibling discount assignments.`, {
          student_id: Number(assignment.student_id),
          staff_assignment_id: Number(assignment.id),
          sibling_assignment_id: Number(conflicting.id),
          period: requestedPeriod,
        }));
    }
  });

  return {
    period: requestedPeriod,
    ready: hardFailures.length === 0,
    hardFailures,
    blockers: hardFailures,
    warnings,
    summary: {
      activeLearners: students?.length || 0,
      enrolledLearners: enrollmentsByStudent.size,
      servicePrices: prices?.length || 0,
      unresolvedLegacyDiscountIndicators: hardFailures
        .filter((item) => item.code === 'unresolved_legacy_discount_indicator').length,
    },
  };
}

module.exports = {
  getMonthlyBillingReadiness,
  assessMonthlyBillingReadiness: getMonthlyBillingReadiness,
  checkMonthlyBillingReadiness: getMonthlyBillingReadiness,
  getBillingReadiness: getMonthlyBillingReadiness,
};