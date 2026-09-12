/*
 * Read-only Phase 5A parent rollout preflight.
 *
 * This file intentionally bypasses the application's startup setup. A
 * preflight must be safe to run against an installation where any of the
 * manual migrations have not yet been applied.
 */
const fs = require('node:fs');
const path = require('node:path');
const sharedSchemaVerifier = require('./parent-schema-verifier');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SAMPLE_SIZE = 25;

const PHASE_SPECS = {
  parent_activation_phase2: {
    tables: ['users', 'parent_auth_tokens', 'parent_sessions'],
    columns: [
      ['parent_auth_tokens', 'id'], ['parent_sessions', 'id'],
      ['users', 'activated_at'], ['users', 'invitation_sent_at'], ['users', 'last_login_at'],
      ['users', 'password_changed_at'], ['users', 'auth_revoked_at'],
      ['parent_auth_tokens', 'user_id'], ['parent_auth_tokens', 'token_hash'],
      ['parent_auth_tokens', 'token_type'], ['parent_auth_tokens', 'expires_at'],
      ['parent_auth_tokens', 'used_at'], ['parent_auth_tokens', 'revoked_at'],
      ['parent_auth_tokens', 'created_at'], ['parent_auth_tokens', 'created_by'],
      ['parent_sessions', 'user_id'], ['parent_sessions', 'refresh_token_hash'],
      ['parent_sessions', 'family_id'], ['parent_sessions', 'family_expires_at'],
      ['parent_sessions', 'expires_at'], ['parent_sessions', 'last_used_at'],
      ['parent_sessions', 'revoked_at'], ['parent_sessions', 'replaced_by_hash'],
      ['parent_sessions', 'created_at'], ['parent_sessions', 'user_agent'],
      ['parent_sessions', 'ip_address'],
    ],
    indexes: [
      ['parent_auth_tokens', 'idx_parent_auth_tokens_user'],
      ['parent_auth_tokens', 'idx_parent_auth_tokens_expiry'],
      ['parent_sessions', 'idx_parent_sessions_user'],
      ['parent_sessions', 'idx_parent_sessions_family'],
      ['parent_sessions', 'idx_parent_sessions_expiry'],
    ],
    constraints: [
      ['parent_auth_tokens', 'id', 'PRIMARY KEY'],
      ['parent_sessions', 'id', 'PRIMARY KEY'],
      ['parent_auth_tokens', 'token_hash', 'UNIQUE'],
      ['parent_auth_tokens', 'token_type', 'CHECK'],
      ['parent_sessions', 'refresh_token_hash', 'UNIQUE'],
    ],
    fks: [
      ['parent_auth_tokens', 'user_id', 'users'],
      ['parent_auth_tokens', 'created_by', 'users'],
      ['parent_sessions', 'user_id', 'users'],
    ],
  },
  parent_notifications_phase3: {
    tables: [
      'parent_notifications', 'parent_notification_reads', 'parent_push_subscriptions',
    ],
    columns: [
      ['parent_notifications', 'id'], ['parent_notification_reads', 'notification_id'],
      ['parent_notifications', 'event_type'], ['parent_notifications', 'parent_id'],
      ['parent_notifications', 'learner_id'], ['parent_notifications', 'title'],
      ['parent_notifications', 'summary'], ['parent_notifications', 'deep_link'],
      ['parent_notifications', 'dedupe_key'], ['parent_notifications', 'important'],
      ['parent_notifications', 'created_at'],
      ['parent_notification_reads', 'parent_id'],
      ['parent_notification_reads', 'read_at'], ['parent_notification_reads', 'dismissed_at'],
      ['parent_push_subscriptions', 'id'],
      ['parent_push_subscriptions', 'parent_id'], ['parent_push_subscriptions', 'endpoint'],
      ['parent_push_subscriptions', 'subscription'], ['parent_push_subscriptions', 'is_active'],
      ['parent_push_subscriptions', 'created_at'], ['parent_push_subscriptions', 'updated_at'],
    ],
    indexes: [
      ['parent_notifications', 'idx_parent_notifications_parent_created'],
      ['parent_notifications', 'idx_parent_notifications_learner'],
      ['parent_notification_reads', 'idx_parent_notification_reads_parent'],
      ['parent_push_subscriptions', 'uq_parent_push_subscriptions_endpoint'],
      ['parent_push_subscriptions', 'idx_parent_push_subscriptions_parent_active'],
    ],
    constraints: [
      ['parent_notifications', 'id', 'PRIMARY KEY'],
      ['parent_notification_reads', 'notification_id', 'PRIMARY KEY'],
      ['parent_push_subscriptions', 'id', 'PRIMARY KEY'],
      ['parent_notifications', 'dedupe_key', 'UNIQUE'],
      ['parent_notifications', 'deep_link', 'CHECK'],
    ],
    fks: [
      ['parent_notifications', 'parent_id', 'users'],
      ['parent_notifications', 'learner_id', 'users'],
      ['parent_notification_reads', 'notification_id', 'parent_notifications'],
      ['parent_notification_reads', 'parent_id', 'users'],
      ['parent_push_subscriptions', 'parent_id', 'users'],
    ],
  },
  parent_targeting_phase4: {
    tables: ['announcements', 'documents'],
    columns: [
      ['announcements', 'target_parent_ids'], ['announcements', 'target_audience'],
      ['documents', 'target_parent_ids'], ['documents', 'important'],
      ['documents', 'notify_email'], ['documents', 'target_audience'],
    ],
    indexes: [
      ['announcements', 'idx_announcements_target_parent_ids'],
      ['documents', 'idx_documents_target_parent_ids'],
    ],
    constraints: [
      ['announcements', 'announcements_target_audience_check', 'NAME'],
      ['documents', 'check_target_audience', 'NAME'],
    ],
    fks: [],
  },
  manual_finance_reconciliation: {
    tables: ['invoices', 'payment_transactions'],
    columns: [
      ['payment_transactions', 'reverses_transaction_id'],
      ['invoices', 'carried_forward_to_invoice_id'],
    ],
    indexes: [
      ['invoices', 'invoices_carried_forward_to_invoice_id_idx'],
      ['payment_transactions', 'payment_transactions_one_reversal_idx'],
      ['payment_transactions', 'payment_transactions_invoice_id_idx'],
    ],
    constraints: [],
    fks: [
      ['payment_transactions', 'reverses_transaction_id', 'payment_transactions'],
      ['invoices', 'carried_forward_to_invoice_id', 'invoices'],
    ],
  },
};

