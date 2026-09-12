/*
 * Diagnostic-only parent schema catalog dump.
 *
 * This uses the same shared database configuration as the application and
 * migration runners, but never calls database initialization. The command uses
 * one client, one read-only transaction, and a closed registry of catalog
 * queries. It never reads application rows.
 */
require('dotenv').config();

const TABLE_ALLOWLIST = Object.freeze([
  'parent_auth_tokens',
  'parent_sessions',
  'parent_notifications',
  'parent_notification_reads',
  'parent_push_subscriptions',
  'announcements',
  'documents',
]);

const QUERIES = Object.freeze({
  begin: 'BEGIN TRANSACTION READ ONLY',
  timeout: "SET LOCAL statement_timeout = '15000ms'",
  transactionReadOnly: 'SHOW transaction_read_only',
  rollback: 'ROLLBACK',
  tables: `
    SELECT n.nspname AS table_schema, c.relname AS table_name,
           c.relkind::text AS relation_kind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = ANY($1::text[])
    ORDER BY n.nspname, c.relname
  `,
  otherSchemaNames: `
    SELECT n.nspname AS table_schema, c.relname AS table_name,
           c.relkind::text AS relation_kind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public'
      AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
      AND c.relname = ANY($1::text[])
    ORDER BY n.nspname, c.relname
  `,
  columns: `
    SELECT c.table_schema, c.table_name, c.ordinal_position, c.column_name,
           c.data_type, c.udt_name, c.is_nullable, c.column_default,
            c.is_identity, c.identity_generation, c.is_generated,
           c.generation_expression, c.character_maximum_length,
           c.numeric_precision, c.numeric_scale,
           a.attidentity::text AS raw_attidentity,
           a.attgenerated::text AS raw_attgenerated,
           a.attnotnull AS raw_attnotnull,
           a.atttypmod AS raw_atttypmod
    FROM information_schema.columns c
    JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
    JOIN pg_catalog.pg_class cls
      ON cls.relnamespace = n.oid AND cls.relname = c.table_name
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = cls.oid AND a.attname = c.column_name
     AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.table_schema = 'public'
      AND c.table_name = ANY($1::text[])
    ORDER BY c.table_schema, c.table_name, c.ordinal_position
  `,
  sequences: `
    SELECT seq_ns.nspname AS sequence_schema, seq.relname AS sequence_name,
           tbl_ns.nspname AS owning_table_schema,
           tbl.relname AS owning_table, col.attname AS owning_column,
           dep.deptype::text AS raw_dependency_type,
           s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache,
           s.seqcycle
    FROM pg_catalog.pg_class seq
    JOIN pg_catalog.pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
    JOIN pg_catalog.pg_sequence s ON s.seqrelid = seq.oid
    JOIN pg_catalog.pg_depend dep
      ON dep.objid = seq.oid AND dep.classid = 'pg_class'::regclass
     AND dep.deptype IN ('a', 'i')
    JOIN pg_catalog.pg_class tbl ON tbl.oid = dep.refobjid
    JOIN pg_catalog.pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    JOIN pg_catalog.pg_attribute col
      ON col.attrelid = tbl.oid AND col.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
      AND tbl_ns.nspname = 'public'
      AND tbl.relname = ANY($1::text[])
    ORDER BY seq_ns.nspname, seq.relname, tbl.relname, col.attnum
  `,
  indexes: `
    SELECT tbl_ns.nspname AS table_schema, tbl.relname AS table_name,
           idx_ns.nspname AS index_schema, idx.relname AS index_name,
           am.amname AS access_method, ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary, ix.indisvalid AS is_valid,
           ix.indisready AS is_ready,
           pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
           pg_get_indexdef(ix.indexrelid) AS index_definition,
           ix.indkey::text AS raw_indkey, ix.indoption::text AS raw_indoption,
           ix.indnkeyatts, ix.indnatts,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                'position', k.ord,
                'attnum', k.attnum,
                'column', CASE WHEN k.attnum > 0
                 THEN (SELECT a.attname FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid = ix.indrelid
                          AND a.attnum = k.attnum
                         AND NOT a.attisdropped)
                 ELSE NULL END,
                'expression', pg_get_indexdef(ix.indexrelid, k.ord::integer, true),
                'option_bits', ix.indoption[k.ord - 1],
               'direction', CASE WHEN am.amname = 'btree'
                  THEN CASE WHEN (ix.indoption[k.ord - 1] & 1) <> 0
                   THEN 'DESC' ELSE 'ASC' END ELSE NULL END,
               'null_order', CASE WHEN am.amname = 'btree'
                  THEN CASE WHEN (ix.indoption[k.ord - 1] & 2) <> 0
                   THEN 'FIRST' ELSE 'LAST' END ELSE NULL END,
               'option_bits_decoded', CASE WHEN am.amname = 'btree'
                 THEN jsonb_build_object(
                    'desc', ((ix.indoption[k.ord - 1] & 1) <> 0),
                    'nulls_first', ((ix.indoption[k.ord - 1] & 2) <> 0))
                 ELSE jsonb_build_object(
                   'access_method_specific', true) END
              ) ORDER BY k.ord)
              FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
              WHERE k.ord <= ix.indnkeyatts
           ), '[]'::jsonb) AS indexed_keys,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                'position', k.ord,
                'attnum', k.attnum,
                'column', CASE WHEN k.attnum > 0
                 THEN (SELECT a.attname FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid = ix.indrelid
                          AND a.attnum = k.attnum
                         AND NOT a.attisdropped)
                 ELSE NULL END,
                'expression', pg_get_indexdef(ix.indexrelid, k.ord::integer, true),
                'option_bits', ix.indoption[k.ord - 1]
              ) ORDER BY k.ord)
              FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
              WHERE k.ord > ix.indnkeyatts
           ), '[]'::jsonb) AS included_columns
    FROM pg_catalog.pg_index ix
    JOIN pg_catalog.pg_class idx ON idx.oid = ix.indexrelid
    JOIN pg_catalog.pg_namespace idx_ns ON idx_ns.oid = idx.relnamespace
    JOIN pg_catalog.pg_class tbl ON tbl.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    WHERE tbl_ns.nspname = 'public'
      AND tbl.relname = ANY($1::text[])
    ORDER BY tbl_ns.nspname, tbl.relname, idx_ns.nspname, idx.relname
  `,
  constraints: `
    SELECT tbl_ns.nspname AS constraint_schema,
           tbl_ns.nspname AS table_schema, tbl.relname AS table_name,
           c.conname AS constraint_name, c.contype::text AS raw_contype,
           CASE c.contype
             WHEN 'c' THEN 'CHECK'
             WHEN 'f' THEN 'FOREIGN KEY'
             WHEN 'p' THEN 'PRIMARY KEY'
             WHEN 'u' THEN 'UNIQUE'
             WHEN 'x' THEN 'EXCLUSION'
             WHEN 't' THEN 'TRIGGER'
              WHEN 'n' THEN 'NOT NULL'
             ELSE 'UNKNOWN'
           END AS constraint_type,
           c.convalidated AS is_validated, c.condeferrable AS is_deferrable,
           c.condeferred AS is_deferred,
           c.conkey::text AS raw_conkey, c.confkey::text AS raw_confkey,
           c.confupdtype::text AS raw_confupdtype,
           c.confdeltype::text AS raw_confdeltype,
           c.confmatchtype::text AS raw_confmatchtype,
           COALESCE((
             SELECT array_agg(a.attname ORDER BY k.ord)
             FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
             JOIN pg_catalog.pg_attribute a
               ON a.attrelid = c.conrelid AND a.attnum = k.attnum
           ), ARRAY[]::text[]) AS columns,
           COALESCE((
             SELECT array_agg(a.attname ORDER BY k.ord)
             FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
             JOIN pg_catalog.pg_attribute a
               ON a.attrelid = c.confrelid AND a.attnum = k.attnum
           ), ARRAY[]::text[]) AS referenced_columns,
           ref_ns.nspname AS referenced_schema,
           ref.relname AS referenced_table,
           pg_get_constraintdef(c.oid) AS constraint_definition,
           CASE c.confmatchtype
             WHEN 'f' THEN 'FULL'
             WHEN 'p' THEN 'PARTIAL'
             WHEN 's' THEN 'SIMPLE'
             ELSE NULL
           END AS match_type,
           CASE c.confupdtype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
             ELSE NULL
           END AS on_update,
           CASE c.confdeltype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
             ELSE NULL
           END AS on_delete
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_catalog.pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    LEFT JOIN pg_catalog.pg_class ref ON ref.oid = c.confrelid
    LEFT JOIN pg_catalog.pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
    WHERE tbl_ns.nspname = 'public'
      AND tbl.relname = ANY($1::text[])
    ORDER BY tbl_ns.nspname, tbl.relname, c.conname
  `,
});

