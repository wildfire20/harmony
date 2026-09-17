/*
 * Preview-only service enrollment bootstrap.
 *
 * This is intentionally an operator proposal, not a migration or a write
 * command.  It uses the explicitly supplied read-only database and date,
 * reports rows that could be reviewed, and always rolls back its transaction.
 */
require('dotenv').config();

const {
  createFinanceReadonlyPool,
  beginVerifiedReadonlySession,
} = require('./finance-readonly-database');

function parseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(text)) {
    throw new Error('An explicit effective date is required: YYYY-MM-DD');
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('The effective date must be a valid ISO calendar date: YYYY-MM-DD');
  }
  return text;
}

const REQUIRED_POLICY = {
  tuition: { amount: 2350, billing_mode: 'standalone', bundle_key: null, included_service_keys: [] },
  boarding: {
    amount: 1600, billing_mode: 'bundle', bundle_key: 'harmony_boarding_package',
    included_service_keys: ['transport', 'aftercare'],
  },
  transport: { amount: 650, billing_mode: 'standalone', bundle_key: null, included_service_keys: [] },
  aftercare: { amount: 550, billing_mode: 'standalone', bundle_key: null, included_service_keys: [] },
};

function learnerName(student) {
  return `${student.first_name || ''} ${student.last_name || ''}`.trim();
}

function buildServiceProposals(students, existingRows = [], effectiveStart) {
  const existingByKey = new Map(existingRows.map((row) => [
    `${Number(row.student_id)}:${String(row.service_key).toLowerCase()}`, row,
  ]));
  const activeStudentIds = new Set(students.map((student) => Number(student.student_id)));
  const studentById = new Map(students.map((student) => [Number(student.student_id), student]));
  const inferred = students.flatMap((student) => {
    const keys = [
      'tuition',
      ...(student.is_boarder ? ['boarding', 'transport', 'aftercare'] : [
        ...(student.uses_transport ? ['transport'] : []),
        ...(student.uses_aftercare ? ['aftercare'] : []),
      ]),
    ];
    return [...new Set(keys)].map((serviceKey) => {
      const prior = existingByKey.get(`${Number(student.student_id)}:${serviceKey}`);
      const alreadyEffective = Boolean(prior);
      const policySource = serviceKey === 'tuition' ? 'active_student'
        : student.is_boarder ? 'boarding_package' : `standalone_legacy_${serviceKey}`;
      return {
        student_id: Number(student.student_id),
        student_number: student.student_number,
        student_name: learnerName(student),
        service_key: serviceKey,
        effective_start: effectiveStart,
        source: alreadyEffective ? 'existing_enrollment' : policySource,
        policy_source: prior?.policy_source || prior?.source || policySource,
        status: alreadyEffective ? 'already_effective' : 'proposal',
        review_required: !alreadyEffective,
        reason: alreadyEffective ? (prior.reason || 'already effective enrollment preserved')
          : 'required by effective-date policy',
        existing_state: prior?.state || null,
      };
    });
  });
  const emitted = new Map(inferred.map((row) => [`${row.student_id}:${row.service_key}`, row]));
  existingRows.forEach((prior) => {
    const key = `${Number(prior.student_id)}:${String(prior.service_key).toLowerCase()}`;
    if (!activeStudentIds.has(Number(prior.student_id)) || emitted.has(key)) return;
    const student = studentById.get(Number(prior.student_id));
    emitted.set(key, {
      student_id: Number(prior.student_id),
      student_number: prior.student_number || student?.student_number || null,
      student_name: prior.student_name || (student ? learnerName(student) : ''),
      service_key: String(prior.service_key).toLowerCase(),
      effective_start: effectiveStart,
      source: 'existing_enrollment',
      policy_source: prior.policy_source || prior.source || 'existing_enrollment',
      status: 'already_effective',
      review_required: false,
      reason: prior.reason || 'already effective enrollment preserved',
      existing_state: prior.state || null,
    });
  });
  return [...emitted.values()];
}

