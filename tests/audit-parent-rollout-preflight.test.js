const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  checkSchemaReadiness,
  readQuery,
  categorizeParentAccount,
  compareTotals,
  checkEnvironment,
  formatAuditReport,
  runAudit,
} = require('../scripts/audit-parent-rollout-preflight');

function completeMetadataRows() {
  const tables = ['users', 'parent_students', 'parent_auth_tokens', 'parent_sessions',
    'parent_notifications', 'parent_notification_reads', 'parent_push_subscriptions',
    'announcements', 'documents', 'invoices', 'payment_transactions', 'service_prices'];
  const columnDefinitions = [
    ['users', 'activated_at', 'timestamp with time zone', 'YES', null],
    ['users', 'invitation_sent_at', 'timestamp with time zone', 'YES', null],
    ['users', 'last_login_at', 'timestamp with time zone', 'YES', null],
    ['users', 'password_changed_at', 'timestamp with time zone', 'YES', null],
    ['users', 'auth_revoked_at', 'timestamp with time zone', 'YES', null],
    ['parent_auth_tokens', 'id', 'bigint', 'NO', 'nextval(...)'],
    ['parent_auth_tokens', 'user_id', 'integer', 'NO', null], ['parent_auth_tokens', 'token_hash', 'character', 'NO', null, 64],
    ['parent_auth_tokens', 'token_type', 'character varying', 'NO', null, 16], ['parent_auth_tokens', 'expires_at', 'timestamp with time zone', 'NO', null],
    ['parent_auth_tokens', 'used_at', 'timestamp with time zone', 'YES', null], ['parent_auth_tokens', 'revoked_at', 'timestamp with time zone', 'YES', null],
    ['parent_auth_tokens', 'created_at', 'timestamp with time zone', 'NO', 'now()'], ['parent_auth_tokens', 'created_by', 'integer', 'YES', null],
    ['parent_sessions', 'id', 'bigint', 'NO', 'nextval(...)'], ['parent_sessions', 'user_id', 'integer', 'NO', null],
    ['parent_sessions', 'refresh_token_hash', 'character', 'NO', null, 64], ['parent_sessions', 'family_id', 'uuid', 'NO', null],
    ['parent_sessions', 'family_expires_at', 'timestamp with time zone', 'NO', null], ['parent_sessions', 'expires_at', 'timestamp with time zone', 'NO', null],
    ['parent_sessions', 'last_used_at', 'timestamp with time zone', 'YES', null], ['parent_sessions', 'revoked_at', 'timestamp with time zone', 'YES', null],
    ['parent_sessions', 'replaced_by_hash', 'character', 'YES', null], ['parent_sessions', 'created_at', 'timestamp with time zone', 'NO', 'now()'],
    ['parent_sessions', 'user_agent', 'text', 'YES', null], ['parent_sessions', 'ip_address', 'character varying', 'YES', null, 45],
    ['parent_notifications', 'id', 'bigint', 'NO', 'nextval(...)'], ['parent_notifications', 'event_type', 'character varying', 'NO', null, 64],
    ['parent_notifications', 'parent_id', 'integer', 'NO', null], ['parent_notifications', 'learner_id', 'integer', 'YES', null],
    ['parent_notifications', 'title', 'character varying', 'NO', null, 180], ['parent_notifications', 'summary', 'character varying', 'NO', null, 500],
    ['parent_notifications', 'deep_link', 'character varying', 'NO', null, 80], ['parent_notifications', 'dedupe_key', 'character varying', 'NO', null, 240],
    ['parent_notifications', 'important', 'boolean', 'NO', 'false'], ['parent_notifications', 'created_at', 'timestamp with time zone', 'NO', 'now()'],
    ['parent_notification_reads', 'notification_id', 'bigint', 'NO', null], ['parent_notification_reads', 'parent_id', 'integer', 'NO', null],
    ['parent_notification_reads', 'read_at', 'timestamp with time zone', 'NO', 'now()'], ['parent_notification_reads', 'dismissed_at', 'timestamp with time zone', 'YES', null],
    ['parent_push_subscriptions', 'id', 'bigint', 'NO', 'nextval(...)'], ['parent_push_subscriptions', 'parent_id', 'integer', 'NO', null],
    ['parent_push_subscriptions', 'endpoint', 'text', 'NO', null], ['parent_push_subscriptions', 'subscription', 'jsonb', 'NO', null],
    ['parent_push_subscriptions', 'is_active', 'boolean', 'NO', 'true'], ['parent_push_subscriptions', 'created_at', 'timestamp with time zone', 'NO', 'now()'],
    ['parent_push_subscriptions', 'updated_at', 'timestamp with time zone', 'NO', 'now()'],
    ['announcements', 'target_parent_ids', 'jsonb', 'NO', "'[]'::jsonb"], ['announcements', 'target_audience', 'character varying', 'YES', null],
    ['documents', 'target_parent_ids', 'jsonb', 'NO', "'[]'::jsonb"], ['documents', 'important', 'boolean', 'NO', 'false'],
    ['documents', 'notify_email', 'boolean', 'NO', 'false'], ['documents', 'target_audience', 'character varying', 'YES', null],
    ['invoices', 'id', 'integer', 'NO', 'nextval(...)'], ['invoices', 'student_id', 'integer', 'NO', null],
    ['invoices', 'student_number', 'character varying', 'NO', null], ['invoices', 'amount_due', 'numeric', 'NO', '0'],
    ['invoices', 'amount_paid', 'numeric', 'NO', '0'], ['invoices', 'due_date', 'date', 'NO', null], ['invoices', 'status', 'character varying', 'NO', null],
    ['invoices', 'description', 'text', 'YES', null], ['invoices', 'carried_forward_to_invoice_id', 'integer', 'YES', null],
    ['payment_transactions', 'id', 'integer', 'NO', 'nextval(...)'], ['payment_transactions', 'invoice_id', 'integer', 'YES', null],
    ['payment_transactions', 'student_id', 'integer', 'NO', null], ['payment_transactions', 'student_number', 'character varying', 'YES', null],
    ['payment_transactions', 'amount', 'numeric', 'NO', null], ['payment_transactions', 'reverses_transaction_id', 'integer', 'YES', null],
  ];
  const columns = columnDefinitions.map(([table_name, column_name, data_type, is_nullable, column_default, character_maximum_length]) =>
    ({ table_name, column_name, data_type, is_nullable, column_default, character_maximum_length }));
  columns.push(
    { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
    { table_name: 'users', column_name: 'student_number', data_type: 'character varying', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'role', data_type: 'character varying', is_nullable: 'NO' },
    { table_name: 'users', column_name: 'is_active', data_type: 'boolean', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'email', data_type: 'character varying', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'is_boarder', data_type: 'boolean', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'uses_transport', data_type: 'boolean', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'uses_aftercare', data_type: 'boolean', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'has_sibling_discount', data_type: 'boolean', is_nullable: 'YES' },
    { table_name: 'users', column_name: 'has_teacher_discount', data_type: 'boolean', is_nullable: 'YES' },
    { table_name: 'service_prices', column_name: 'service_key', data_type: 'character varying', is_nullable: 'NO' },
    { table_name: 'service_prices', column_name: 'label', data_type: 'character varying', is_nullable: 'NO' },
    { table_name: 'service_prices', column_name: 'amount', data_type: 'numeric', is_nullable: 'NO' },
  );
  columns.push({ table_name: 'parent_students', column_name: 'parent_id', data_type: 'integer', is_nullable: 'NO' },
    { table_name: 'parent_students', column_name: 'student_id', data_type: 'integer', is_nullable: 'NO' });
  const indexes = [
    ['parent_auth_tokens', 'idx_parent_auth_tokens_user', false, ['user_id']], ['parent_auth_tokens', 'idx_parent_auth_tokens_expiry', false, ['expires_at']],
    ['parent_sessions', 'idx_parent_sessions_user', false, ['user_id']], ['parent_sessions', 'idx_parent_sessions_family', false, ['family_id']], ['parent_sessions', 'idx_parent_sessions_expiry', false, ['expires_at']],
    ['parent_notifications', 'idx_parent_notifications_parent_created', false, ['parent_id', 'created_at']], ['parent_notifications', 'idx_parent_notifications_learner', false, ['learner_id', 'created_at']],
    ['parent_notification_reads', 'idx_parent_notification_reads_parent', false, ['parent_id', 'read_at']],
    ['parent_push_subscriptions', 'uq_parent_push_subscriptions_endpoint', true, ['endpoint']], ['parent_push_subscriptions', 'idx_parent_push_subscriptions_parent_active', false, ['parent_id', 'is_active']],
    ['announcements', 'idx_announcements_target_parent_ids', false, ['target_parent_ids']], ['documents', 'idx_documents_target_parent_ids', false, ['target_parent_ids']],
    ['invoices', 'invoices_carried_forward_to_invoice_id_idx', false, ['carried_forward_to_invoice_id']],
    ['payment_transactions', 'payment_transactions_one_reversal_idx', true, ['reverses_transaction_id']],
    ['payment_transactions', 'payment_transactions_invoice_id_idx', false, ['invoice_id']],
  ].map(([table_name, indexname, is_unique, columns]) => ({
    table_name, indexname, is_unique, columns, directions: columns.map(() => 'ASC'), predicate: null,
    indexdef: `CREATE ${is_unique ? 'UNIQUE ' : ''}INDEX ${indexname} ON ${table_name} (${columns.join(', ')})`,
  }));
  indexes[12].predicate = 'carried_forward_to_invoice_id IS NOT NULL';
  indexes[13].predicate = 'reverses_transaction_id IS NOT NULL';
  indexes[14].predicate = 'invoice_id IS NOT NULL';
  indexes[10].indexdef += ' USING gin';
  indexes[11].indexdef += ' USING gin';
  indexes[5].directions[1] = 'DESC';
  indexes[6].directions[1] = 'DESC';
  const pk = (table_name, columns) => ({ table_name, contype: 'p', columns });
  const constraints = [
    pk('parent_auth_tokens', ['id']), pk('parent_sessions', ['id']),
    { table_name: 'parent_auth_tokens', contype: 'u', columns: ['token_hash'] },
    { table_name: 'parent_sessions', contype: 'u', columns: ['refresh_token_hash'] },
    { table_name: 'parent_auth_tokens', contype: 'c', columns: ['token_type'], definition: "CHECK (token_type IN ('activation', 'reset'))" },
    pk('parent_notifications', ['id']), pk('parent_notification_reads', ['notification_id', 'parent_id']), pk('parent_push_subscriptions', ['id']),
    { table_name: 'parent_notifications', contype: 'u', columns: ['parent_id', 'dedupe_key'] },
    { table_name: 'parent_notifications', contype: 'c', columns: ['deep_link'], definition: "CHECK (deep_link IN ('/parent', '/parent/dashboard', '/parent/attendance', '/parent/grades', '/parent/invoices', '/parent/payment-proof', '/parent/documents', '/parent/announcements', '/parent/notifications'))" },
    { table_name: 'announcements', contype: 'c', columns: [], conname: 'announcements_target_audience_check', definition: "CHECK (target_audience IN ('everyone', 'staff', 'students', 'parents', 'all_parents', 'grade', 'class', 'specific_parents'))" },
    { table_name: 'documents', contype: 'c', columns: [], conname: 'check_target_audience', definition: "CHECK (target_audience IN ('everyone', 'student', 'staff', 'parents', 'all_parents', 'grade', 'class', 'specific_parents'))" },
  ];
  const fk = (table_name, columns, referenced_table, referenced_columns, on_delete) =>
    ({ table_name, contype: 'f', columns, referenced_table, referenced_columns, on_delete });
  constraints.push(fk('parent_auth_tokens', ['user_id'], 'users', ['id'], 'CASCADE'),
    fk('parent_auth_tokens', ['created_by'], 'users', ['id'], 'SET NULL'),
    fk('parent_sessions', ['user_id'], 'users', ['id'], 'CASCADE'),
    fk('parent_notifications', ['parent_id'], 'users', ['id'], 'CASCADE'),
    fk('parent_notifications', ['learner_id'], 'users', ['id'], 'CASCADE'),
    fk('parent_notification_reads', ['notification_id'], 'parent_notifications', ['id'], 'CASCADE'),
    fk('parent_notification_reads', ['parent_id'], 'users', ['id'], 'CASCADE'),
    fk('parent_push_subscriptions', ['parent_id'], 'users', ['id'], 'CASCADE'),
    fk('payment_transactions', ['reverses_transaction_id'], 'payment_transactions', ['id'], 'RESTRICT'),
    fk('invoices', ['carried_forward_to_invoice_id'], 'invoices', ['id'], 'SET NULL'));
  return { tables: [...tables].map((table_name) => ({ table_name })), columns: [...columns], indexes, constraints };
}

function fakeDatabase(metadataOverride = null) {
  const calls = [];
  const metadata = metadataOverride || completeMetadataRows();
  const client = {
    calls,
    async query(sql, params = []) {
      calls.push(String(sql));
      if (/^BEGIN|^SET LOCAL|^SET TRANSACTION|^ROLLBACK/i.test(sql)) return { rows: [] };
      if (/^SHOW transaction_read_only/i.test(sql)) return { rows: [{ transaction_read_only: 'on' }] };
      if (/current_setting\('transaction_read_only'/i.test(sql)) return { rows: [{ transaction_read_only: 'on' }] };
      if (/information_schema\.tables/i.test(sql)) return { rows: metadata.tables };
      if (/information_schema\.columns/i.test(sql)) return { rows: metadata.columns };
      if (/FROM pg_constraint/i.test(sql)) return { rows: metadata.constraints };
      if (/FROM pg_index /i.test(sql)) return { rows: metadata.indexes };
      if (/source\.carried_forward_to_invoice_id AS persisted_successor_id/i.test(sql)) return {
        rows: [{
          student_number: 'STU-7', source_id: 9, successor_id: 11, source_year: 2024,
          candidate_count: 2,
          source_amount_due: '100', source_amount_paid: '25',
          successor_amount_due: '200', successor_amount_paid: '50',
        }],
      };
      if (/WITH linked/i.test(sql)) return { rows: [{ id: 7, student_number: 'STU-7' }] };
      if (/i\.student_number = \$1/i.test(sql)) return { rows: [{ billed: 100, paid: 10, outstanding: 90, credit: 0 }] };
      if (/i\.student_id = \$1/i.test(sql)) return { rows: [{ billed: 100, paid: 0, outstanding: 100, credit: 0 }] };
      if (/SELECT p\.id/i.test(sql)) return {
        rows: [
          { id: 1, is_active: true, has_email: true, activated_at: null, invitation_sent_at: null, auth_revoked_at: null, linked_count: 1, linked_learner_student_numbers: ['STU-7'] },
          { id: 2, is_active: true, has_email: false, activated_at: null, invitation_sent_at: '2026-01-01', auth_revoked_at: null, linked_count: 0, linked_learner_student_numbers: [] },
          { id: 3, is_active: false, has_email: true, activated_at: null, invitation_sent_at: null, auth_revoked_at: null, linked_count: 1, linked_learner_student_numbers: ['STU-8'] },
        ],
      };
      if (/payment_transactions pt/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
    release() { calls.push('RELEASE'); },
  };
  return { pool: { connect: async () => client }, client };
}

test('categorization is exclusive and uses server-owned rollout fields', () => {
  assert.equal(categorizeParentAccount({ activated_at: 'x', is_active: false, linked_count: 0 }), 'NEEDS_REVIEW');
  assert.equal(categorizeParentAccount({ activated_at: 'x', is_active: true, linked_count: 0 }), 'ALREADY_ACTIVATED');
  assert.equal(categorizeParentAccount({ activated_at: 'x', is_active: true, auth_revoked_at: 'x', linked_count: 0 }), 'NEEDS_REVIEW');
  assert.equal(categorizeParentAccount({ auth_revoked_at: 'x', is_active: true, linked_count: 1, has_email: true }), 'NEEDS_REVIEW');
  assert.equal(categorizeParentAccount({ is_active: true, linked_count: 1, has_email: true }), 'READY_FOR_EMAIL_INVITE');
  assert.equal(categorizeParentAccount({ is_active: true, linked_count: 0, has_email: true }), 'READY_FOR_MANUAL_LINK');
});

test('totals expose billed, paid, outstanding and credit mismatches', () => {
  const [result] = compareTotals([{
    student_number: 'STU-1', admin_billed: 100, admin_paid: 50, admin_outstanding: 50, admin_credit: 2,
    parent_billed: 100, parent_paid: 40, parent_outstanding: 60, parent_credit: 0,
  }]);
  assert.deepEqual(result.mismatches, ['paid', 'outstanding', 'credit']);
});

test('schema readiness is explicit when migration objects are absent', async () => {
  const emptyClient = { query: async () => ({ rows: [] }) };
  const { readiness } = await checkSchemaReadiness(emptyClient);
  assert.equal(readiness.parent_activation_phase2.status, 'INCOMPLETE');
  assert.ok(readiness.parent_activation_phase2.missing.some((item) => item.startsWith('table ')));
});

test('same-name malformed index and constraint are incomplete', async () => {
  const malformed = completeMetadataRows();
  const index = malformed.indexes.find((row) => row.indexname === 'uq_parent_push_subscriptions_endpoint');
  index.is_unique = false;
  const check = malformed.constraints.find((row) => row.conname === 'announcements_target_audience_check');
  check.definition = 'CHECK (target_audience IN (\'everyone\'))';
  malformed.columns.find((row) => row.table_name === 'parent_auth_tokens' && row.column_name === 'token_hash').character_maximum_length = 32;
  malformed.columns.find((row) => row.table_name === 'parent_notifications' && row.column_name === 'important').column_default = null;
  malformed.indexes.find((row) => row.indexname === 'idx_parent_notifications_parent_created').directions[1] = 'ASC';
  const { readiness } = await checkSchemaReadiness({
    query: async (sql) => {
      if (/information_schema\.tables/.test(sql)) return { rows: malformed.tables };
      if (/information_schema\.columns/.test(sql)) return { rows: malformed.columns };
      if (/FROM pg_constraint/.test(sql)) return { rows: malformed.constraints };
      return { rows: malformed.indexes };
    },
  });
  assert.equal(readiness.parent_activation_phase2.status, 'INCOMPLETE');
  assert.ok(readiness.parent_activation_phase2.missing.includes(
    'column definition parent_auth_tokens.token_hash',
  ));
  assert.equal(readiness.parent_notifications_phase3.status, 'INCOMPLETE');
  assert.equal(readiness.parent_targeting_phase4.status, 'INCOMPLETE');
});

test('GIN readiness ignores non-B-tree direction metadata but enforces method/name/column', async () => {
  const metadata = completeMetadataRows();
  const query = async (sql) => {
    if (/information_schema\.tables/.test(sql)) return { rows: metadata.tables };
    if (/information_schema\.columns/.test(sql)) return { rows: metadata.columns };
    if (/FROM pg_constraint/.test(sql)) return { rows: metadata.constraints };
    return { rows: metadata.indexes };
  };

  // GIN does not have B-tree sort direction semantics. Null/non-B-tree
  // direction metadata must not make an otherwise valid index incomplete.
  metadata.indexes.find((row) => row.indexname === 'idx_announcements_target_parent_ids').directions = [null];
  metadata.indexes.find((row) => row.indexname === 'idx_documents_target_parent_ids').directions = ['DESC'];
  let { readiness } = await checkSchemaReadiness({ query });
  assert.equal(readiness.parent_targeting_phase4.status, 'APPLIED');

  const malformedMethod = metadata.indexes.find((row) => row.indexname === 'idx_documents_target_parent_ids');
  malformedMethod.indexdef = malformedMethod.indexdef.replace(/USING gin/i, 'USING btree');
  ({ readiness } = await checkSchemaReadiness({ query }));
  assert.equal(readiness.parent_targeting_phase4.status, 'INCOMPLETE');

  malformedMethod.indexdef = malformedMethod.indexdef.replace(/USING btree/i, 'USING gin');
  malformedMethod.indexname = 'wrong_documents_target_parent_ids';
  ({ readiness } = await checkSchemaReadiness({ query }));
  assert.equal(readiness.parent_targeting_phase4.status, 'INCOMPLETE');

  malformedMethod.indexname = 'idx_documents_target_parent_ids';
  malformedMethod.columns = ['wrong_column'];
  ({ readiness } = await checkSchemaReadiness({ query }));
  assert.equal(readiness.parent_targeting_phase4.status, 'INCOMPLETE');
});

test('configuration audit reports presence only, never values', () => {
  const env = {
    NODE_ENV: 'production', FRONTEND_URL: 'https://portal.example',
    GOOGLE_GMAIL_CLIENT_ID: 'gmail-secret', GOOGLE_GMAIL_CLIENT_SECRET: 'gmail-secret',
    GOOGLE_GMAIL_REFRESH_TOKEN: 'gmail-secret', GMAIL_USER: 'sender@example',
    AWS_ACCESS_KEY_ID: 'aws-secret', AWS_SECRET_ACCESS_KEY: 'aws-secret',
    AWS_S3_BUCKET_NAME: 'bucket', AWS_REGION: 'region',
  };
  const result = checkEnvironment(env, 'NODE_ENV === "production"; httpOnly: true; sameSite: "lax"; path: "/api/auth"; remember ? refresh.expiresIn; normal login deliberately gets a browser-session cookie');
  const output = formatAuditReport({ environment: result, schema: {}, finance: {}, totals: {}, parents: {} });
  assert.equal(result.gmailOAuth.configured, true);
  assert.equal(result.awsS3.configured, true);
  assert.equal(result.frontendUrl.valid, true);
  for (const secret of ['gmail-secret', 'aws-secret', 'portal.example']) assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /GOOGLE_GMAIL_CLIENT_ID/);
  assert.doesNotMatch(output, /first_name|last_name|phone_number|password|session_id/i);
});

test('audit uses one read-only client, rolls back, and reports safe findings', async () => {
  const { pool, client } = fakeDatabase();
  const report = await runAudit({
    database: { pool },
    environment: { NODE_ENV: 'production', FRONTEND_URL: 'https://portal.example' },
  });
  assert.equal(report.schema.manual_finance_reconciliation.status, 'APPLIED');
  assert.equal(report.finance.carry_forward_review[0].candidate_count, 2);
  assert.deepEqual(report.totals.mismatches[0].mismatches, ['paid', 'outstanding']);
  assert.equal(report.parents.summary.total, 3);
  assert.equal(report.parents.summary.categories.READY_FOR_EMAIL_INVITE, 1);
  assert.equal(report.parents.summary.categories.READY_FOR_MANUAL_LINK, 1);
  assert.equal(report.parents.summary.categories.NEEDS_REVIEW, 1);
  assert.equal(new Set(report.parents.accounts.map((row) => row.category)).size, 3);
  assert.equal(client.calls.at(-1), 'RELEASE');
  assert.ok(client.calls.some((sql) => /^ROLLBACK$/i.test(sql)));
  assert.ok(client.calls.some((sql) => /^BEGIN TRANSACTION READ ONLY$/i.test(sql)));
  assert.ok(client.calls.some((sql) => /SET LOCAL statement_timeout/i.test(sql)));
  assert.equal(client.calls.some((sql) => /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(sql)), false);
  assert.equal(JSON.stringify(report).includes('gmail-secret'), false);
});

test('audit fails explicitly when the server does not establish read-only mode', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (/^SHOW transaction_read_only/i.test(sql)) return { rows: [{ transaction_read_only: 'off' }] };
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); },
  };
  await assert.rejects(
    runAudit({ database: { pool: { connect: async () => client } } }),
    /Read-only transaction could not be established/,
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(calls.includes('RELEASE'));
});

