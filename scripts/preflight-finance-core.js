/*
 * Read-only finance-core migration preflight.
 *
 * This command deliberately does not create a transaction-visible fallback
 * schema, repair rows, or rewrite historical periods. It runs in a READ ONLY
 * transaction and reports every known migration blocker before the operator
 * runs migrations/finance_core_architecture.sql.
 */
require('dotenv').config();

const {
  createFinanceReadonlyPool,
  beginVerifiedReadonlySession,
} = require('./finance-readonly-database');

const REQUIRED_BASE_TABLES = [
  'users',
  'invoices',
  'pending_payments',
  'payment_transactions',
  'invoice_line_items',
  'student_fee_assignments',
];

const TARGET_TABLES = [
  'service_enrollments',
  'finance_schema_versions',
  'payment_proof_allocation_proposals',
  'payment_proof_allocations',
];

const TARGET_COLUMNS = [
  ['invoices', 'billing_period'],
  ['invoices', 'invoice_kind'],
  ['invoices', 'finance_origin'],
  ['service_enrollments', 'student_id'],
  ['service_enrollments', 'service_key'],
  ['service_enrollments', 'state'],
  ['service_enrollments', 'effective_start'],
  ['service_enrollments', 'effective_end'],
];

async function runFinanceCorePreflight(client) {
  const blockers = [];
  const checks = {};
  const schema = (await client.query('SELECT current_schema() AS schema')).rows[0].schema;

  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = ANY($1::text[])
  `, [[...REQUIRED_BASE_TABLES, ...TARGET_TABLES]]);
  const present = new Set(tables.rows.map((row) => row.table_name));
  checks.baseTables = { schema, missing: REQUIRED_BASE_TABLES.filter((name) => !present.has(name)) };
  checks.targetTables = {
    present: TARGET_TABLES.filter((name) => present.has(name)),
    absent: TARGET_TABLES.filter((name) => !present.has(name)),
  };
  checks.baseTables.missing.forEach((table) => blockers.push({
    code: 'missing_base_table',
    table,
    message: `Required base table ${table} is missing from schema ${schema}`,
  }));
  if (checks.baseTables.missing.length) {
    return { ok: false, readOnly: true, schema, checks, blockers };
  }

  const columns = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (table_name, column_name) IN (
        ('invoices', 'student_id'),
        ('invoices', 'amount_due'),
        ('invoices', 'amount_paid'),
        ('invoices', 'status'),
        ('invoice_line_items', 'invoice_id'),
        ('payment_transactions', 'invoice_id'),
        ('service_enrollments', 'student_id'),
        ('service_enrollments', 'service_key'),
        ('service_enrollments', 'state'),
        ('service_enrollments', 'effective_start'),
        ('service_enrollments', 'effective_end'),
        ('invoices', 'billing_period'),
        ('invoices', 'invoice_kind'),
        ('invoices', 'finance_origin')
      )
  `);
  const columnSet = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  checks.baseColumns = { missing: [
    'invoices.student_id', 'invoices.amount_due', 'invoices.amount_paid',
    'invoices.status', 'invoice_line_items.invoice_id', 'payment_transactions.invoice_id',
  ].filter((column) => !columnSet.has(column)) };
  checks.baseColumns.missing.forEach((column) => blockers.push({
    code: 'missing_base_column',
    column,
    message: `Required base column ${column} is missing`,
  }));
  checks.targetColumns = {
    present: TARGET_COLUMNS
      .filter(([table, column]) => columnSet.has(`${table}.${column}`))
      .map(([table, column]) => `${table}.${column}`),
    absent: TARGET_COLUMNS
      .filter(([table, column]) => !columnSet.has(`${table}.${column}`))
      .map(([table, column]) => `${table}.${column}`),
  };
  if (checks.baseColumns.missing.length) {
    return { ok: false, readOnly: true, schema, checks, blockers };
  }

  // These are the rows that would make the migration's unique index fail.
  // Only explicit canonical rows are considered; unknown historical rows are
  // intentionally not assigned a period by this command.
  const hasCanonicalIdentityColumns = [
    'invoices.billing_period',
    'invoices.invoice_kind',
    'invoices.finance_origin',
  ].every((column) => columnSet.has(column));
  const duplicateResult = hasCanonicalIdentityColumns ? await client.query(`
    SELECT student_id, billing_period, invoice_kind,
           COUNT(*)::integer AS row_count,
           ARRAY_AGG(id ORDER BY id) AS invoice_ids
    FROM invoices
    WHERE finance_origin = 'canonical'
      AND invoice_kind = 'monthly'
      AND billing_period IS NOT NULL
    GROUP BY student_id, billing_period, invoice_kind
    HAVING COUNT(*) > 1
    ORDER BY student_id, billing_period
  `) : { rows: [] };
  checks.canonicalMonthlyDuplicates = duplicateResult.rows;
  duplicateResult.rows.forEach((row) => blockers.push({
    code: 'duplicate_canonical_monthly_invoice',
    ...row,
    message: `Canonical monthly invoice identity is duplicated for learner ${row.student_id} `
      + `period ${row.billing_period}; reconcile invoice IDs ${row.invoice_ids.join(', ')}`,
  }));

  const invalidPeriods = columnSet.has('invoices.billing_period') ? await client.query(`
    SELECT id, billing_period
    FROM invoices
    WHERE billing_period IS NOT NULL
      AND billing_period <> date_trunc('month', billing_period)::date
    ORDER BY id
  `) : { rows: [] };
  checks.invalidBillingPeriods = invalidPeriods.rows;
  invalidPeriods.rows.forEach((row) => blockers.push({
    code: 'invalid_billing_period',
    ...row,
    message: `Invoice ${row.id} has a billing_period that is not the first day of its month`,
  }));

  const invalidOrigins = columnSet.has('invoices.finance_origin') ? await client.query(`
    SELECT id, finance_origin
    FROM invoices
    WHERE finance_origin IS NOT NULL
      AND finance_origin NOT IN ('canonical', 'legacy', 'unknown')
    ORDER BY id
  `) : { rows: [] };
  checks.invalidFinanceOrigins = invalidOrigins.rows;
  invalidOrigins.rows.forEach((row) => blockers.push({
    code: 'invalid_finance_origin',
    ...row,
    message: `Invoice ${row.id} has unsupported finance_origin ${row.finance_origin}`,
  }));

  const hasEnrollmentSchema = present.has('service_enrollments') && [
    'service_enrollments.student_id',
    'service_enrollments.service_key',
    'service_enrollments.state',
    'service_enrollments.effective_start',
    'service_enrollments.effective_end',
  ].every((column) => columnSet.has(column));
  const overlaps = hasEnrollmentSchema ? await client.query(`
    SELECT left_side.student_id, left_side.service_key,
           left_side.id AS first_id, right_side.id AS second_id
    FROM service_enrollments left_side
    JOIN service_enrollments right_side
      ON right_side.student_id = left_side.student_id
     AND right_side.service_key = left_side.service_key
     AND right_side.id > left_side.id
    WHERE left_side.state = 'active' AND right_side.state = 'active'
      AND left_side.effective_start <= COALESCE(right_side.effective_end, 'infinity'::date)
      AND right_side.effective_start <= COALESCE(left_side.effective_end, 'infinity'::date)
    ORDER BY left_side.student_id, left_side.service_key, left_side.id
  `) : { rows: [] };
  checks.enrollmentOverlaps = overlaps.rows;
  overlaps.rows.forEach((row) => blockers.push({
    code: 'overlapping_active_enrollment',
    ...row,
    message: `Active enrollment ${row.first_id} overlaps ${row.second_id}`,
  }));

  const conflictingObjects = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS relation_name,
           CASE WHEN c.relkind = 'i' THEN 'index' ELSE 'relation' END AS object_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN (
        'invoices_canonical_monthly_identity_idx'
      )
      AND (
        (c.relname = 'invoices_canonical_monthly_identity_idx' AND c.relkind <> 'i')
      )
  `);
  checks.conflictingObjects = conflictingObjects.rows;
  conflictingObjects.rows.forEach((row) => blockers.push({
    code: 'conflicting_schema_object',
    ...row,
    message: `Migration object name ${row.relation_name} is already occupied by a ${row.object_type}`,
  }));

  const existingIdentityIndex = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'invoices_canonical_monthly_identity_idx'
  `);
  checks.existingIdentityIndex = existingIdentityIndex.rows;
  existingIdentityIndex.rows.forEach((row) => {
    const definition = String(row.indexdef || '').toLowerCase();
    const reviewed = definition.includes('unique index') &&
      definition.includes('student_id') &&
      definition.includes('billing_period') &&
      definition.includes('invoice_kind') &&
      definition.includes('finance_origin');
    if (!reviewed) blockers.push({
      code: 'conflicting_identity_index',
      ...row,
      message: 'Existing canonical monthly identity index has an unexpected definition',
    });
  });

  const conflictingTriggers = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS relation_name, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND NOT t.tgisinternal
      AND t.tgname = ANY($1::text[])
  `, [[
    'service_enrollments_no_overlap',
    'payment_transactions_immutable',
    'invoices_projection_context',
    'invoice_line_items_immutable',
    'invoice_line_items_classification_append',
  ]]);
  checks.conflictingTriggers = conflictingTriggers.rows;

  return { ok: blockers.length === 0, readOnly: true, schema, checks, blockers };
}

async function main() {
  const pool = createFinanceReadonlyPool();
  const client = await pool.connect();
  try {
    await beginVerifiedReadonlySession(client);
    const result = await runFinanceCorePreflight(client);
    await client.query('ROLLBACK');
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Finance-core preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_BASE_TABLES,
  runFinanceCorePreflight,
};