function buildDiscountPreview(students, assignments = [], effectiveStart) {
  const byStudent = new Map();
  assignments.forEach((row) => {
    const id = Number(row.student_id);
    if (!byStudent.has(id)) byStudent.set(id, []);
    byStudent.get(id).push(row);
  });
  const explicit = [];
  const proposals = [];
  const suppressed = [];
  students.forEach((student) => {
    const rows = byStudent.get(Number(student.student_id)) || [];
    const staff = rows.find((row) => row.discount_type === 'staff');
    const sibling = rows.find((row) => row.discount_type === 'sibling');
    const hasStaff = Boolean(staff || student.has_teacher_discount);
    const hasSibling = Boolean(sibling || student.has_sibling_discount);
    if (hasStaff && hasSibling) suppressed.push({
      student_id: Number(student.student_id), student_number: student.student_number,
      student_name: learnerName(student), suppressed_assignment_id: sibling ? Number(sibling.id) : null,
      winning_assignment_id: staff ? Number(staff.id) : null, reason: 'staff overrides sibling',
    });
    rows.forEach((assignment) => explicit.push({
      ...assignment, student_id: Number(assignment.student_id), assignment_id: Number(assignment.id),
      policy_scope: ['staff', 'sibling'].includes(assignment.discount_type) ? 'tuition-only' : 'explicit',
      suppressed: assignment.discount_type === 'sibling' && hasStaff,
    }));
    const legacy = [];
    if (student.has_teacher_discount) legacy.push({
      discount_type: 'staff', calculation_method: 'percentage', percentage: 50, amount: 0,
    });
    if (student.has_sibling_discount && !hasStaff) legacy.push({
      discount_type: 'sibling', calculation_method: 'fixed', amount: 100, percentage: null,
    });
    legacy.forEach((assignment) => {
      const existing = rows.find((row) => row.discount_type === assignment.discount_type &&
        row.applicable_service_key === 'tuition');
      proposals.push({
        student_id: Number(student.student_id), student_number: student.student_number,
        student_name: learnerName(student), ...assignment, applicable_service_key: 'tuition',
        starts_on: effectiveStart, source: 'legacy_indicator',
        status: existing ? 'already_effective' : 'proposal',
        reason: existing ? 'explicit assignment already effective'
          : 'explicit assignment proposed from legacy indicator',
      });
    });
  });
  return { explicit, proposals, suppressed };
}

function compareServicePrices(rows = []) {
  const currentByKey = new Map(rows.map((row) => [row.service_key, row]));
  return Object.entries(REQUIRED_POLICY).map(([service_key, required]) => {
    const current = currentByKey.get(service_key);
    let included = current?.included_service_keys;
    if (typeof included === 'string') {
      try { included = JSON.parse(included); } catch (_) { included = []; }
    }
    included = Array.isArray(included) ? included : [];
    const changes_required = !current || Number(current.amount) !== required.amount ||
      String(current.billing_mode || 'standalone') !== required.billing_mode ||
      (current.bundle_key || null) !== required.bundle_key ||
      JSON.stringify(included) !== JSON.stringify(required.included_service_keys);
    return {
      service_key,
      current: current ? { amount: Number(current.amount), billing_mode: current.billing_mode,
        bundle_key: current.bundle_key || null, included_service_keys: included } : null,
      required, changes_required,
    };
  });
}