const BASE_COLUMNS = {
  users: ['id', 'student_number', 'role', 'is_active', 'email'],
  parent_students: ['parent_id', 'student_id'],
  invoices: [
    'id', 'student_id', 'student_number', 'amount_due', 'amount_paid', 'due_date', 'status',
  ],
  payment_transactions: ['id', 'invoice_id', 'student_id', 'student_number', 'amount'],
  service_prices: ['service_key', 'label', 'amount'],
};

const FINANCE_CARRY_COLUMNS = [...BASE_COLUMNS.invoices, 'description'];
const PARENT_LEDGER_COLUMNS = [
  ['users', 'is_boarder'], ['users', 'uses_transport'], ['users', 'uses_aftercare'],
  ['users', 'has_sibling_discount'], ['users', 'has_teacher_discount'],
  ['service_prices', 'service_key'], ['service_prices', 'label'], ['service_prices', 'amount'],
];
const NO_DEFAULT = Symbol('no default');

// These are deliberately separate from PHASE_SPECS: readiness is checked
// against the migration contract, not against the shape of this script.
const COLUMN_SPECS = [
  ['users', 'activated_at', ['timestamp with time zone'], true, null],
  ['users', 'invitation_sent_at', ['timestamp with time zone'], true, null],
  ['users', 'last_login_at', ['timestamp with time zone'], true, null],
  ['users', 'password_changed_at', ['timestamp with time zone'], true, null],
  ['users', 'auth_revoked_at', ['timestamp with time zone'], true, null],
  ['parent_auth_tokens', 'id', ['bigint'], false, 'any'],
  ['parent_auth_tokens', 'user_id', ['integer'], false, null],
    ['parent_auth_tokens', 'token_hash', ['character'], false, null, 64],
    ['parent_auth_tokens', 'token_type', ['character varying'], false, null, 16],
  ['parent_auth_tokens', 'expires_at', ['timestamp with time zone'], false, null],
  ['parent_auth_tokens', 'used_at', ['timestamp with time zone'], true, null],
  ['parent_auth_tokens', 'revoked_at', ['timestamp with time zone'], true, null],
  ['parent_auth_tokens', 'created_at', ['timestamp with time zone'], false, 'now()'],
  ['parent_auth_tokens', 'created_by', ['integer'], true, null],
  ['parent_sessions', 'id', ['bigint'], false, 'any'],
  ['parent_sessions', 'user_id', ['integer'], false, null],
    ['parent_sessions', 'refresh_token_hash', ['character'], false, null, 64],
  ['parent_sessions', 'family_id', ['uuid'], false, null],
  ['parent_sessions', 'family_expires_at', ['timestamp with time zone'], false, null],
  ['parent_sessions', 'expires_at', ['timestamp with time zone'], false, null],
  ['parent_sessions', 'last_used_at', ['timestamp with time zone'], true, null],
  ['parent_sessions', 'revoked_at', ['timestamp with time zone'], true, null],
  ['parent_sessions', 'replaced_by_hash', ['character'], true, null],
  ['parent_sessions', 'created_at', ['timestamp with time zone'], false, 'now()'],
  ['parent_sessions', 'user_agent', ['text'], true, null],
    ['parent_sessions', 'ip_address', ['character varying'], true, null, 45],
  ['parent_notifications', 'id', ['bigint'], false, 'any'],
    ['parent_notifications', 'event_type', ['character varying'], false, null, 64],
  ['parent_notifications', 'parent_id', ['integer'], false, null],
  ['parent_notifications', 'learner_id', ['integer'], true, null],
    ['parent_notifications', 'title', ['character varying'], false, null, 180],
    ['parent_notifications', 'summary', ['character varying'], false, null, 500],
    ['parent_notifications', 'deep_link', ['character varying'], false, null, 80],
    ['parent_notifications', 'dedupe_key', ['character varying'], false, null, 240],
  ['parent_notifications', 'important', ['boolean'], false, 'false'],
  ['parent_notifications', 'created_at', ['timestamp with time zone'], false, 'now()'],
  ['parent_notification_reads', 'notification_id', ['bigint'], false, null],
  ['parent_notification_reads', 'parent_id', ['integer'], false, null],
  ['parent_notification_reads', 'read_at', ['timestamp with time zone'], false, 'now()'],
  ['parent_notification_reads', 'dismissed_at', ['timestamp with time zone'], true, null],
  // Legacy server.js created this as SERIAL (integer) and TIMESTAMP WITHOUT
  // TIME ZONE.  Those are semantically compatible with the application
  // contract and are intentionally accepted: rewriting existing push rows or
  // their timestamp meaning during a repair is riskier than normalizing the
  // nullability/default metadata below.
  ['parent_push_subscriptions', 'id', ['bigint', 'integer'], false, 'any'],
  ['parent_push_subscriptions', 'parent_id', ['integer'], false, null],
  ['parent_push_subscriptions', 'endpoint', ['text'], false, null],
  ['parent_push_subscriptions', 'subscription', ['jsonb'], false, null],
  ['parent_push_subscriptions', 'is_active', ['boolean'], false, 'true'],
  ['parent_push_subscriptions', 'created_at', ['timestamp with time zone', 'timestamp without time zone'], false, 'now()'],
  ['parent_push_subscriptions', 'updated_at', ['timestamp with time zone', 'timestamp without time zone'], false, 'now()'],
  ['announcements', 'target_parent_ids', ['jsonb'], false, '[]'],
  ['documents', 'target_parent_ids', ['jsonb'], false, '[]'],
  ['documents', 'important', ['boolean'], false, 'false'],
  ['documents', 'notify_email', ['boolean'], false, 'false'],
  ['payment_transactions', 'reverses_transaction_id', ['integer'], true, null],
  ['invoices', 'carried_forward_to_invoice_id', ['integer'], true, null],
].map(([table, column, type, nullable, defaultValue, length]) => [
  table, column, type, nullable, defaultValue === null ? NO_DEFAULT : defaultValue, length,
]);

