/*
 * Read-only production baseline audit for the finance-core architecture.
 * This command never repairs records, creates schema, or sends notifications.
 */
require('dotenv').config();

const db = require('../config/database');

const REQUIRED_TABLES = [
  'finance_schema_versions',
  'service_enrollments',
  'payment_proof_allocation_proposals',
  'payment_proof_allocations',
];

const REQUIRED_COLUMNS = [
  ['invoices', 'amount_due'],
  ['invoices', 'amount_paid'],
  ['invoices', 'status'],
  ['payment_transactions', 'invoice_id'],
  ['service_enrollments', 'student_id'],
  ['service_enrollments', 'service_key'],
  ['service_enrollments', 'effective_start'],
  ['service_enrollments', 'effective_end'],
  ['invoices', 'billing_period'],
  ['invoices', 'invoice_kind'],
  ['invoices', 'invoice_source'],
  ['invoices', 'finance_origin'],
  ['payment_proof_allocation_proposals', 'proof_id'],
  ['payment_proof_allocation_proposals', 'learner_id'],
  ['payment_proof_allocation_proposals', 'invoice_id'],
  ['payment_proof_allocation_proposals', 'invoice_line_item_id'],
  ['payment_proof_allocation_proposals', 'fee_assignment_id'],
  ['payment_proof_allocation_proposals', 'category'],
  ['payment_proof_allocation_proposals', 'proposed_amount'],
  ['payment_proof_allocation_proposals', 'resolution_state'],
];

async function query(client, section, text, values = []) {
  try {
    return await client.query(text, values);
  } catch (error) {
    const wrapped = new Error(`Audit query failed in section "${section}": ${error.message}`);
    wrapped.auditSection = section;
    wrapped.cause = error;
    throw wrapped;
  }
}

let optionalSectionSequence = 0;

