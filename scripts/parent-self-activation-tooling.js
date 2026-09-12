/*
 * Mini Phase 3.1 controlled migration and read-only rollout audit.
 *
 * This module deliberately receives a database object so the migration and
 * audit can be exercised with a fake client.  It does not import application
 * startup code and never writes Parent data.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILE = path.resolve(__dirname, '..', 'migrations', 'parent_self_activation.sql');
const MAX_REPRESENTATIVE_IDS = 10;
const CATEGORY_NAMES = [
  'DISABLED',
  'ALREADY_ACTIVATED',
  'MISSING_MOBILE',
  'INVALID_MOBILE',
  'DUPLICATE_OR_SHARED_MOBILE',
  'READY_FOR_SELF_ACTIVATION',
  'NEEDS_REVIEW',
];

const REQUIRED_COLUMNS = [
  ['users', 'email_verified_at', ['timestamp with time zone'], true, null],
  ['users', 'parent_account_status', ['character varying'], true, null, 32],
  ['parent_activation_challenges', 'id', ['bigint'], false, 'any'],
  ['parent_activation_challenges', 'user_id', ['integer'], false, null],
  ['parent_activation_challenges', 'email', ['character varying'], false, null, 320],
  ['parent_activation_challenges', 'otp_hash', ['character'], false, null, 64],
  ['parent_activation_challenges', 'expires_at', ['timestamp with time zone'], false, null],
  ['parent_activation_challenges', 'attempts', ['integer'], false, '0'],
  ['parent_activation_challenges', 'max_attempts', ['integer'], false, '5'],
  ['parent_activation_challenges', 'last_sent_at', ['timestamp with time zone'], false, 'now()'],
  ['parent_activation_challenges', 'verified_at', ['timestamp with time zone'], true, null],
  ['parent_activation_challenges', 'delivery_confirmed_at', ['timestamp with time zone'], true, null],
  ['parent_activation_challenges', 'completion_token_hash', ['character'], true, null, 64],
  ['parent_activation_challenges', 'consumed_at', ['timestamp with time zone'], true, null],
  ['parent_activation_challenges', 'invalidated_at', ['timestamp with time zone'], true, null],
  ['parent_activation_challenges', 'created_at', ['timestamp with time zone'], false, 'now()'],
];
// These are the fields read or written by the activation request/verify/
// complete flow.  Unlike the migration contract above, a legacy installation
// must already have these fields: parent_self_activation.sql is intentionally
// not a general Parent portal repair migration.
const RUNTIME_COLUMNS = [
  ['users', 'id', ['integer'], null],
  ['users', 'role', ['character varying'], null],
  ['users', 'is_active', ['boolean'], null],
  ['users', 'password', ['character varying'], null],
  ['users', 'email', ['character varying'], null],
  ['users', 'phone_number', ['character varying'], null],
  ['users', 'activated_at', ['timestamp with time zone'], null],
  ['users', 'must_change_password', ['boolean'], null],
  ['users', 'password_changed_at', ['timestamp with time zone'], null],
  ['users', 'updated_at', ['timestamp without time zone', 'timestamp with time zone'], null],
  ['users', 'student_number', ['character varying'], null],
  ['users', 'first_name', ['character varying'], null],
  ['users', 'last_name', ['character varying'], null],
  ['users', 'grade_id', ['integer'], null],
  ['users', 'class_id', ['integer'], null],
  ['users', 'is_boarder', ['boolean'], null],
  ['users', 'uses_transport', ['boolean'], null],
  ['users', 'uses_aftercare', ['boolean'], null],
  ['parent_students', 'parent_id', ['integer'], null],
  ['parent_students', 'student_id', ['integer'], null],
  ['grades', 'id', ['integer'], null],
  ['grades', 'name', ['character varying'], null],
  ['classes', 'id', ['integer'], null],
  ['classes', 'name', ['character varying'], null],
  ['parent_auth_tokens', 'id', ['bigint'], null],
  ['parent_auth_tokens', 'user_id', ['integer'], null],
  ['parent_auth_tokens', 'token_hash', ['character'], null],
  ['parent_auth_tokens', 'token_type', ['character varying'], null],
  ['parent_auth_tokens', 'expires_at', ['timestamp with time zone'], null],
  ['parent_auth_tokens', 'used_at', ['timestamp with time zone', 'timestamp without time zone'], null],
  ['parent_auth_tokens', 'revoked_at', ['timestamp with time zone', 'timestamp without time zone'], null],
  ['parent_auth_tokens', 'created_at', ['timestamp with time zone'], null],
  ['parent_auth_tokens', 'created_by', ['integer'], null],
  ['parent_sessions', 'id', ['bigint'], null],
  ['parent_sessions', 'user_id', ['integer'], null],
  ['parent_sessions', 'refresh_token_hash', ['character'], null],
  ['parent_sessions', 'family_id', ['uuid'], null],
  ['parent_sessions', 'family_expires_at', ['timestamp with time zone'], null],
  ['parent_sessions', 'expires_at', ['timestamp with time zone'], null],
  ['parent_sessions', 'last_used_at', ['timestamp with time zone'], null],
  ['parent_sessions', 'revoked_at', ['timestamp with time zone'], null],
  ['parent_sessions', 'replaced_by_hash', ['character'], null],
  ['parent_sessions', 'created_at', ['timestamp with time zone'], null],
  ['parent_sessions', 'user_agent', ['text'], null],
  ['parent_sessions', 'ip_address', ['character varying'], null],
  ['audit_logs', 'user_id', ['integer'], null],
  ['audit_logs', 'user_name', ['character varying'], null],
  ['audit_logs', 'user_role', ['character varying'], null],
  ['audit_logs', 'action', ['character varying'], null],
  ['audit_logs', 'entity_type', ['character varying'], null],
  ['audit_logs', 'entity_id', ['integer'], null],
  ['audit_logs', 'details', ['jsonb'], null],
  ['audit_logs', 'ip_address', ['character varying'], null],
];
const REQUIRED_INDEXES = [
  ['idx_parent_activation_challenges_user', ['user_id']],
  ['idx_parent_activation_challenges_expiry', ['expires_at']],
  ['idx_parent_activation_challenges_created', ['user_id', 'created_at']],
];
const PHASE2_INDEXES = [
  ['idx_parent_auth_tokens_user', 'parent_auth_tokens', ['user_id']],
  ['idx_parent_auth_tokens_expiry', 'parent_auth_tokens', ['expires_at']],
  ['idx_parent_sessions_user', 'parent_sessions', ['user_id']],
  ['idx_parent_sessions_family', 'parent_sessions', ['family_id']],
  ['idx_parent_sessions_expiry', 'parent_sessions', ['expires_at']],
];
const REQUIRED_TABLES = [
  'users', 'parent_students', 'parent_auth_tokens', 'parent_sessions', 'audit_logs', 'grades', 'classes',
];
const OPTIONAL_PRIOR_MISSING = new Set([
  'column users.email_verified_at',
  'column users.parent_account_status',
  'column parent_activation_challenges.delivery_confirmed_at',
  'column parent_activation_challenges.completion_token_hash',
  ...REQUIRED_INDEXES.map(([name]) => `index parent_activation_challenges.${name}`),
]);

const TABLES_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = ANY($1::text[])
`;
const COLUMNS_SQL = `
  SELECT table_name, column_name, data_type, udt_name, is_nullable,
         column_default, character_maximum_length
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY($1::text[])
`;
const CONSTRAINTS_SQL = `
  SELECT c.conname, c.contype, cls.relname AS table_name,
         COALESCE((SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
           ARRAY[]::text[]) AS columns,
         COALESCE((SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum),
           ARRAY[]::text[]) AS referenced_columns,
         ref.relname AS referenced_table, ns_ref.nspname AS referenced_schema,
         pg_get_constraintdef(c.oid) AS definition,
         CASE c.confdeltype WHEN 'a' THEN 'NO ACTION'
           WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
           WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
  FROM pg_constraint c
  JOIN pg_class cls ON cls.oid = c.conrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  LEFT JOIN pg_class ref ON ref.oid = c.confrelid
  LEFT JOIN pg_namespace ns_ref ON ns_ref.oid = ref.relnamespace
  WHERE ns.nspname = 'public'
`;
const INDEXES_SQL = `
  SELECT indexname, tablename, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = ANY($1::text[])
`;

function normalizeDefault(value) {
  if (value == null) return null;
  let result = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  while (result.startsWith('(') && result.endsWith(')')) result = result.slice(1, -1).trim();
  result = result.replace(/::[a-z_ ]+(\[\])?$/i, '').trim();
  if (result === 'current_timestamp') return 'now()';
  return result;
}

function typeMatches(row, types) {
  const dataType = String(row?.data_type || '').toLowerCase();
  const udt = String(row?.udt_name || '').toLowerCase().replace(/_/g, ' ');
  return types.some((type) => dataType === type || udt === type);
}

function columnMatches(row, [, , types, nullable, expectedDefault, length]) {
  if (!row || !typeMatches(row, types)) return false;
  if (String(row.is_nullable || '').toUpperCase() !== (nullable ? 'YES' : 'NO')) return false;
  if (expectedDefault === 'any') {
    if (row.column_default == null) return false;
  } else if (normalizeDefault(row.column_default) !== normalizeDefault(expectedDefault)) {
    return false;
  }
  return length == null || Number(row.character_maximum_length) === length;
}

function runtimeColumnMatches(row, spec) {
  if (!row || !spec[2].some((type) => typeMatches(row, [type]))) return false;
  return spec[3] == null || String(row.is_nullable || '').toUpperCase() === spec[3];
}

function constraintColumns(row, referenced, expected) {
  const actual = row[referenced ? 'referenced_columns' : 'columns'];
  if (Array.isArray(actual) && actual.length) {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  const definition = String(row.definition || '').replace(/\s+/g, ' ');
  const escaped = expected.join('\\s*,\\s*');
  if (referenced) return new RegExp(`REFERENCES\\s+(?:public\\.)?[a-z_]+\\s*\\(\\s*${escaped}\\s*\\)`, 'i').test(definition);
  return new RegExp(`(?:PRIMARY KEY|UNIQUE|FOREIGN KEY)\\s*\\(\\s*${escaped}\\s*\\)`, 'i').test(definition);
}

function indexColumns(indexdef) {
  const match = String(indexdef || '').match(/\((.*)\)/);
  if (!match) return [];
  return match[1].split(',').map((part) => part.trim().replace(/["`]/g, '').split(/\s+/)[0]);
}

async function inspectSchema(client) {
  const names = [...REQUIRED_TABLES, 'parent_activation_challenges'];
  const indexTables = ['parent_activation_challenges', 'parent_auth_tokens', 'parent_sessions'];
  const [tables, columns, constraints, indexes] = await Promise.all([
    client.query(TABLES_SQL, [names]),
    client.query(COLUMNS_SQL, [names]),
    client.query(CONSTRAINTS_SQL),
    client.query(INDEXES_SQL, [indexTables]),
  ]);
  const tableSet = new Set((tables.rows || []).map((row) => String(row.table_name)));
  const columnRows = columns.rows || [];
  const columnMap = new Map(columnRows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const missing = [];
  for (const table of REQUIRED_TABLES) {
    if (!tableSet.has(table)) missing.push(`table ${table}`);
  }
  if (!tableSet.has('parent_activation_challenges')) missing.push('table parent_activation_challenges');
  for (const spec of RUNTIME_COLUMNS) {
    const key = `${spec[0]}.${spec[1]}`;
    if (!columnMap.has(key)) missing.push(`column ${key}`);
    else if (!runtimeColumnMatches(columnMap.get(key), spec)) missing.push(`column definition ${key}`);
  }
  for (const spec of REQUIRED_COLUMNS) {
    const key = `${spec[0]}.${spec[1]}`;
    if (!columnMap.has(key)) missing.push(`column ${key}`);
    else if (!columnMatches(columnMap.get(key), spec)) missing.push(`column definition ${key}`);
  }
  const indexRows = indexes.rows || [];
  for (const [name, expectedColumns] of REQUIRED_INDEXES) {
    const row = indexRows.find((item) => item.indexname === name &&
      item.tablename === 'parent_activation_challenges');
    if (!row) {
      missing.push(`index parent_activation_challenges.${name}`);
    } else if (JSON.stringify(indexColumns(row.indexdef)) !== JSON.stringify(expectedColumns)) {
      missing.push(`incompatible index parent_activation_challenges.${name}`);
    }
  }
  for (const [name, table, expectedColumns] of PHASE2_INDEXES) {
    const row = indexRows.find((item) => item.indexname === name && item.tablename === table);
    if (!row) {
      missing.push(`index ${table}.${name}`);
    } else if (JSON.stringify(indexColumns(row.indexdef)) !== JSON.stringify(expectedColumns)) {
      missing.push(`incompatible index ${table}.${name}`);
    }
  }
  const constraintRows = constraints.rows || [];
  const hasConstraint = (table, contype, columns, referencedTable, referencedColumns, onDelete) =>
    constraintRows.some((row) => row.table_name === table &&
      String(row.contype).toLowerCase() === contype &&
      (!columns || constraintColumns(row, false, columns)) &&
      (!referencedTable || row.referenced_table === referencedTable) &&
      (!referencedColumns || constraintColumns(row, true, referencedColumns)) &&
      (!onDelete || String(row.on_delete || '').toUpperCase() === onDelete));
  const constraintsNeeded = [
    ['parent_activation_challenges', 'p', ['id']],
    ['parent_activation_challenges', 'f', ['user_id'], 'users', ['id'], 'CASCADE'],
    ['parent_auth_tokens', 'p', ['id']],
    ['parent_auth_tokens', 'u', ['token_hash']],
    ['parent_auth_tokens', 'f', ['user_id'], 'users', ['id'], 'CASCADE'],
    ['parent_auth_tokens', 'f', ['created_by'], 'users', ['id'], 'SET NULL'],
    ['parent_sessions', 'p', ['id']],
    ['parent_sessions', 'u', ['refresh_token_hash']],
    ['parent_sessions', 'f', ['user_id'], 'users', ['id'], 'CASCADE'],
    ['parent_students', 'u', ['parent_id', 'student_id']],
    ['parent_students', 'f', ['parent_id'], 'users', ['id'], 'CASCADE'],
    ['parent_students', 'f', ['student_id'], 'users', ['id'], 'CASCADE'],
  ];
  for (const constraint of constraintsNeeded) {
    if (!hasConstraint(...constraint)) {
      const [table, type, cols] = constraint;
      missing.push(`${type === 'f' ? 'foreign key' : type === 'u' ? 'unique' : 'primary key'} ${table}(${cols.join(',')})`);
    }
  }
  // The token CHECK is part of the existing Phase 2 contract.
  if (!constraintRows.some((row) => row.table_name === 'parent_auth_tokens' &&
      String(row.contype).toLowerCase() === 'c' &&
      /activation/.test(String(row.definition || '')) &&
      /reset/.test(String(row.definition || '')))) {
    missing.push('check parent_auth_tokens.token_type activation/reset');
  }
  return {
    ok: missing.length === 0, missing, tables: tableSet, columns: columnMap,
    constraints: constraintRows, indexes: indexRows,
  };
}

function preMigrationUnsupported(schema) {
  const missing = schema.missing || [];
  const challengeAbsent = !schema.tables.has('parent_activation_challenges');
  const unsupported = missing.filter((item) => {
    if (item === 'column users.email_verified_at' || item === 'column users.parent_account_status') return false;
    if (item.startsWith('column definition users.email_verified_at') ||
        item.startsWith('column definition users.parent_account_status')) return true;
    if (challengeAbsent && (
      item === 'table parent_activation_challenges' ||
      item.startsWith('column parent_activation_challenges.') ||
      item.startsWith('column definition parent_activation_challenges.') ||
      item.startsWith('index parent_activation_challenges.') ||
      item.startsWith('primary key parent_activation_challenges') ||
      item.startsWith('foreign key parent_activation_challenges'))) return false;
    if (!challengeAbsent && OPTIONAL_PRIOR_MISSING.has(item)) return false;
    return true;
  });
  return unsupported;
}

function asCount(row, key = 'count') {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : 0;
}

async function countIfTableExists(client, tableName, schema) {
  if (!schema.tables.has(tableName)) return null;
  let query = `SELECT COUNT(*)::int AS count FROM ${tableName}`;
  if (tableName === 'parent_sessions') {
    query = 'SELECT COUNT(*)::int AS count FROM parent_sessions WHERE revoked_at IS NULL AND expires_at > NOW()';
  }
  const result = await client.query(query);
  return asCount(result.rows?.[0]);
}

async function snapshot(client, schema) {
  const sessionTable = schema.tables.has('parent_sessions') ? 'parent_sessions' : null;
  const [parents, links, sessions, tokens] = await Promise.all([
    client.query(`SELECT COUNT(*)::int AS parent_count,
      COUNT(password)::int AS password_count,
      COUNT(DISTINCT md5(COALESCE(password, '')))::int AS password_fingerprint_count,
      md5(COALESCE(string_agg(COALESCE(password, ''), '|' ORDER BY id), '')) AS password_fingerprint_digest
      FROM users WHERE role='parent'`),
    client.query('SELECT COUNT(*)::int AS count FROM parent_students'),
    sessionTable ? countIfTableExists(client, sessionTable, schema) : null,
    countIfTableExists(client, 'parent_auth_tokens', schema),
  ]);
  const row = parents.rows?.[0] || {};
  return {
    parentCount: asCount(row, 'parent_count'),
    passwordCount: asCount(row, 'password_count'),
    passwordFingerprintCount: asCount(row, 'password_fingerprint_count'),
    // Keep the digest private: it is only used for the in-transaction check.
    passwordFingerprintDigest: row.password_fingerprint_digest == null
      ? crypto.createHash('sha256').update('').digest('hex') : String(row.password_fingerprint_digest),
    parentStudentsCount: asCount(links.rows?.[0]),
    activeSessionsCount: sessions,
    parentAuthTokensCount: tokens,
  };
}

function compareSnapshots(before, after) {
  const keys = ['parentCount', 'passwordCount', 'passwordFingerprintCount',
    'passwordFingerprintDigest', 'parentStudentsCount', 'activeSessionsCount', 'parentAuthTokensCount'];
  return keys.filter((key) => before[key] !== after[key]);
}

async function runMigration({ database, migrationPath = MIGRATION_FILE } = {}) {
  const db = database || require('../config/database');
  const pool = db.pool || db;
  let client;
  let primaryError;
  let committed = false;
  let result;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const beforeSchema = await inspectSchema(client);
    const unsupported = preMigrationUnsupported(beforeSchema);
    if (unsupported.length) {
      throw new Error(`pre-migration schema unsupported: ${unsupported.join(', ')}`);
    }
    const before = await snapshot(client, beforeSchema);
    await client.query(fs.readFileSync(migrationPath, 'utf8'));
    const afterSchema = await inspectSchema(client);
    const after = await snapshot(client, afterSchema);
    const drift = compareSnapshots(before, after);
    if (drift.length) throw new Error(`preservation verification failed: ${drift.join(', ')}`);
    if (!afterSchema.ok) throw new Error(`schema verification failed: ${afterSchema.missing.join(', ')}`);
    await client.query('COMMIT');
    committed = true;
    result = { ok: true, schema: afterSchema };
  } catch (error) {
    primaryError = error;
  } finally {
    if (client && !committed) {
      try { await client.query('ROLLBACK'); } catch (error) {
        if (!primaryError) primaryError = error;
      }
    }
    if (client) {
      try { await client.release(); } catch (error) {
        if (!primaryError) primaryError = error;
      }
    }
    try {
      if (typeof pool.end === 'function') await pool.end();
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  let value = String(raw).trim().replace(/[\s().-]/g, '');
  if (value.startsWith('00')) value = value.slice(2);
  if (value.startsWith('+')) value = value.slice(1);
  if (value.startsWith('0')) value = `27${value.slice(1)}`;
  if (value.startsWith('270')) value = `27${value.slice(3)}`;
  return /^27[6-8]\d{8}$/.test(value) ? value : '';
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function categorizeParents(rows, limit = MAX_REPRESENTATIVE_IDS) {
  const parents = rows || [];
  const groups = new Map();
  for (const parent of parents) {
    const normalized = normalizePhone(parent.phone_number);
    if (normalized) groups.set(normalized, [...(groups.get(normalized) || []), parent]);
  }
  const duplicateIds = new Set([...groups.values()].filter((group) => group.length > 1)
    .flat().map((parent) => Number(parent.id)));
  const categories = Object.fromEntries(CATEGORY_NAMES.map((name) => [name, 0]));
  const representatives = Object.fromEntries(CATEGORY_NAMES.map((name) => [name, []]));
  const add = (category, id) => {
    categories[category] += 1;
    if (representatives[category].length < limit) representatives[category].push(Number(id));
  };
  for (const parent of parents) {
    const normalized = normalizePhone(parent.phone_number);
    let category;
    if (!truthy(parent.is_active)) category = 'DISABLED';
    else if (parent.activated_at || String(parent.parent_account_status || '').toLowerCase() === 'active') {
      category = 'ALREADY_ACTIVATED';
    } else if (!String(parent.phone_number || '').trim()) category = 'MISSING_MOBILE';
    else if (!normalized) category = 'INVALID_MOBILE';
    else if (duplicateIds.has(Number(parent.id))) category = 'DUPLICATE_OR_SHARED_MOBILE';
    else if (String(parent.parent_account_status || '').toLowerCase() === 'needs_review') {
      category = 'NEEDS_REVIEW';
    } else category = 'READY_FOR_SELF_ACTIVATION';
    add(category, parent.id);
  }
  const count = (name) => categories[name] || 0;
  return {
    total: parents.length,
    active: parents.filter((parent) => truthy(parent.is_active)).length,
    inactive: parents.filter((parent) => !truthy(parent.is_active)).length,
    activated: parents.filter((parent) => parent.activated_at ||
      String(parent.parent_account_status || '').toLowerCase() === 'active').length,
    unactivated: parents.filter((parent) => !(parent.activated_at ||
      String(parent.parent_account_status || '').toLowerCase() === 'active')).length,
    mobile_present: parents.filter((parent) => String(parent.phone_number || '').trim()).length,
    mobile_missing: parents.filter((parent) => !String(parent.phone_number || '').trim()).length,
    valid_normalized_mobile: parents.filter((parent) => normalizePhone(parent.phone_number)).length,
    invalid_mobile: parents.filter((parent) => String(parent.phone_number || '').trim() && !normalizePhone(parent.phone_number)).length,
    email_present: parents.filter((parent) => String(parent.email || '').trim()).length,
    email_missing: parents.filter((parent) => !String(parent.email || '').trim()).length,
    duplicate_groups: [...groups.values()].filter((group) => group.length > 1).length,
    duplicate_affected_accounts: duplicateIds.size,
    duplicate_normalized_mobile_groups: [...groups.values()].filter((group) => group.length > 1).length,
    duplicate_normalized_mobile_affected_accounts: duplicateIds.size,
    multi_learner_parents: parents.filter((parent) => Number(parent.linked_learner_count || 0) > 1).length,
    categories,
    ready_count: count('READY_FOR_SELF_ACTIVATION'),
    admin_cleanup_count: parents.length - count('READY_FOR_SELF_ACTIVATION') - count('ALREADY_ACTIVATED'),
    representative_parent_ids: representatives,
    duplicate_representative_parent_ids: [...duplicateIds].slice(0, limit),
  };
}

async function readParentRows(client, schema) {
  if (!schema.tables.has('users')) return [];
  const has = (column) => schema.columns.has(`users.${column}`);
  const field = (column, fallback = 'NULL') => has(column) ? `p.${column}` : fallback;
  const links = schema.tables.has('parent_students')
    ? '(SELECT COUNT(DISTINCT ps.student_id)::int FROM parent_students ps WHERE ps.parent_id=p.id)'
    : '0::int';
  const roleFilter = has('role') ? `WHERE p.role='parent'` : 'WHERE FALSE';
  const result = await client.query(`SELECT p.id,
    ${field('is_active', 'TRUE')} AS is_active,
    ${field('activated_at')} AS activated_at,
    ${field('email')} AS email,
    ${field('phone_number')} AS phone_number,
    ${field('parent_account_status')} AS parent_account_status,
    ${links} AS linked_learner_count
    FROM users p ${roleFilter}
    ORDER BY p.id`);
  return result.rows || [];
}

async function runAudit({ database, sampleSize = MAX_REPRESENTATIVE_IDS } = {}) {
  const db = database || require('../config/database');
  const pool = db.pool || db;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    let schema;
    try {
      schema = await inspectSchema(client);
    } catch (error) {
      schema = { ok: false, missing: [`schema inspection failed: ${error.message}`], tables: new Set(), columns: new Map() };
    }
    let rollout = categorizeParents([]);
    try {
      rollout = categorizeParents(await readParentRows(client, schema), sampleSize);
    } catch (error) {
      rollout = { ...rollout, error: `rollout read failed: ${error.message}` };
    }
    return { audit: true, ok: schema.ok, missing: schema.missing, rollout };
  } finally {
    let cleanupError;
    if (client) {
      try { await client.query('ROLLBACK'); } catch (error) { cleanupError = error; }
      try { await client.release(); } catch (error) { cleanupError ||= error; }
    }
    try {
      if (typeof pool.end === 'function') await pool.end();
    } catch (error) { cleanupError ||= error; }
    if (cleanupError) throw cleanupError;
  }
}

module.exports = {
  MIGRATION_FILE, REQUIRED_COLUMNS, RUNTIME_COLUMNS, REQUIRED_INDEXES, PHASE2_INDEXES,
  CATEGORY_NAMES, normalizePhone,
  inspectSchema, preMigrationUnsupported, snapshot, compareSnapshots, runMigration,
  categorizeParents, readParentRows, runAudit,
};