function calculatePolicyTotals(discountType = null) {
  const tuition = discountType === 'staff' ? 1175 : discountType === 'sibling' ? 2250 : 2350;
  return { tuition, boarding: 1600, gross: tuition + 1600 };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const pool = createFinanceReadonlyPool(env);
  const effectiveStart = parseDate(argv[0]);
  const client = await pool.connect();
  try {
    const session = await beginVerifiedReadonlySession(client, () => {});
    const students = await client.query(`
      SELECT u.id AS student_id, u.student_number,
             u.first_name, u.last_name,
             COALESCE(u.is_boarder, false) AS is_boarder,
             COALESCE(u.uses_transport, false) AS uses_transport,
             COALESCE(u.uses_aftercare, false) AS uses_aftercare,
             COALESCE(u.has_teacher_discount, false) AS has_teacher_discount,
             COALESCE(u.has_sibling_discount, false) AS has_sibling_discount
      FROM users u
      WHERE u.role = 'student' AND u.is_active = true
      ORDER BY u.id
    `);

    const servicePrices = await client.query(`
      SELECT service_key, label, amount, billing_mode, bundle_key,
             included_service_keys
      FROM service_prices
      WHERE service_key = ANY($1::text[])
      ORDER BY display_order, service_key
    `, [['tuition', 'boarding', 'transport', 'aftercare']]);

    let existing = { rows: [] };
    await client.query('SAVEPOINT service_bootstrap_existing');
    try {
      existing = await client.query(`
        SELECT student_id, service_key, state
        FROM service_enrollments
        WHERE state <> 'cancelled'
          AND effective_start <= $1::date
          AND (effective_end IS NULL OR effective_end >= $1::date)
      `, [effectiveStart]);
    } catch (error) {
      if (error.code === '42P01' || error.code === '42703') {
        await client.query('ROLLBACK TO SAVEPOINT service_bootstrap_existing');
      } else throw error;
    }
    await client.query('RELEASE SAVEPOINT service_bootstrap_existing');
    const proposals = buildServiceProposals(students.rows, existing.rows, effectiveStart);

    const assignments = await client.query(`
      SELECT id, student_id, discount_type, calculation_method, amount,
             percentage, applicable_service_key, reason, starts_on::text AS starts_on,
             ends_on::text AS ends_on
      FROM learner_discount_assignments
      WHERE is_active = true
        AND starts_on <= $1::date
        AND (ends_on IS NULL OR ends_on >= $1::date)
      ORDER BY student_id, id
    `, [effectiveStart]);
    const discountPreview = buildDiscountPreview(students.rows, assignments.rows, effectiveStart);
    const { explicit: explicitDiscounts, proposals: discountProposals,
      suppressed: suppressedDiscounts } = discountPreview;
    const pricePolicy = compareServicePrices(servicePrices.rows);
    const boarderExample = calculatePolicyTotals();
    const staffBoarderExample = calculatePolicyTotals('staff');
    const siblingBoarderExample = calculatePolicyTotals('sibling');
    const learner_lists = {
      boarding: [...new Set(proposals.filter((row) => row.policy_source === 'boarding_package')
        .map((row) => row.student_number || row.student_id))],
      standalone_transport: [...new Set(proposals
        .filter((row) => row.policy_source === 'standalone_legacy_transport')
        .map((row) => row.student_number || row.student_id))],
      standalone_aftercare: [...new Set(proposals
        .filter((row) => row.policy_source === 'standalone_legacy_aftercare')
        .map((row) => row.student_number || row.student_id))],
      staff: discountProposals.filter((row) => row.discount_type === 'staff')
        .map((row) => row.student_number || row.student_id),
      sibling: discountProposals.filter((row) => row.discount_type === 'sibling')
        .map((row) => row.student_number || row.student_id),
      suppressed_conflict: suppressedDiscounts.map((row) => row.student_number || row.student_id),
    };

    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      preview: true,
      readOnly: true,
      transaction_read_only: session.transactionReadOnly,
      effective_start: effectiveStart,
      proposals,
      prices: pricePolicy,
      discounts: {
        explicit: explicitDiscounts,
        proposals: discountProposals,
        suppressed_sibling_count: suppressedDiscounts.length,
        suppressed_sibling_learners: suppressedDiscounts,
      },
      learner_lists,
      package_examples: {
        boarding: { ...boarderExample, gross: 3950 },
        staff_child_boarding: { ...staffBoarderExample, gross: 2775 },
        sibling_boarding: { ...siblingBoarderExample, gross: 3850 },
      },
      summary: {
        active_learners: students.rows.length,
        proposal_rows: proposals.length,
        already_effective: proposals.filter((row) => row.status === 'already_effective').length,
        new_proposals: proposals.filter((row) => row.status === 'proposal').length,
        changes_required: pricePolicy.filter((row) => row.changes_required).length,
        gross_total: boarderExample.gross,
        by_service: proposals.reduce((result, row) => {
          result[row.service_key] = (result[row.service_key] || 0) + 1;
          return result;
        }, {}),
      },
    }, null, 2));
    return { proposals };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (typeof pool.end === 'function') await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Finance service bootstrap preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseDate,
  REQUIRED_POLICY,
  buildServiceProposals,
  buildDiscountPreview,
  compareServicePrices,
  calculatePolicyTotals,
};