async function optionalSection(client, findings, name, text, values = []) {
  optionalSectionSequence += 1;
  const savepoint = `finance_audit_optional_${optionalSectionSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await client.query(text, values);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result.rows;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    if (error.code === '42P01' || error.code === '42703') {
      findings.push({
        section: name,
        severity: 'error',
        code: 'missing_schema',
        message: error.message,
      });
      return [];
    }
    throw Object.assign(new Error(`Audit query failed in section "${name}": ${error.message}`), {
      auditSection: name,
      cause: error,
    });
  }
}

async function runFinanceCoreAudit(client, options = {}) {
  const findings = [];
  const checks = {};
  const currentPeriod = options.currentPeriod || new Date().toISOString().slice(0, 7);

  const tables = await query(client, 'schema_tables', `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
  `, [REQUIRED_TABLES]);
  const tableSet = new Set(tables.rows.map((row) => row.table_name));
  checks.schema = { missingTables: REQUIRED_TABLES.filter((name) => !tableSet.has(name)) };
  checks.schema.missingTables.forEach((table) => findings.push({
    section: 'schema',
    severity: 'error',
    code: 'missing_table',
    table,
  }));

  const columns = await query(client, 'schema_columns', `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (table_name, column_name) IN (
        SELECT x.table_name, x.column_name
        FROM jsonb_to_recordset($1::jsonb) AS x(table_name text, column_name text)
      )
  `, [JSON.stringify(REQUIRED_COLUMNS.map(([table_name, column_name]) =>
    ({ table_name, column_name })))] );
  const columnSet = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  checks.schema.missingColumns = REQUIRED_COLUMNS
    .filter(([table, column]) => !columnSet.has(`${table}.${column}`))
    .map(([table, column]) => `${table}.${column}`);
  checks.schema.missingColumns.forEach((column) => findings.push({
    section: 'schema',
    severity: 'error',
    code: 'missing_column',
    column,
  }));

  const versions = await optionalSection(client, findings, 'schema_version', `
    SELECT schema_key, version
    FROM finance_schema_versions
    WHERE schema_key = 'finance_core_architecture'
  `);
  checks.schema.version = versions[0] || null;
  if (!versions.length || Number(versions[0].version) < 2) {
    findings.push({
      section: 'schema_version',
      severity: 'error',
      code: 'missing_version',
      expected: 'finance_core_architecture@2',
    });
  }

  const constraints = await optionalSection(client, findings, 'constraints', `
    SELECT c.relname AS table_name, pc.contype, pg_get_constraintdef(pc.oid) AS definition
    FROM pg_constraint pc
    JOIN pg_class c ON c.oid = pc.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN ('service_enrollments',
                        'invoices',
                        'payment_proof_allocation_proposals',
                        'payment_proof_allocations')
  `);
  const constraintText = constraints.map((row) => row.definition).join(' ');
  const enrollmentExclusion = constraints.some((row) =>
    row.table_name === 'service_enrollments' && row.contype === 'x');
  checks.constraints = {
    count: constraints.length,
    hasEffectiveDateCheck: /effective_end/i.test(constraintText),
    hasCategoryCheck: /tuition/i.test(constraintText) && /aftercare/i.test(constraintText),
    hasAmountCheck: /amount|proposed_amount|allocated_amount/i.test(constraintText),
    hasEnrollmentExclusion: enrollmentExclusion,
    hasInvoicePeriodCheck: /billing_period/i.test(constraintText),
    hasInvoiceOriginCheck: /canonical/i.test(constraintText) && /legacy/i.test(constraintText),
  };
  if (!checks.constraints.hasEffectiveDateCheck ||
      !checks.constraints.hasCategoryCheck ||
      !checks.constraints.hasAmountCheck ||
      !checks.constraints.hasEnrollmentExclusion ||
      !checks.constraints.hasInvoicePeriodCheck ||
      !checks.constraints.hasInvoiceOriginCheck) {
    findings.push({
      section: 'constraints',
      severity: 'error',
      code: 'missing_integrity_constraint',
    });
  }

  const foreignKeys = await optionalSection(client, findings, 'foreign_keys', `
    SELECT child.relname AS child_table, child_col.attname AS child_column,
           parent.relname AS parent_table
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord) ON TRUE
    JOIN pg_attribute child_col
      ON child_col.attrelid = child.oid AND child_col.attnum = key.attnum
    WHERE con.contype = 'f'
      AND child.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
      AND child.relname IN ('service_enrollments',
                            'payment_proof_allocation_proposals',
                            'payment_proof_allocations')
  `);
  const fkSet = new Set(foreignKeys.map((row) =>
    `${row.child_table}.${row.child_column}->${row.parent_table}`));
  const expectedForeignKeys = [
    'service_enrollments.student_id->users',
    'payment_proof_allocation_proposals.proof_id->pending_payments',
    'payment_proof_allocation_proposals.learner_id->users',
    'payment_proof_allocation_proposals.invoice_id->invoices',
    'payment_proof_allocation_proposals.invoice_line_item_id->invoice_line_items',
    'payment_proof_allocation_proposals.fee_assignment_id->student_fee_assignments',
    'payment_proof_allocations.proof_id->pending_payments',
    'payment_proof_allocations.learner_id->users',
    'payment_proof_allocations.invoice_id->invoices',
    'payment_proof_allocations.invoice_line_item_id->invoice_line_items',
    'payment_proof_allocations.fee_assignment_id->student_fee_assignments',
  ];
  checks.foreignKeys = { missing: expectedForeignKeys.filter((key) => !fkSet.has(key)) };
  checks.foreignKeys.missing.forEach((key) => findings.push({
    section: 'foreign_keys',
    severity: 'error',
    code: 'missing_foreign_key',
    key,
  }));

  const indexes = await optionalSection(client, findings, 'indexes', `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = ANY($1::text[])
  `, [
    [
      'service_enrollments_idempotency_idx',
      'service_enrollments_identity_idx',
      'payment_proof_proposals_idempotency_idx',
      'payment_proof_proposals_target_idx',
      'payment_proof_allocations_idempotency_idx',
      'invoices_canonical_monthly_identity_idx',
    ],
  ]);
  const indexSet = new Set(indexes.map((row) => row.indexname));
  const expectedIndexes = [
    'service_enrollments_idempotency_idx',
    'service_enrollments_identity_idx',
    'payment_proof_proposals_idempotency_idx',
    'payment_proof_proposals_target_idx',
    'payment_proof_allocations_idempotency_idx',
    'invoices_canonical_monthly_identity_idx',
  ];
  checks.indexes = { missing: expectedIndexes.filter((name) => !indexSet.has(name)) };
  checks.indexes.missing.forEach((index) => findings.push({
    section: 'indexes',
    severity: 'error',
    code: 'missing_index',
    index,
  }));

  const triggers = await optionalSection(client, findings, 'triggers', `
    SELECT tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND NOT t.tgisinternal
      AND (
        (c.relname = 'service_enrollments' AND tgname = 'service_enrollments_no_overlap')
        OR (c.relname = 'payment_proof_allocation_proposals'
            AND tgname = 'payment_proof_proposals_consistency')
        OR (c.relname = 'payment_proof_allocations'
            AND tgname = 'payment_proof_allocations_consistency')
        OR (c.relname = 'payment_proof_allocations' AND tgname = 'payment_proof_allocations_immutable')
        OR (c.relname = 'invoice_line_items' AND tgname = 'invoice_line_items_immutable')
        OR (c.relname = 'invoice_line_items' AND tgname = 'invoice_line_items_classification_append')
        OR (c.relname = 'payment_transactions' AND tgname = 'payment_transactions_immutable')
        OR (c.relname = 'invoices' AND tgname = 'invoices_projection_context')
      )
  `);
  const triggerSet = new Set(triggers.map((row) => row.tgname));
  checks.triggers = {
    missing: [
      'service_enrollments_no_overlap',
      'payment_proof_proposals_consistency',
      'payment_proof_allocations_consistency',
      'payment_proof_allocations_immutable',
      'invoice_line_items_immutable',
      'invoice_line_items_classification_append',
      'payment_transactions_immutable',
      'invoices_projection_context',
    ]
      .filter((name) => !triggerSet.has(name)),
  };
  checks.triggers.missing.forEach((trigger) => findings.push({
    section: 'triggers',
    severity: 'error',
    code: 'missing_trigger',
    trigger,
  }));

  const headerLedger = await optionalSection(client, findings, 'header_vs_ledger', `
    SELECT i.id, i.student_id, i.amount_paid,
           COALESCE(SUM(CASE WHEN pt.reverses_transaction_id IS NULL
                             AND reversal.id IS NULL THEN pt.amount ELSE 0 END), 0) AS ledger_paid
    FROM invoices i
    LEFT JOIN payment_transactions pt ON pt.invoice_id = i.id
    LEFT JOIN payment_transactions reversal ON reversal.reverses_transaction_id = pt.id
    GROUP BY i.id, i.student_id, i.amount_paid
    HAVING ROUND(COALESCE(i.amount_paid, 0)::numeric, 2) <>
           ROUND(COALESCE(SUM(CASE WHEN pt.reverses_transaction_id IS NULL
                             AND reversal.id IS NULL THEN pt.amount ELSE 0 END), 0)::numeric, 2)
    ORDER BY i.id
  `);
  checks.headerVsLedger = { count: headerLedger.length };
  headerLedger.forEach((row) => findings.push({
    section: 'header_vs_ledger',
    severity: 'error',
    code: 'amount_paid_mismatch',
    ...row,
  }));

  const semanticProposalMismatches = await optionalSection(client, findings, 'proposal_consistency', `
    SELECT p.id, 'proof_learner' AS mismatch
    FROM payment_proof_allocation_proposals p
    JOIN pending_payments pp ON pp.id = p.proof_id
    WHERE pp.student_id IS DISTINCT FROM p.learner_id
    UNION ALL
    SELECT p.id, 'invoice_learner' AS mismatch
    FROM payment_proof_allocation_proposals p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.student_id IS DISTINCT FROM p.learner_id
    UNION ALL
    SELECT p.id, 'line_invoice' AS mismatch
    FROM payment_proof_allocation_proposals p
    JOIN invoice_line_items line ON line.id = p.invoice_line_item_id
    WHERE p.invoice_id IS NULL OR line.invoice_id IS DISTINCT FROM p.invoice_id
    UNION ALL
    SELECT p.id, 'fee_learner' AS mismatch
    FROM payment_proof_allocation_proposals p
    JOIN student_fee_assignments fa ON fa.id = p.fee_assignment_id
    WHERE fa.student_id IS DISTINCT FROM p.learner_id
    ORDER BY id, mismatch
  `);
  checks.proposalConsistency = { count: semanticProposalMismatches.length };
  semanticProposalMismatches.forEach((row) => findings.push({
    section: 'proposal_consistency',
    severity: 'error',
    code: 'identity_mismatch',
    ...row,
  }));

  const semanticAllocationMismatches = await optionalSection(client, findings, 'allocation_consistency', `
    SELECT a.id, 'proof_learner' AS mismatch
    FROM payment_proof_allocations a
    JOIN pending_payments pp ON pp.id = a.proof_id
    WHERE pp.student_id IS DISTINCT FROM a.learner_id
    UNION ALL
    SELECT a.id, 'invoice_learner' AS mismatch
    FROM payment_proof_allocations a
    JOIN invoices i ON i.id = a.invoice_id
    WHERE i.student_id IS DISTINCT FROM a.learner_id
    UNION ALL
    SELECT a.id, 'line_invoice' AS mismatch
    FROM payment_proof_allocations a
    JOIN invoice_line_items line ON line.id = a.invoice_line_item_id
    WHERE a.invoice_id IS NULL OR line.invoice_id IS DISTINCT FROM a.invoice_id
    UNION ALL
    SELECT a.id, 'fee_learner' AS mismatch
    FROM payment_proof_allocations a
    JOIN student_fee_assignments fa ON fa.id = a.fee_assignment_id
    WHERE fa.student_id IS DISTINCT FROM a.learner_id
    ORDER BY id, mismatch
  `);
  checks.allocationConsistency = { count: semanticAllocationMismatches.length };
  semanticAllocationMismatches.forEach((row) => findings.push({
    section: 'allocation_consistency',
    severity: 'error',
    code: 'identity_mismatch',
    ...row,
  }));

  const enrollmentOverlaps = await optionalSection(client, findings, 'enrollment_overlap', `
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
  `);
  checks.enrollmentOverlap = { count: enrollmentOverlaps.length };
  enrollmentOverlaps.forEach((row) => findings.push({
    section: 'enrollment_overlap',
    severity: 'error',
    code: 'overlapping_active_enrollment',
    ...row,
  }));

  const currentFutureMissingLines = await optionalSection(client, findings, 'current_future_invoice_snapshots', `
    SELECT i.id, i.student_id, i.billing_period, i.due_date, i.amount_due
    FROM invoices i
    WHERE i.finance_origin = 'canonical'
      AND i.invoice_kind = 'monthly'
      AND i.billing_period IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM invoice_line_items line
        WHERE line.invoice_id = i.id
      )
    ORDER BY i.due_date, i.id
  `);
  checks.currentFutureInvoiceSnapshots = { count: currentFutureMissingLines.length };
  currentFutureMissingLines.forEach((row) => findings.push({
    section: 'current_future_invoice_snapshots',
    severity: 'error',
    code: 'missing_persisted_lines',
    ...row,
  }));

  const currentFutureLegacyLines = await optionalSection(client, findings, 'current_future_legacy_fallbacks', `
    SELECT i.id, i.student_id, i.billing_period, i.due_date, line.id AS line_id
    FROM invoices i
    JOIN invoice_line_items line ON line.invoice_id = i.id
    WHERE COALESCE(i.finance_origin, 'unknown') <> 'canonical'
      AND COALESCE(
        i.billing_period,
        date_trunc('month', i.due_date)::date
      ) >= ($1 || '-01')::date
      AND (
        line.metadata->>'source' = 'legacy_invoice_reconciliation'
        OR line.metadata->>'legacy_reconciliation' IN ('true', 'TRUE')
      )
    ORDER BY i.due_date, i.id, line.id
  `, [currentPeriod]);
  checks.currentFutureLegacyFallbacks = { count: currentFutureLegacyLines.length };
  currentFutureLegacyLines.forEach((row) => findings.push({
    section: 'current_future_legacy_fallbacks',
    severity: 'error',
    code: 'legacy_classification_in_current_period',
    ...row,
  }));

  const canonicalInvoiceMetadata = await optionalSection(client, findings, 'canonical_invoice_metadata', `
    SELECT id, student_id, billing_period, invoice_kind, invoice_source
    FROM invoices
    WHERE finance_origin = 'canonical'
      AND (
        invoice_kind IS NULL
        OR invoice_source IS NULL
        OR (invoice_kind = 'monthly' AND billing_period IS NULL)
      )
    ORDER BY id
  `);
  checks.canonicalInvoiceMetadata = { count: canonicalInvoiceMetadata.length };
  canonicalInvoiceMetadata.forEach((row) => findings.push({
    section: 'canonical_invoice_metadata',
    severity: 'error',
    code: 'incomplete_canonical_marker',
    ...row,
  }));

  const duplicateCanonicalPeriods = await optionalSection(client, findings, 'canonical_invoice_identity', `
    SELECT student_id, billing_period, invoice_kind, COUNT(*)::integer AS row_count,
           ARRAY_AGG(id ORDER BY id) AS invoice_ids
    FROM invoices
    WHERE finance_origin = 'canonical'
      AND invoice_kind = 'monthly'
      AND billing_period IS NOT NULL
    GROUP BY student_id, billing_period, invoice_kind
    HAVING COUNT(*) > 1
    ORDER BY student_id, billing_period
  `);
  checks.canonicalInvoiceIdentity = { count: duplicateCanonicalPeriods.length };
  duplicateCanonicalPeriods.forEach((row) => findings.push({
    section: 'canonical_invoice_identity',
    severity: 'error',
    code: 'duplicate_canonical_monthly_period',
    ...row,
  }));

  const invalidClassificationCorrections = await optionalSection(
    client, findings, 'classification_correction_integrity', `
    SELECT correction.id, correction.invoice_id
    FROM invoice_line_items correction
    LEFT JOIN invoice_line_items target
      ON target.id = CASE
        WHEN correction.metadata->>'target_line_id' ~ '^[0-9]+$'
        THEN (correction.metadata->>'target_line_id')::integer
      END
     AND target.invoice_id = correction.invoice_id
     AND target.metadata->>'source' = 'legacy_invoice_reconciliation'
    WHERE correction.metadata->>'source' = 'legacy_classification_correction'
      AND (
        correction.amount <> 0
        OR correction.is_included IS DISTINCT FROM TRUE
        OR correction.line_type <> 'charge'
        OR target.id IS NULL
        OR correction.service_key IS DISTINCT FROM correction.metadata->>'new_category'
        OR target.metadata->>'category' IS DISTINCT FROM correction.metadata->>'previous_category'
      )
    ORDER BY correction.id
  `);
  checks.classificationCorrectionIntegrity = { count: invalidClassificationCorrections.length };
  invalidClassificationCorrections.forEach((row) => findings.push({
    section: 'classification_correction_integrity',
    severity: 'error',
    code: 'invalid_append_only_correction',
    ...row,
  }));

  const uncategorized = await optionalSection(client, findings, 'uncategorized_allocations', `
    SELECT id, student_id, invoice_id, amount
    FROM payment_transactions
    WHERE invoice_id IS NOT NULL
      AND reverses_transaction_id IS NULL
      AND NULLIF(to_jsonb(payment_transactions)->>'allocation_category', '') IS NULL
    ORDER BY id
  `);
  checks.uncategorizedAllocations = { count: uncategorized.length };
  uncategorized.forEach((row) => findings.push({
    section: 'uncategorized_allocations',
    severity: 'warning',
    code: 'missing_category',
    ...row,
  }));

  const ambiguous = await optionalSection(client, findings, 'ambiguous_proposals', `
    SELECT id, proof_id, learner_id, proposed_amount, resolution_state
    FROM payment_proof_allocation_proposals
    WHERE resolution_state IN ('proposed', 'accepted')
      AND invoice_id IS NULL AND invoice_line_item_id IS NULL
      AND fee_assignment_id IS NULL
    ORDER BY id
  `);
  checks.ambiguousProposals = { count: ambiguous.length };
  ambiguous.forEach((row) => findings.push({
    section: 'ambiguous_proposals',
    severity: 'error',
    code: 'missing_target',
    ...row,
  }));

  const legacyAmbiguous = await optionalSection(client, findings, 'ambiguous_legacy_proposals', `
    SELECT id, student_id, amount, status
    FROM pending_payments
    WHERE status = 'pending'
      AND jsonb_typeof(selected_obligations) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(selected_obligations) item
        WHERE COALESCE(item->>'obligation_id', '') = ''
          AND item->>'invoice_id' IS NULL
          AND item->>'invoice_line_item_id' IS NULL
          AND item->>'fee_id' IS NULL
          AND item->>'assignment_id' IS NULL
      )
  `);
  checks.ambiguousProposals.legacyCount = legacyAmbiguous.length;
  legacyAmbiguous.forEach((row) => findings.push({
    section: 'ambiguous_legacy_proposals',
    severity: 'warning',
    code: 'ambiguous_json_target',
    ...row,
  }));

  const duplicateReferences = await optionalSection(client, findings, 'duplicate_references', `
    SELECT COALESCE(reference, reference_number) AS reference, COUNT(*)::integer AS row_count
    FROM payment_transactions
    WHERE NULLIF(COALESCE(reference, reference_number), '') IS NOT NULL
    GROUP BY COALESCE(reference, reference_number)
    HAVING COUNT(*) > 1
    ORDER BY row_count DESC, reference
  `);
  checks.duplicateReferences = { count: duplicateReferences.length };
  duplicateReferences.forEach((row) => findings.push({
    section: 'duplicate_references',
    severity: 'warning',
    code: 'duplicate_payment_reference',
    ...row,
  }));

  const invalidReversals = await optionalSection(client, findings, 'invalid_reversals', `
    SELECT reversal.id, reversal.reverses_transaction_id, reversal.amount
    FROM payment_transactions reversal
    LEFT JOIN payment_transactions original
      ON original.id = reversal.reverses_transaction_id
    WHERE reversal.reverses_transaction_id IS NOT NULL
      AND (original.id IS NULL
           OR reversal.id = original.id
            OR reversal.amount >= 0
            OR original.amount <= 0
            OR ROUND((reversal.amount + original.amount)::numeric, 2) <> 0
           OR reversal.student_id IS DISTINCT FROM original.student_id
           OR reversal.invoice_id IS DISTINCT FROM original.invoice_id
           OR (
             SELECT COUNT(*) FROM payment_transactions duplicate_reversal
             WHERE duplicate_reversal.reverses_transaction_id = reversal.reverses_transaction_id
           ) > 1)
  `);
  checks.invalidReversals = { count: invalidReversals.length };
  invalidReversals.forEach((row) => findings.push({
    section: 'invalid_reversals',
    severity: 'error',
    code: 'invalid_reversal',
    ...row,
  }));

  // The first billable month is the current month or the enrollment start
  // month, whichever is later. This catches future-start enrollments without
  // inventing periods for historical/ended enrollments. Bundle components are
  // represented by their own immutable included line (is_included=true), so
  // an owner line alone never creates a false pass for an enrolled component.
  const missingSnapshots = await optionalSection(client, findings, 'missing_canonical_service_snapshots', `
    WITH expected AS (
      SELECT se.student_id, se.service_key,
             GREATEST(
               DATE_TRUNC('month', $1::date)::date,
               DATE_TRUNC('month', se.effective_start)::date
             ) AS expected_period
      FROM service_enrollments se
      JOIN users u
        ON u.id = se.student_id
       AND u.role = 'student'
       AND u.is_active = TRUE
      WHERE se.state = 'active'
        AND (se.effective_end IS NULL OR se.effective_end >= $1::date)
    )
    SELECT expected.student_id, expected.service_key, expected.expected_period,
           i.id AS invoice_id
    FROM expected
    LEFT JOIN invoices i
      ON i.student_id = expected.student_id
     AND i.finance_origin = 'canonical'
     AND i.invoice_kind = 'monthly'
     AND i.billing_period = expected.expected_period
    WHERE i.id IS NULL
    ORDER BY expected.student_id, expected.expected_period, expected.service_key
  `, [`${currentPeriod}-01`]);
  checks.missingCanonicalServiceSnapshots = { count: missingSnapshots.length };
  missingSnapshots.forEach((row) => findings.push({
    section: 'missing_canonical_service_snapshots',
    severity: 'error',
    code: row.invoice_id == null ? 'missing_canonical_monthly_invoice' : 'missing_enrolled_service_snapshot',
    ...row,
  }));

  const canonicalSnapshotGaps = await optionalSection(
    client, findings, 'canonical_invoice_service_snapshots', `
    SELECT i.id AS invoice_id, i.student_id, i.billing_period,
           se.service_key
    FROM invoices i
    JOIN service_enrollments se
      ON se.student_id = i.student_id
     AND se.state = 'active'
     AND se.effective_start <=
       (i.billing_period + INTERVAL '1 month' - INTERVAL '1 day')::date
     AND (se.effective_end IS NULL OR se.effective_end >= i.billing_period)
    WHERE i.finance_origin = 'canonical'
      AND i.invoice_kind = 'monthly'
      AND i.billing_period >= $1::date
      AND NOT EXISTS (
        SELECT 1
        FROM invoice_line_items ili
        WHERE ili.invoice_id = i.id
          AND ili.service_key = se.service_key
          AND ili.line_type = 'charge'
          AND (
            COALESCE(ili.is_included, FALSE) = FALSE
            OR ili.bundle_key IS NOT NULL
            OR ili.metadata ? 'included_in'
          )
      )
    ORDER BY i.billing_period, i.student_id, se.service_key
  `, [`${currentPeriod}-01`]);
  checks.canonicalInvoiceServiceSnapshots = { count: canonicalSnapshotGaps.length };
  canonicalSnapshotGaps.forEach((row) => findings.push({
    section: 'canonical_invoice_service_snapshots',
    severity: 'error',
    code: 'canonical_invoice_missing_enrolled_service_snapshot',
    ...row,
  }));

  // Export routes are intentionally not modified by this command.  This
  // read-only probe catches the known class of numeric/internal values leaking
  // into human-facing review/export metadata.
  const exportAnomalies = await optionalSection(client, findings, 'export_anomalies', `
    SELECT id, action, entity_type, entity_id, details
    FROM audit_logs
    WHERE details IS NOT NULL
      AND (
        details ? 'review_flags' OR details ? 'export_fields'
      )
      AND (
        jsonb_typeof(details->'review_flags') = 'number'
        OR jsonb_typeof(details->'export_fields') = 'number'
      )
    ORDER BY id
  `);
  checks.exportAnomalies = { count: exportAnomalies.length };
  exportAnomalies.forEach((row) => findings.push({
    section: 'export_anomalies',
    severity: 'warning',
    code: 'numeric_internal_value',
    id: row.id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
  }));

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    readOnly: true,
    currentPeriod,
    checks,
    findings,
  };
}

async function main() {
  const pool = db.pool || db;
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await runFinanceCoreAudit(client);
    await client.query('ROLLBACK');
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return result;
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
    const section = error.auditSection ? ` [section: ${error.auditSection}]` : '';
    console.error(`Finance core audit failed${section}:`, error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_TABLES,
  REQUIRED_COLUMNS,
  runFinanceCoreAudit,
  main,
};