const REQUIRED_TABLES = ['learner_discount_assignments', 'invoice_line_items'];
const REQUIRED_COLUMNS = [
  ['service_prices', 'billing_mode'],
  ['service_prices', 'included_service_keys'],
  ['invoice_line_items', 'invoice_id'],
  ['invoice_line_items', 'line_type'],
  ['invoice_line_items', 'amount'],
];
const REQUIRED_INDEXES = [
  'learner_discount_assignments_student_idx',
  'invoice_line_items_invoice_idx',
  'service_prices_bundle_idx',
];

async function runAuditQuery(client, section, text, values = []) {
  try {
    return await client.query(text, values);
  } catch (error) {
    const wrapped = new Error(`Audit query failed in section "${section}": ${error.message}`);
    wrapped.auditSection = section;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function verifyMiniPhase1FinanceSchema(client) {
  const missing = [];
  const tables = await runAuditQuery(client, 'required_tables', `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  `, [REQUIRED_TABLES]);
  const tableSet = new Set(tables.rows.map((row) => row.table_name));
  REQUIRED_TABLES.forEach((table) => {
    if (!tableSet.has(table)) missing.push(`table ${table}`);
  });

  const columns = await runAuditQuery(client, 'required_columns', `
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        SELECT x.table_name, x.column_name
        FROM jsonb_to_recordset($1::jsonb) AS x(table_name text, column_name text)
      )
  `, [JSON.stringify(REQUIRED_COLUMNS.map(([table_name, column_name]) => ({ table_name, column_name })))]);
  const columnSet = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  REQUIRED_COLUMNS.forEach(([table, column]) => {
    if (!columnSet.has(`${table}.${column}`)) missing.push(`column ${table}.${column}`);
  });

  const indexes = await runAuditQuery(client, 'required_indexes', `
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY($1::text[])
  `, [REQUIRED_INDEXES]);
  const indexSet = new Set(indexes.rows.map((row) => row.indexname));
  REQUIRED_INDEXES.forEach((index) => {
    if (!indexSet.has(index)) missing.push(`index ${index}`);
  });

  const constraintTables = [
    'learner_discount_assignments',
    'invoice_line_items',
    'service_prices',
  ];
  const constraints = await runAuditQuery(client, 'required_check_constraints', `
    SELECT c.relname AS table_name, pg_get_constraintdef(pc.oid) AS definition
    FROM pg_constraint pc
    JOIN pg_class c ON c.oid = pc.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND pc.contype = 'c'
  `, [constraintTables]);
  const definitions = constraints.rows.map((row) => row.definition).join(' ');
  [
    'staff', 'sibling', 'custom', 'fixed', 'percentage',
    'billing_mode', 'amount >=',
  ].forEach((fragment) => {
    if (!definitions.toLowerCase().includes(fragment.toLowerCase())) missing.push(`check ${fragment}`);
  });

  const trigger = await runAuditQuery(client, 'invoice_line_items_immutability_trigger', `
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'invoice_line_items_immutable'
      AND NOT tgisinternal
  `);
  if (!trigger.rows.length) missing.push('trigger invoice_line_items_immutable');

  return { ok: missing.length === 0, missing };
}

module.exports = {
  verifyMiniPhase1FinanceSchema,
  REQUIRED_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  runAuditQuery,
};