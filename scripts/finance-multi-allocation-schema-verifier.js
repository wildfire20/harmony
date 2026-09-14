const { verifyMiniPhase1FinanceSchema, runAuditQuery } = require('./mini-phase1-finance-schema-verifier');

async function verifyFinanceMultiAllocationSchema(client) {
  const prerequisite = await verifyMiniPhase1FinanceSchema(client);
  const missing = [];

  const columns = await runAuditQuery(client, 'finance_multi_allocation_columns', `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('pending_payments', 'selected_obligations'),
        ('payment_transactions', 'allocation_category')
      )
  `);
  const columnSet = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  [
    'pending_payments.selected_obligations',
    'payment_transactions.allocation_category',
  ].forEach((column) => {
    if (!columnSet.has(column)) missing.push(`column ${column}`);
  });

  const index = await runAuditQuery(client, 'one_off_assignment_uniqueness', `
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'invoice_line_items_one_off_assignment_idx'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  `);
  if (!index.rows.length) missing.push('unique index invoice_line_items_one_off_assignment_idx');

  const trigger = await runAuditQuery(client, 'payment_transaction_immutability', `
    SELECT t.tgname, p.proname, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'payment_transactions'
      AND t.tgname = 'payment_transactions_immutable'
      AND p.proname = 'prevent_payment_transaction_mutation'
      AND NOT t.tgisinternal
  `);
  if (!trigger.rows.length) missing.push('trigger payment_transactions_immutable');

  const duplicateAssignments = prerequisite.ok
    ? await runAuditQuery(client, 'one_off_assignment_duplicate_preflight', `
        SELECT metadata->>'assignment_id' AS assignment_id, COUNT(*)::integer AS row_count
        FROM invoice_line_items
        WHERE metadata->>'category' = 'one_off'
          AND metadata->>'assignment_id' IS NOT NULL
        GROUP BY metadata->>'assignment_id'
        HAVING COUNT(*) > 1
        ORDER BY metadata->>'assignment_id'
      `)
    : { rows: [] };

  return {
    ok: prerequisite.ok && missing.length === 0 && duplicateAssignments.rows.length === 0,
    prerequisite,
    target: {
      ok: missing.length === 0,
      missing,
      selectedObligationsColumn: columnSet.has('pending_payments.selected_obligations'),
      allocationCategoryColumn: columnSet.has('payment_transactions.allocation_category'),
      oneOffAssignmentUniqueIndex: index.rows.length === 1,
      paymentTransactionsImmutable: trigger.rows.length === 1,
    },
    duplicateOneOffAssignmentSnapshots: duplicateAssignments.rows,
    safeToMigrate: prerequisite.ok && duplicateAssignments.rows.length === 0,
  };
}

module.exports = { verifyFinanceMultiAllocationSchema };