function sharedDatabase() {
  return require('../config/database');
}

async function fixedQuery(client, queryId, params) {
  if (!Object.prototype.hasOwnProperty.call(QUERIES, queryId)) {
    throw new Error(`Unknown parent schema diagnostic query: ${queryId}`);
  }
  return client.query(QUERIES[queryId], params);
}

function stableRows(result) {
  return (result && Array.isArray(result.rows)) ? result.rows : [];
}

async function runDiagnostic({ database, outputStream = process.stdout } = {}) {
  const databaseHandle = database || sharedDatabase();
  const pool = databaseHandle.pool || databaseHandle;
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('A database pool is required');
  }

  let client;
  let diagnostic;
  let primaryError;
  const rememberError = (error) => {
    if (!primaryError) primaryError = error;
    else primaryError.cleanupErrors = [...(primaryError.cleanupErrors || []), error];
  };

  try {
    client = await pool.connect();
    await fixedQuery(client, 'begin');
    await fixedQuery(client, 'timeout');
    const readOnlyResult = await fixedQuery(client, 'transactionReadOnly');
    const readOnly = readOnlyResult && readOnlyResult.rows && readOnlyResult.rows[0]
      ? readOnlyResult.rows[0].transaction_read_only
      : undefined;
    if (!(readOnly === true || readOnly === 'on' || readOnly === 'true' || readOnly === 't')) {
      throw new Error(`Diagnostic transaction is not read-only (reported ${String(readOnly)})`);
    }

    const tableParams = [TABLE_ALLOWLIST];
    const tables = await fixedQuery(client, 'tables', tableParams);
    const otherSchemaNames = await fixedQuery(client, 'otherSchemaNames', tableParams);
    const columns = await fixedQuery(client, 'columns', tableParams);
    const sequences = await fixedQuery(client, 'sequences', tableParams);
    const indexes = await fixedQuery(client, 'indexes', tableParams);
    const constraints = await fixedQuery(client, 'constraints', tableParams);
    diagnostic = {
      transaction: { read_only: true, statement_timeout: '15000ms' },
      table_allowlist: [...TABLE_ALLOWLIST],
      tables: stableRows(tables),
      other_schema_names: stableRows(otherSchemaNames),
      columns: stableRows(columns),
      sequences: stableRows(sequences),
      indexes: stableRows(indexes),
      constraints: stableRows(constraints),
    };
  } catch (error) {
    rememberError(error);
  } finally {
    if (client) {
      try {
        await fixedQuery(client, 'rollback');
      } catch (error) {
        rememberError(error);
      }
      try {
        await client.release();
      } catch (error) {
        rememberError(error);
      }
    }
    try {
      if (typeof pool.end === 'function') await pool.end();
    } catch (error) {
      rememberError(error);
    }
  }

  if (primaryError) throw primaryError;
  const serialized = `${JSON.stringify(diagnostic, null, 2)}\n`;
  if (outputStream && typeof outputStream.write === 'function') outputStream.write(serialized);
  return diagnostic;
}

if (require.main === module) {
  runDiagnostic().catch((error) => {
    console.error(`Parent schema diagnostic failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  TABLE_ALLOWLIST,
  QUERIES,
  fixedQuery,
  runDiagnostic,
  sharedDatabase,
};