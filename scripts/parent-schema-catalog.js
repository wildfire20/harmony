/*
 * Shared normalization for PostgreSQL catalog metadata.
 *
 * PostgreSQL name[] values are not consistently decoded by every pg driver
 * version and may arrive as strings such as "{parent_id,dedupe_key}".
 */
function parsePgArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value == null || value === '') return [];
  const input = String(value);
  if (!(input.startsWith('{') && input.endsWith('}'))) return [input];
  if (input === '{}') return [];

  const values = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of input.slice(1, -1)) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current);
  return values.map((item) => item === 'NULL' ? '' : item);
}

function normalizeIndexMetadata(row) {
  const indexedKeys = Array.isArray(row.indexed_keys) ? row.indexed_keys : [];
  return {
    ...row,
    table_name: row.table_name,
    indexname: row.indexname || row.index_name,
    method: String(row.method || row.access_method || '').toLowerCase(),
    columns: parsePgArray(row.columns != null
      ? row.columns
      : indexedKeys.map((key) => key.column || key.expression).filter(Boolean)),
    directions: parsePgArray(row.directions),
    is_unique: row.is_unique,
    is_primary: row.is_primary,
    is_valid: row.is_valid,
    is_ready: row.is_ready,
  };
}

function normalizeConstraintMetadata(row) {
  return {
    ...row,
    table_name: row.table_name,
    conname: row.conname || row.constraint_name,
    contype: String(row.contype || row.raw_contype || ''),
    columns: parsePgArray(row.columns),
    referenced_columns: parsePgArray(row.referenced_columns),
    referenced_schema: row.referenced_schema || null,
    referenced_table: row.referenced_table || null,
    on_delete: row.on_delete || null,
  };
}

module.exports = {
  parsePgArray,
  normalizeIndexMetadata,
  normalizeConstraintMetadata,
};