const INDEX_SPECS = {
  parent_activation_phase2: [
    ['parent_auth_tokens', 'idx_parent_auth_tokens_user', false, ['user_id'], null, undefined, ['ASC']],
    ['parent_auth_tokens', 'idx_parent_auth_tokens_expiry', false, ['expires_at'], null, undefined, ['ASC']],
    ['parent_sessions', 'idx_parent_sessions_user', false, ['user_id'], null, undefined, ['ASC']],
    ['parent_sessions', 'idx_parent_sessions_family', false, ['family_id'], null, undefined, ['ASC']],
    ['parent_sessions', 'idx_parent_sessions_expiry', false, ['expires_at'], null, undefined, ['ASC']],
  ],
  parent_notifications_phase3: [
    ['parent_notifications', 'idx_parent_notifications_parent_created', false, ['parent_id', 'created_at'], null, undefined, ['ASC', 'DESC']],
    ['parent_notifications', 'idx_parent_notifications_learner', false, ['learner_id', 'created_at'], null, undefined, ['ASC', 'DESC']],
    ['parent_notification_reads', 'idx_parent_notification_reads_parent', false, ['parent_id', 'read_at'], null, undefined, ['ASC', 'ASC']],
    ['parent_push_subscriptions', 'uq_parent_push_subscriptions_endpoint', true, ['endpoint'], null, undefined, ['ASC']],
    ['parent_push_subscriptions', 'idx_parent_push_subscriptions_parent_active', false, ['parent_id', 'is_active'], null, undefined, ['ASC', 'ASC']],
  ],
  parent_targeting_phase4: [
    ['announcements', 'idx_announcements_target_parent_ids', false, ['target_parent_ids'], null, 'gin', ['ASC']],
    ['documents', 'idx_documents_target_parent_ids', false, ['target_parent_ids'], null, 'gin', ['ASC']],
  ],
  manual_finance_reconciliation: [
    ['invoices', 'invoices_carried_forward_to_invoice_id_idx', false, ['carried_forward_to_invoice_id'], 'carried_forward_to_invoice_id IS NOT NULL', undefined, ['ASC']],
    ['payment_transactions', 'payment_transactions_one_reversal_idx', true, ['reverses_transaction_id'], 'reverses_transaction_id IS NOT NULL', undefined, ['ASC']],
    ['payment_transactions', 'payment_transactions_invoice_id_idx', false, ['invoice_id'], 'invoice_id IS NOT NULL', undefined, ['ASC']],
  ],
};

const CONSTRAINT_SPECS = {
  parent_activation_phase2: [
    ['parent_auth_tokens', 'p', ['id']], ['parent_sessions', 'p', ['id']],
    ['parent_auth_tokens', 'u', ['token_hash']], ['parent_sessions', 'u', ['refresh_token_hash']],
    ['parent_auth_tokens', 'c', ['token_type'], ['activation', 'reset']],
  ],
  parent_notifications_phase3: [
    ['parent_notifications', 'p', ['id']], ['parent_notification_reads', 'p', ['notification_id', 'parent_id']],
    ['parent_push_subscriptions', 'p', ['id']], ['parent_notifications', 'u', ['parent_id', 'dedupe_key']],
    ['parent_notifications', 'c', ['deep_link'], ['/parent', '/parent/dashboard', '/parent/attendance', '/parent/grades', '/parent/invoices', '/parent/payment-proof', '/parent/documents', '/parent/announcements', '/parent/notifications']],
  ],
  parent_targeting_phase4: [
    ['announcements', 'c', [], ['everyone', 'staff', 'students', 'parents', 'all_parents', 'grade', 'class', 'specific_parents'], 'announcements_target_audience_check'],
    ['documents', 'c', [], ['everyone', 'student', 'staff', 'parents', 'all_parents', 'grade', 'class', 'specific_parents'], 'check_target_audience'],
  ],
  manual_finance_reconciliation: [],
};

const FK_SPECS = {
  parent_activation_phase2: [
    ['parent_auth_tokens', ['user_id'], 'users', ['id'], 'CASCADE'],
    ['parent_auth_tokens', ['created_by'], 'users', ['id'], 'SET NULL'],
    ['parent_sessions', ['user_id'], 'users', ['id'], 'CASCADE'],
  ],
  parent_notifications_phase3: [
    ['parent_notifications', ['parent_id'], 'users', ['id'], 'CASCADE'],
    ['parent_notifications', ['learner_id'], 'users', ['id'], 'CASCADE'],
    ['parent_notification_reads', ['notification_id'], 'parent_notifications', ['id'], 'CASCADE'],
    ['parent_notification_reads', ['parent_id'], 'users', ['id'], 'CASCADE'],
    ['parent_push_subscriptions', ['parent_id'], 'users', ['id'], 'CASCADE'],
  ],
  parent_targeting_phase4: [],
  manual_finance_reconciliation: [
    ['payment_transactions', ['reverses_transaction_id'], 'payment_transactions', ['id'], 'RESTRICT'],
    ['invoices', ['carried_forward_to_invoice_id'], 'invoices', ['id'], 'SET NULL'],
  ],
};

