/*
 * Read-only, schema-aware carry-forward lineage detection.
 *
 * Installations before the finance reconciliation migration do not have all
 * lineage columns/tables. We detect those shapes instead of assuming a
 * migration ran. A source with any persisted successor is excluded from
 * payable reconstruction and legacy classification.
 */
const CARRIED_FORWARD_STATUS = 'carried forward';

const positiveIds = (values) => [...new Set(values
  .map((value) => Number(value))
  .filter((value) => Number.isSafeInteger(value) && value > 0))];

async function schemaColumns(executor, tableName) {
  try {
    const result = await executor.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
    `, [tableName]);
    return new Set(result.rows.map((row) => String(row.column_name)));
  } catch (_) {
    return new Set();
  }
}

async function getCarryForwardSourceIds(executor, invoiceRows = []) {
  const sourceIds = new Set();
  const ids = positiveIds(invoiceRows.map((row) => row.id));
  invoiceRows.forEach((row) => {
    if (String(row.status || '').trim().toLowerCase() === CARRIED_FORWARD_STATUS) {
      sourceIds.add(Number(row.id));
    }
    if (Number(row.carried_forward_to_invoice_id) > 0) {
      sourceIds.add(Number(row.id));
    }
  });
  if (!ids.length) return sourceIds;

  const invoiceColumns = await schemaColumns(executor, 'invoices');
  if (invoiceColumns.has('carried_forward_to_invoice_id')) {
    const result = await executor.query(`
      SELECT id
      FROM invoices
      WHERE id = ANY($1::integer[])
        AND carried_forward_to_invoice_id IS NOT NULL
    `, [ids]);
    result.rows.forEach((row) => sourceIds.add(Number(row.id)));
  }

  // Some older finance shapes store source identity on the successor row.
  if (invoiceColumns.has('carry_forward_source')) {
    const result = await executor.query(`
      SELECT id, carry_forward_source::text AS carry_forward_source
      FROM invoices
      WHERE id = ANY($1::integer[])
    `, [ids]);
    result.rows.forEach((row) => {
      if (String(row.carry_forward_source).toLowerCase() === 'true') {
        sourceIds.add(Number(row.id));
      } else if (Number(row.carry_forward_source) > 0) {
        sourceIds.add(Number(row.carry_forward_source));
      }
    });
  }

  const linkColumns = await schemaColumns(executor, 'invoice_carry_forward_links');
  if (linkColumns.size) {
    const sourceColumn = ['source_invoice_id', 'source_id', 'carry_forward_source', 'invoice_id']
      .find((column) => linkColumns.has(column));
    const successorColumn = ['successor_invoice_id', 'successor_id', 'target_invoice_id', 'carried_forward_to_invoice_id']
      .find((column) => linkColumns.has(column));
    // A link row without a recognizable successor column is not safe to
    // interpret. A recognizable source + successor is a definitive lineage.
    if (sourceColumn && successorColumn) {
      const result = await executor.query(`
        SELECT ${sourceColumn} AS source_id, ${successorColumn} AS successor_id
        FROM invoice_carry_forward_links
        WHERE ${sourceColumn} = ANY($1::integer[])
          AND ${successorColumn} IS NOT NULL
      `, [ids]);
      result.rows.forEach((row) => {
        if (Number(row.successor_id) > 0) sourceIds.add(Number(row.source_id));
      });
    }
  }
  return sourceIds;
}

module.exports = {
  getCarryForwardSourceIds,
  schemaColumns,
};