test('only declared query ids are accepted', async () => {
  await assert.rejects(readQuery({ query: async () => ({ rows: [] }) }, 'SELECT 1; DROP TABLE users'), /Unknown preflight query id/);
});

test('rollback failure still releases and preserves the primary query error', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (/^SHOW/.test(sql)) return { rows: [{ transaction_read_only: 'on' }] };
      if (/current_setting/.test(sql)) return { rows: [{ transaction_read_only: 'on' }] };
      if (/^ROLLBACK/.test(sql)) throw new Error('rollback failed');
      if (/information_schema/.test(sql)) throw new Error('primary query failed');
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); },
  };
  await assert.rejects(runAudit({ database: { pool: { connect: async () => client } } }), /primary query failed/);
  assert.equal(calls.at(-1), 'RELEASE');
});

test('full audit with missing schema reports skips and still rolls back', async () => {
  const { pool, client } = fakeDatabase({ tables: [], columns: [], indexes: [], constraints: [] });
  const report = await runAudit({ database: { pool }, environment: {} });
  assert.equal(report.finance.status, 'SKIPPED');
  assert.equal(report.totals.status, 'SKIPPED');
  assert.equal(report.parents.status, 'SKIPPED');
  assert.ok(client.calls.includes('ROLLBACK'));
});

test('package registers the exact preflight command', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['audit:parent-rollout-preflight'], 'node scripts/audit-parent-rollout-preflight.js');
});