const READ_QUERIES = Object.freeze({
  tables: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
  columns: `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
  constraints: `SELECT c.conname, c.contype, cls.relname AS table_name, pg_get_constraintdef(c.oid) AS definition, COALESCE((SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum), ARRAY[]::text[]) AS columns, COALESCE((SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum), ARRAY[]::text[]) AS referenced_columns, ref.relname AS referenced_table, CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete FROM pg_constraint c JOIN pg_class cls ON cls.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = cls.relnamespace LEFT JOIN pg_class ref ON ref.oid = c.confrelid WHERE ns.nspname = 'public'`,
  indexes: `SELECT tbl.relname AS table_name, idx.relname AS indexname, ix.indisunique AS is_unique, ix.indisprimary AS is_primary, am.amname AS method, pg_get_indexdef(ix.indexrelid) AS indexdef, pg_get_expr(ix.indpred, ix.indrelid) AS predicate, ARRAY(SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns, ARRAY(SELECT CASE WHEN (ix.indoption[k.ord - 1] & 1) = 1 THEN 'DESC' ELSE 'ASC' END FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord) ORDER BY k.ord) AS directions FROM pg_index ix JOIN pg_class idx ON idx.oid = ix.indexrelid JOIN pg_class tbl ON tbl.oid = ix.indrelid JOIN pg_am am ON am.oid = idx.relam JOIN pg_namespace ns ON ns.oid = tbl.relnamespace WHERE ns.nspname = 'public'`,
  parentSample: `WITH linked AS (SELECT s.id, s.student_number, MAX(CASE WHEN i.status = 'Carried Forward' THEN 1 ELSE 0 END) AS has_carry_forward, MAX(CASE WHEN pt.invoice_id IS NULL AND pt.id IS NOT NULL THEN 1 ELSE 0 END) AS has_unallocated, MAX(CASE WHEN pt.reverses_transaction_id IS NOT NULL THEN 1 ELSE 0 END) AS has_reversal, MAX(CASE WHEN i.amount_paid > i.amount_due THEN 1 ELSE 0 END) AS has_overpayment FROM users p JOIN parent_students ps ON ps.parent_id = p.id JOIN users s ON s.id = ps.student_id AND s.role = 'student' LEFT JOIN invoices i ON i.student_id = s.id LEFT JOIN payment_transactions pt ON pt.student_id = s.id WHERE p.role = 'parent' GROUP BY s.id, s.student_number) SELECT id, student_number FROM linked ORDER BY has_carry_forward DESC, has_unallocated DESC, has_reversal DESC, has_overpayment DESC, id LIMIT $1`,
  parentSampleLegacy: `WITH linked AS (SELECT s.id, s.student_number, MAX(CASE WHEN i.status = 'Carried Forward' THEN 1 ELSE 0 END) AS has_carry_forward, MAX(CASE WHEN pt.invoice_id IS NULL AND pt.id IS NOT NULL THEN 1 ELSE 0 END) AS has_unallocated, 0 AS has_reversal, MAX(CASE WHEN i.amount_paid > i.amount_due THEN 1 ELSE 0 END) AS has_overpayment FROM users p JOIN parent_students ps ON ps.parent_id = p.id JOIN users s ON s.id = ps.student_id AND s.role = 'student' LEFT JOIN invoices i ON i.student_id = s.id LEFT JOIN payment_transactions pt ON pt.student_id = s.id WHERE p.role = 'parent' GROUP BY s.id, s.student_number) SELECT id, student_number FROM linked ORDER BY has_carry_forward DESC, has_unallocated DESC, has_reversal DESC, has_overpayment DESC, id LIMIT $1`,
  adminTotals: `SELECT COALESCE(SUM(i.amount_due), 0) AS billed, COALESCE(SUM(i.amount_paid), 0) AS paid, COALESCE(SUM(GREATEST(i.amount_due - i.amount_paid, 0)), 0) AS outstanding, COALESCE(SUM(GREATEST(i.amount_paid - i.amount_due, 0)), 0) + COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.student_number = $1 AND pt.invoice_id IS NULL), 0) AS credit FROM invoices i WHERE i.student_number = $1 AND i.status <> 'Carried Forward'`,
  parentTotals: `SELECT COALESCE(SUM(CASE WHEN i.status <> 'Carried Forward' THEN i.amount_due ELSE 0 END), 0) AS billed, COALESCE(SUM(CASE WHEN i.status <> 'Carried Forward' THEN i.amount_paid ELSE 0 END), 0) AS paid, COALESCE(SUM(CASE WHEN i.status <> 'Carried Forward' THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END), 0) AS outstanding, COALESCE(SUM(CASE WHEN i.status <> 'Carried Forward' THEN GREATEST(i.amount_paid - i.amount_due, 0) ELSE 0 END), 0) + COALESCE((SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.student_id = $1 AND pt.invoice_id IS NULL), 0) AS credit FROM invoices i WHERE i.student_id = $1`,
  financeCarryWithLineage: `WITH candidates AS (SELECT source.id AS source_id, successor.id AS successor_id, source.student_number, EXTRACT(YEAR FROM source.due_date)::integer AS source_year, source.amount_due AS source_amount_due, source.amount_paid AS source_amount_paid, successor.amount_due AS successor_amount_due, successor.amount_paid AS successor_amount_paid, source.carried_forward_to_invoice_id AS persisted_successor_id, COUNT(successor.id) OVER (PARTITION BY source.id) AS candidate_count FROM invoices source LEFT JOIN invoices successor ON successor.student_id = source.student_id AND successor.id <> source.id AND successor.status <> 'Carried Forward' AND successor.description = 'Arrears from ' || EXTRACT(YEAR FROM source.due_date)::text AND successor.due_date >= source.due_date AND EXTRACT(YEAR FROM successor.due_date) >= EXTRACT(YEAR FROM source.due_date) WHERE source.status = 'Carried Forward' AND source.carried_forward_to_invoice_id IS NULL) SELECT * FROM candidates WHERE candidate_count <> 1 ORDER BY student_number, source_id, successor_id`,
  financeCarryWithoutLineage: `WITH candidates AS (SELECT source.id AS source_id, successor.id AS successor_id, source.student_number, EXTRACT(YEAR FROM source.due_date)::integer AS source_year, source.amount_due AS source_amount_due, source.amount_paid AS source_amount_paid, successor.amount_due AS successor_amount_due, successor.amount_paid AS successor_amount_paid, NULL::integer AS persisted_successor_id, COUNT(successor.id) OVER (PARTITION BY source.id) AS candidate_count FROM invoices source LEFT JOIN invoices successor ON successor.student_id = source.student_id AND successor.id <> source.id AND successor.status <> 'Carried Forward' AND successor.description = 'Arrears from ' || EXTRACT(YEAR FROM source.due_date)::text AND successor.due_date >= source.due_date AND EXTRACT(YEAR FROM successor.due_date) >= EXTRACT(YEAR FROM source.due_date) WHERE source.status = 'Carried Forward') SELECT * FROM candidates WHERE candidate_count <> 1 ORDER BY student_number, source_id, successor_id`,
  reversalReview: `SELECT pt.student_number, pt.id AS transaction_id, pt.invoice_id, pt.reverses_transaction_id, COUNT(reversal.id)::integer AS reversal_count, CASE WHEN original.id IS NULL AND pt.reverses_transaction_id IS NOT NULL THEN true ELSE false END AS missing_original FROM payment_transactions pt LEFT JOIN payment_transactions reversal ON reversal.reverses_transaction_id = pt.id LEFT JOIN payment_transactions original ON original.id = pt.reverses_transaction_id GROUP BY pt.student_number, pt.id, pt.invoice_id, pt.reverses_transaction_id, original.id HAVING COUNT(reversal.id) > 1 OR (original.id IS NULL AND pt.reverses_transaction_id IS NOT NULL) ORDER BY pt.student_number, pt.id`,
  parentRollout: `SELECT p.id, p.is_active, (p.email IS NOT NULL AND btrim(p.email) <> '') AS has_email, p.activated_at, p.invitation_sent_at, p.auth_revoked_at, COUNT(s.id)::integer AS linked_count, ARRAY_REMOVE(ARRAY_AGG(s.student_number ORDER BY s.student_number), NULL) AS linked_learner_student_numbers FROM users p LEFT JOIN parent_students ps ON ps.parent_id = p.id LEFT JOIN users s ON s.id = ps.student_id AND s.role = 'student' WHERE p.role = 'parent' GROUP BY p.id, p.is_active, p.email, p.activated_at, p.invitation_sent_at, p.auth_revoked_at ORDER BY p.id`,
});

function asSet(rows, key) {
  return new Set((rows || []).map((row) => String(row[key] ?? '')));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Math.round(number(value) * 100) / 100;
}

async function readQuery(client, queryId, params = []) {
  if (!Object.prototype.hasOwnProperty.call(READ_QUERIES, queryId)) {
    throw new Error('Unknown preflight query id');
  }
  return client.query(READ_QUERIES[queryId], params);
}

async function readMetadata(client) {
  const names = Object.keys(BASE_COLUMNS).concat(Object.values(PHASE_SPECS).flatMap((spec) => spec.tables));
  const tableResult = await readQuery(client, 'tables', [names]);
  const columnResult = await readQuery(client, 'columns', [names]);
  const constraintResult = await readQuery(client, 'constraints');
  const indexResult = await readQuery(client, 'indexes');
  return {
    tables: asSet(tableResult.rows, 'table_name'),
    columns: new Set((columnResult.rows || []).map((row) => `${row.table_name}.${row.column_name}`)),
    columnDetails: new Map((columnResult.rows || []).map((row) => [`${row.table_name}.${row.column_name}`, row])),
    constraints: constraintResult.rows || [],
    indexes: indexResult.rows || [],
  };
}

function normalizeDefault(value) {
  if (value == null) return null;
  let normalized = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  while (normalized.startsWith('(') && normalized.endsWith(')')) normalized = normalized.slice(1, -1).trim();
  normalized = normalized.replace(/::[a-z_ ]+(\[\])?$/i, '').trim();
  while (normalized.startsWith('(') && normalized.endsWith(')')) normalized = normalized.slice(1, -1).trim();
  if ((normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('"') && normalized.endsWith('"'))) {
    normalized = normalized.slice(1, -1).replace(/''/g, "'");
  }
  if (normalized === 'current_timestamp') return 'now()';
  return normalized;
}

function defaultMatches(actual, expected) {
  if (expected === NO_DEFAULT) return actual == null;
  if (expected === 'any') return actual != null;
  return normalizeDefault(actual) === normalizeDefault(expected);
}

function boolValue(value) {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

function quotedLiterals(definition) {
  return [...String(definition || '').matchAll(/'((?:''|[^'])*)'/g)]
    .map((match) => match[1].replace(/''/g, "'"));
}

function exactSet(actual, expected) {
  const a = [...new Set(actual)].sort();
  const e = [...new Set(expected)].sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

function columnMatches(row, expectedType, nullable, defaultValue, expectedLength) {
  if (!row || !expectedType.some((type) => String(row.data_type || '').toLowerCase() === type ||
      String(row.udt_name || '').toLowerCase() === type.replace(/ /g, '_'))) return false;
  return String(row.is_nullable || '').toUpperCase() === (nullable ? 'YES' : 'NO') &&
    defaultMatches(row.column_default, defaultValue) &&
    (expectedLength == null || Number(row.character_maximum_length) === expectedLength);
}

function missingForSpec(spec, metadata) {
  const missing = [];
  const columnDetails = metadata.columnDetails || new Map();
  for (const table of spec.tables) {
    if (!metadata.tables.has(table)) missing.push(`table ${table}`);
  }
  for (const [table, column] of spec.columns) {
    if (!metadata.columns.has(`${table}.${column}`)) missing.push(`column ${table}.${column}`);
  }
  for (const [table, column, expectedType, nullable, defaultValue, expectedLength] of COLUMN_SPECS) {
    if (spec.tables.includes(table) && !columnMatches(
      columnDetails.get(`${table}.${column}`), expectedType, nullable, defaultValue, expectedLength,
    )) missing.push(`column definition ${table}.${column}`);
  }
  for (const [table, index, unique, columns, predicate, method, directions] of INDEX_SPECS[Object.entries(PHASE_SPECS).find(([, value]) => value === spec)?.[0]] || []) {
    const found = metadata.indexes.some((row) => row.table_name === table && row.indexname === index &&
      boolValue(row.is_unique) === unique &&
      JSON.stringify(row.columns || []) === JSON.stringify(columns) &&
      // GIN has no meaningful B-tree ASC/DESC ordering.  PostgreSQL still
      // exposes indoption bits for every index, so do not reject a valid GIN
      // index merely because those bits differ.
      (method === 'gin' || JSON.stringify(row.directions || []) === JSON.stringify(directions)) &&
      (predicate == null ? !row.predicate : String(row.predicate || '').toLowerCase().includes(predicate.toLowerCase())) &&
       (!method || String(row.method || '').toLowerCase() === method ||
         String(row.indexdef || '').toLowerCase().includes(` using ${method}`)));
    if (!found) {
      missing.push(`index ${table}.${index}`);
    }
  }
  const phase = Object.entries(PHASE_SPECS).find(([, value]) => value === spec)?.[0];
  for (const [table, kind, columns, checkValues, name] of CONSTRAINT_SPECS[phase] || []) {
    const found = metadata.constraints.some((row) => row.table_name === table &&
      row.contype === kind &&
      (!columns.length || JSON.stringify(row.columns || []) === JSON.stringify(columns)) &&
      (!name || row.conname === name) &&
      (!checkValues || exactSet(quotedLiterals(row.definition), checkValues)));
    if (!found) missing.push(`constraint ${table}.${name || `${kind}(${columns.join(',')})`}`);
  }
  for (const [table, columns, referencedTable, referencedColumns, onDelete] of FK_SPECS[phase] || []) {
    const found = metadata.constraints.some((row) => row.table_name === table && row.contype === 'f' &&
      JSON.stringify(row.columns || []) === JSON.stringify(columns) &&
      row.referenced_table === referencedTable &&
      JSON.stringify(row.referenced_columns || []) === JSON.stringify(referencedColumns) &&
      String(row.on_delete || '').toUpperCase() === onDelete);
    if (!found) missing.push(`foreign key ${table}.${columns.join(',')}->${referencedTable}`);
  }
  return missing;
}

async function checkSchemaReadinessInternal(client) {
  const metadata = await readMetadata(client);
  const readiness = {};
  for (const [phase, spec] of Object.entries(PHASE_SPECS)) {
    const missing = missingForSpec(spec, metadata);
    readiness[phase] = { status: missing.length ? 'INCOMPLETE' : 'APPLIED', missing };
  }
  return { readiness, metadata };
}

// Keep the historical preflight export while making this the same verifier
// used by all manual migration runners.
async function checkSchemaReadiness(client) {
  return sharedSchemaVerifier.checkSchemaReadiness(client);
}

function baseReady(metadata, table, columns) {
  return metadata.tables.has(table) && columns.every((column) => metadata.columns.has(`${table}.${column}`));
}

function checkEnvironment(environment = process.env, source = null) {
  const frontend = String(environment.FRONTEND_URL || '').trim();
  let frontendValid = false;
  try {
    const parsed = new URL(frontend);
    frontendValid = ['http:', 'https:'].includes(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      !(environment.NODE_ENV === 'production' && parsed.protocol !== 'https:');
  } catch (_) {
    frontendValid = false;
  }
  const gmailVars = [
    'GOOGLE_GMAIL_CLIENT_ID', 'GOOGLE_GMAIL_CLIENT_SECRET',
    'GOOGLE_GMAIL_REFRESH_TOKEN', 'GMAIL_USER',
  ];
  const s3Vars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME', 'AWS_REGION'];
  const configured = (names) => ({
    required: names,
    configured: names.every((name) => String(environment[name] || '').trim().length > 0),
    missing: names.filter((name) => !String(environment[name] || '').trim()),
  });
  const contractSource = source || fs.readFileSync(path.join(__dirname, '..', 'services', 'parentAuth.js'), 'utf8');
  const rememberedSession = {
    secureInProduction: /NODE_ENV\s*===\s*['"]production['"]/.test(contractSource),
    httpOnly: /httpOnly:\s*true/.test(contractSource),
    sameSiteLax: /sameSite:\s*['"]lax['"]/.test(contractSource),
    scopedPath: /path:\s*['"]\/api\/auth['"]/.test(contractSource),
    rememberedMaxAge: /remember\s*\?\s*refresh\.expiresIn/.test(contractSource),
    normalSessionCookie: /normal login deliberately gets a browser-session cookie/.test(contractSource),
  };
  return {
    frontendUrl: { required: true, present: Boolean(frontend), valid: frontendValid },
    gmailOAuth: configured(gmailVars),
    awsS3: configured(s3Vars),
    rememberedSession: {
      ...rememberedSession,
      valid: Object.values(rememberedSession).every(Boolean),
    },
  };
}

function categorizeParentAccount(account) {
  if (account.is_active === false || account.auth_revoked_at) return 'NEEDS_REVIEW';
  if (account.activated_at || account.activated) return 'ALREADY_ACTIVATED';
  if (number(account.linked_count) > 0 && account.has_email) return 'READY_FOR_EMAIL_INVITE';
  return 'READY_FOR_MANUAL_LINK';
}

function summarizeParentAccounts(accounts) {
  const summary = {
    total: accounts.length, withLinkedLearners: 0, withoutLinkedLearners: 0,
    withEmail: 0, withoutEmail: 0, oneChild: 0, multiChild: 0,
    active: 0, inactive: 0, notInvited: 0, inviteSent: 0, activated: 0, disabled: 0,
    categories: {
      READY_FOR_EMAIL_INVITE: 0, READY_FOR_MANUAL_LINK: 0,
      NEEDS_REVIEW: 0, ALREADY_ACTIVATED: 0,
    },
  };
  const safeAccounts = accounts.map((account) => {
    const linkedCount = number(account.linked_count);
    const hasEmail = Boolean(account.has_email);
    const active = account.is_active !== false;
    const activated = Boolean(account.activated_at || account.activated);
    const inviteSent = Boolean(account.invitation_sent_at || account.invite_sent);
    if (linkedCount) summary.withLinkedLearners += 1; else summary.withoutLinkedLearners += 1;
    if (hasEmail) summary.withEmail += 1; else summary.withoutEmail += 1;
    if (linkedCount === 1) summary.oneChild += 1;
    if (linkedCount > 1) summary.multiChild += 1;
    if (active) summary.active += 1; else summary.inactive += 1;
    if (activated) summary.activated += 1;
    else if (inviteSent) summary.inviteSent += 1;
    else summary.notInvited += 1;
    if (!active) summary.disabled += 1;
    const category = categorizeParentAccount({ ...account, has_email: hasEmail, linked_count: linkedCount });
    summary.categories[category] += 1;
    return {
      parent_reference: `PARENT-${String(account.id)}`,
      linked_learner_student_numbers: [...(account.linked_learner_student_numbers || [])].filter(Boolean).sort(),
      has_email: hasEmail, active, activated, invitation_sent: inviteSent, category,
    };
  });
  return { summary, accounts: safeAccounts };
}

async function auditParentRollout(client, readiness, metadata) {
  const required = [
    ['users', BASE_COLUMNS.users], ['parent_students', BASE_COLUMNS.parent_students],
  ];
  const missing = required.flatMap(([table, columns]) => [
    ...(!metadata.tables.has(table) ? [`table ${table}`] : []),
    ...columns.filter((column) => !metadata.columns.has(`${table}.${column}`))
      .map((column) => `column ${table}.${column}`),
  ]);
  if (missing.length || readiness.parent_activation_phase2.status !== 'APPLIED') {
    return { status: 'SKIPPED', reason: missing.concat(readiness.parent_activation_phase2.missing).join(', ') };
  }
  const result = await readQuery(client, 'parentRollout');
  return { status: 'APPLIED', ...summarizeParentAccounts(result.rows || []) };
}

function compareTotals(rows) {
  const fields = ['billed', 'paid', 'outstanding', 'credit'];
  return (rows || []).map((row) => {
    const mismatches = fields.filter((field) =>
      money(row[`admin_${field}`]) !== money(row[`parent_${field}`]));
    return {
      student_number: row.student_number,
      admin: Object.fromEntries(fields.map((field) => [field, money(row[`admin_${field}`])])),
      parent: Object.fromEntries(fields.map((field) => [field, money(row[`parent_${field}`])])),
      mismatches,
    };
  });
}

async function auditTotals(client, metadata, sampleSize = DEFAULT_SAMPLE_SIZE) {
  // Do not collapse these into one SQL expression. adminTotals mirrors the
  // Admin getFinanceSummary contract (student_number scope), while
  // parentTotals mirrors Parent getStudentLedger (student_id scope). Each is
  // independently executed on the caller-owned read-only client.
  const missing = [];
  if (!baseReady(metadata, 'users', ['id', 'student_number', 'role'])) missing.push('base users');
  if (!baseReady(metadata, 'invoices', BASE_COLUMNS.invoices)) missing.push('base invoices');
  if (!baseReady(metadata, 'payment_transactions', BASE_COLUMNS.payment_transactions)) missing.push('base payment_transactions');
  if (!baseReady(metadata, 'parent_students', BASE_COLUMNS.parent_students)) missing.push('base parent_students');
  for (const [table, column] of PARENT_LEDGER_COLUMNS) {
    if (!metadata.tables.has(table) || !metadata.columns.has(`${table}.${column}`)) {
      missing.push(`parent ledger ${table}.${column}`);
    }
  }
  if (missing.length) return { status: 'SKIPPED', reason: missing.join(', ') };
  const sample = await readQuery(client,
    metadata.columns.has('payment_transactions.reverses_transaction_id') ? 'parentSample' : 'parentSampleLegacy', [
    Math.max(1, Math.min(100, Number(sampleSize) || DEFAULT_SAMPLE_SIZE)),
  ]);
  const comparisons = [];
  for (const learner of sample.rows || []) {
    const [adminResult, parentResult] = await Promise.all([
      readQuery(client, 'adminTotals', [learner.student_number]),
      readQuery(client, 'parentTotals', [learner.id]),
    ]);
    const admin = adminResult.rows?.[0] || {};
    const parent = parentResult.rows?.[0] || {};
    comparisons.push(...compareTotals([{
      student_number: learner.student_number,
      admin_billed: admin.billed, admin_paid: admin.paid,
      admin_outstanding: admin.outstanding, admin_credit: admin.credit,
      parent_billed: parent.billed, parent_paid: parent.paid,
      parent_outstanding: parent.outstanding, parent_credit: parent.credit,
    }]));
  }
  return {
    status: 'APPLIED', sample_size: comparisons.length,
    mismatches: comparisons.filter((row) => row.mismatches.length),
    comparisons,
  };
}

async function auditFinance(client, readiness, metadata) {
  const invoiceReady = baseReady(metadata, 'invoices', FINANCE_CARRY_COLUMNS);
  const paymentReady = baseReady(metadata, 'payment_transactions', BASE_COLUMNS.payment_transactions);
  if (!invoiceReady) return { status: 'SKIPPED', reason: 'base invoices table/columns are incomplete' };
  const candidateQuery = await readQuery(client, metadata.columns.has('invoices.carried_forward_to_invoice_id')
    ? 'financeCarryWithLineage' : 'financeCarryWithoutLineage');
  const carryForward = (candidateQuery.rows || []).map((row) => ({
    student_number: row.student_number, source_invoice_id: row.source_invoice_id,
    successor_invoice_id: row.successor_id ?? null, year: Number(row.source_year),
    candidate_count: Number(row.candidate_count || 0),
    source_amount_due: money(row.source_amount_due), source_amount_paid: money(row.source_amount_paid),
    ...(row.successor_id == null ? {} : {
      successor_amount_due: money(row.successor_amount_due),
      successor_amount_paid: money(row.successor_amount_paid),
    }),
    persisted_successor_id: row.persisted_successor_id ?? null,
  }));
  let reversals = { status: 'SKIPPED', reason: 'payment_transactions base table is incomplete' };
  if (paymentReady && metadata.columns.has('payment_transactions.reverses_transaction_id')) {
    const result = await readQuery(client, 'reversalReview');
    reversals = {
      status: 'APPLIED',
      review: (result.rows || []).map((row) => ({
        student_number: row.student_number, transaction_id: row.transaction_id,
        invoice_id: row.invoice_id, reverses_transaction_id: row.reverses_transaction_id,
        reversal_count: Number(row.reversal_count || 0), missing_original: Boolean(row.missing_original),
      })),
    };
  }
  return {
    status: 'APPLIED', migration: readiness.manual_finance_reconciliation,
    carry_forward_review: carryForward, reversals,
  };
}

function formatAuditReport(report) {
  const lines = ['Parent rollout preflight (read-only)', ''];
  lines.push('Schema readiness:');
  for (const [phase, value] of Object.entries(report.schema || {})) {
    lines.push(`- ${phase}: ${value.status}${value.missing?.length ? ` — missing ${value.missing.join('; ')}` : ''}`);
  }
  lines.push('', 'Configuration:');
  const env = report.environment || {};
  lines.push(`- FRONTEND_URL: ${env.frontendUrl?.valid ? 'VALID' : 'MISSING/INVALID'}`);
  lines.push(`- Gmail OAuth (${env.gmailOAuth?.required?.join(', ')}): ${env.gmailOAuth?.configured ? 'CONFIGURED' : 'INCOMPLETE'}`);
  lines.push(`- AWS S3 (${env.awsS3?.required?.join(', ')}): ${env.awsS3?.configured ? 'CONFIGURED' : 'INCOMPLETE'}`);
  lines.push(`- Remembered-session cookie contract: ${env.rememberedSession?.valid ? 'VALID' : 'INCOMPLETE'}`);
  const finance = report.finance || {};
  lines.push('', `Finance carry-forward audit: ${finance.status || 'SKIPPED'}${finance.reason ? ` — ${finance.reason}` : ''}${finance.carry_forward_review ? ` (${finance.carry_forward_review.length} rows needing review)` : ''}`);
  for (const row of finance.carry_forward_review || []) {
    lines.push(`  student=${row.student_number}; source_invoice=${row.source_invoice_id}; successor_invoice=${row.successor_invoice_id ?? 'none'}; year=${row.year}; candidates=${row.candidate_count}; source_due=${row.source_amount_due}; source_paid=${row.source_amount_paid}${row.successor_invoice_id == null ? '' : `; successor_due=${row.successor_amount_due}; successor_paid=${row.successor_amount_paid}`}`);
  }
  lines.push(`Finance reversal audit: ${finance.reversals?.status || 'SKIPPED'}${finance.reversals?.reason ? ` — ${finance.reversals.reason}` : ''}`);
  for (const row of finance.reversals?.review || []) {
    lines.push(`  student=${row.student_number}; transaction=${row.transaction_id}; invoice=${row.invoice_id ?? 'none'}; reverses=${row.reverses_transaction_id ?? 'none'}; reversal_count=${row.reversal_count}; missing_original=${row.missing_original}`);
  }
  const totals = report.totals || {};
  lines.push('', `Admin vs Parent sample: ${totals.status || 'SKIPPED'}${totals.reason ? ` — ${totals.reason}` : ''}${totals.mismatches ? ` (${totals.mismatches.length} mismatches)` : ''}`);
  for (const row of totals.mismatches || []) {
    lines.push(`  student=${row.student_number}; mismatches=${row.mismatches.join(',')}; admin=${JSON.stringify(row.admin)}; parent=${JSON.stringify(row.parent)}`);
  }
  const parents = report.parents || {};
  lines.push(`Parent rollout accounts: ${parents.status || 'SKIPPED'}${parents.reason ? ` — ${parents.reason}` : ''}${parents.summary ? ` (${parents.summary.total} accounts)` : ''}`);
  if (parents.summary) {
    const s = parents.summary;
    lines.push(`  linked=${s.withLinkedLearners}; unlinked=${s.withoutLinkedLearners}; email=${s.withEmail}; no_email=${s.withoutEmail}; one_child=${s.oneChild}; multi_child=${s.multiChild}; active=${s.active}; inactive=${s.inactive}; not_invited=${s.notInvited}; invite_sent=${s.inviteSent}; activated=${s.activated}; disabled=${s.disabled}`);
    lines.push(`  categories: READY_FOR_EMAIL_INVITE=${s.categories.READY_FOR_EMAIL_INVITE}; READY_FOR_MANUAL_LINK=${s.categories.READY_FOR_MANUAL_LINK}; NEEDS_REVIEW=${s.categories.NEEDS_REVIEW}; ALREADY_ACTIVATED=${s.categories.ALREADY_ACTIVATED}`);
  }
  if (parents.accounts) {
    for (const account of parents.accounts) {
      lines.push(`  ${account.parent_reference}: ${account.category}; learners=${account.linked_learner_student_numbers.join(',') || 'none'}; email=${account.has_email}; active=${account.active}; activated=${account.activated}; invitation_sent=${account.invitation_sent}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function runAudit({
  database, environment = process.env, statementTimeoutMs = DEFAULT_TIMEOUT_MS,
  sampleSize = DEFAULT_SAMPLE_SIZE,
} = {}) {
  // Lazy require prevents importing the application's startup path in tests.
  const db = database || require('../config/database');
  const pool = db.pool || db;
  let client;
  let result;
  let primaryError;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    const timeout = Number(statementTimeoutMs);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000) {
      throw new Error('Invalid read-only statement timeout');
    }
    await client.query(`SET LOCAL statement_timeout = '${timeout}ms'`);
    const readOnly = await client.query(`SHOW transaction_read_only`);
    if (String(readOnly.rows?.[0]?.transaction_read_only || '').toLowerCase() !== 'on') {
      throw new Error('Read-only transaction could not be established');
    }
    const setting = await client.query(`SELECT current_setting('transaction_read_only', true) AS transaction_read_only`);
    if (String(setting.rows?.[0]?.transaction_read_only || '').toLowerCase() !== 'on') {
      throw new Error('Read-only transaction could not be established');
    }
    const { readiness, metadata } = await checkSchemaReadiness(client);
    const [finance, totals, parents] = await Promise.all([
      auditFinance(client, readiness, metadata),
      auditTotals(client, metadata, sampleSize),
      auditParentRollout(client, readiness, metadata),
    ]);
    result = {
      schema: readiness,
      finance,
      totals,
      parents,
      environment: checkEnvironment(environment),
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (client) {
      let rollbackError;
      try { await client.query('ROLLBACK'); } catch (error) { rollbackError = error; }
      try { client.release(); } finally {
        if (primaryError) throw primaryError;
        if (rollbackError) throw rollbackError;
      }
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

if (require.main === module) {
  runAudit()
    .then((report) => process.stdout.write(formatAuditReport(report)))
    .catch((error) => {
      process.stderr.write(`Parent rollout preflight failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  PHASE_SPECS, READ_QUERIES, readQuery, checkSchemaReadiness, checkEnvironment, categorizeParentAccount,
  summarizeParentAccounts, compareTotals, auditFinance, auditTotals, auditParentRollout,
  formatAuditReport, runAudit, normalizeDefault, quotedLiterals, exactSet,
  _checkSchemaReadinessInternal: checkSchemaReadinessInternal,
};