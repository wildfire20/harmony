const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tooling = require('../scripts/parent-self-activation-tooling');

function catalog(installed) {
  const tables = [
    'users', 'parent_students', 'parent_auth_tokens', 'parent_sessions', 'audit_logs', 'grades', 'classes',
  ];
  const columns = [
    { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    { table_name: 'users', column_name: 'role', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    { table_name: 'users', column_name: 'is_active', data_type: 'boolean', is_nullable: 'NO', column_default: 'true' },
    { table_name: 'users', column_name: 'password', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    { table_name: 'users', column_name: 'phone_number', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'users', column_name: 'email', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'users', column_name: 'activated_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    { table_name: 'users', column_name: 'must_change_password', data_type: 'boolean', is_nullable: 'NO', column_default: 'false' },
    { table_name: 'users', column_name: 'password_changed_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    { table_name: 'users', column_name: 'updated_at', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null },
    { table_name: 'users', column_name: 'student_number', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'users', column_name: 'first_name', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    { table_name: 'users', column_name: 'last_name', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_students', column_name: 'parent_id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_students', column_name: 'student_id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_auth_tokens', column_name: 'user_id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_auth_tokens', column_name: 'used_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    { table_name: 'parent_auth_tokens', column_name: 'revoked_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    { table_name: 'parent_sessions', column_name: 'user_id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_sessions', column_name: 'refresh_token_hash', data_type: 'character', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_sessions', column_name: 'family_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_sessions', column_name: 'family_expires_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_sessions', column_name: 'expires_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
    { table_name: 'parent_sessions', column_name: 'user_agent', data_type: 'text', is_nullable: 'YES', column_default: null },
    { table_name: 'parent_sessions', column_name: 'ip_address', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'user_id', data_type: 'integer', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'user_name', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'user_role', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'action', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    { table_name: 'audit_logs', column_name: 'entity_type', data_type: 'character varying', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'entity_id', data_type: 'integer', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'details', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
    { table_name: 'audit_logs', column_name: 'ip_address', data_type: 'character varying', is_nullable: 'YES', column_default: null },
  ];
  for (const [table_name, column_name, types] of tooling.RUNTIME_COLUMNS) {
    if (columns.some((row) => row.table_name === table_name && row.column_name === column_name)) continue;
    columns.push({ table_name, column_name, data_type: types[0], is_nullable: 'YES', column_default: null });
  }
  if (installed) {
    tables.push('parent_activation_challenges');
    if (installed === true || installed === 'malformed') columns.push(
      { table_name: 'users', column_name: 'email_verified_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { table_name: 'users', column_name: 'parent_account_status', data_type: 'character varying', is_nullable: 'YES', column_default: null, character_maximum_length: 32 },
    );
    const challengeColumns = installed === 'prior'
      ? tooling.REQUIRED_COLUMNS.slice(2).filter(([, column]) =>
        !['delivery_confirmed_at', 'completion_token_hash'].includes(column))
      : tooling.REQUIRED_COLUMNS.slice(2);
    for (const [table, column, types, nullable, defaultValue, length] of challengeColumns) {
      columns.push({
        table_name: table, column_name: column, data_type: types[0],
        is_nullable: nullable ? 'YES' : 'NO',
        column_default: defaultValue === 'any' ? 'nextval(\'x\'::regclass)' : defaultValue,
        character_maximum_length: length,
      });
    }
  }
  const constraints = [
    ...(installed ? [
      ['parent_activation_challenges', 'p', ['id']],
      ['parent_activation_challenges', 'f', ['user_id'], 'users', ['id'], 'CASCADE'],
    ] : []),
    ['parent_auth_tokens', 'p', ['id']],
    ['parent_auth_tokens', 'u', ['token_hash']],
    ['parent_auth_tokens', 'f', ['user_id'], 'users', ['id'], 'CASCADE'],
    ['parent_auth_tokens', 'f', ['created_by'], 'users', ['id'], 'SET NULL'],
    ['parent_auth_tokens', 'c', [], null, [], null],
    ['parent_sessions', 'p', ['id']],
    ['parent_sessions', 'u', ['refresh_token_hash']],
    ['parent_sessions', 'f', ['user_id'], 'users', ['id'], 'CASCADE'],
    ['parent_students', 'u', ['parent_id', 'student_id']],
    ['parent_students', 'f', ['parent_id'], 'users', ['id'], 'CASCADE'],
    ['parent_students', 'f', ['student_id'], 'users', ['id'], 'CASCADE'],
  ].map(([table_name, contype, columns, referenced_table, referenced_columns, on_delete]) => ({
    table_name, contype, columns, referenced_table, referenced_columns, on_delete,
    definition: contype === 'c' ? "CHECK (token_type IN ('activation','reset'))" :
      contype === 'f' ? `FOREIGN KEY (${columns.join(',')}) REFERENCES ${referenced_table}(${referenced_columns.join(',')}) ON DELETE ${on_delete}` :
        `${contype === 'p' ? 'PRIMARY KEY' : 'UNIQUE'} (${columns.join(',')})`,
  }));
  const indexes = [
    ...(installed === true || installed === 'malformed' ? tooling.REQUIRED_INDEXES.map(([indexname, cols]) => ({
    indexname, tablename: 'parent_activation_challenges',
    indexdef: `CREATE INDEX ${indexname} ON public.parent_activation_challenges (${cols.join(', ')})`,
    })) : []),
    ...tooling.PHASE2_INDEXES.map(([, tablename, cols], index) => ({
      indexname: tooling.PHASE2_INDEXES[index][0], tablename,
      indexdef: `CREATE INDEX ${tooling.PHASE2_INDEXES[index][0]} ON public.${tablename} (${cols.join(', ')})`,
    })),
  ];
  if (installed === 'malformed') {
    indexes[0].indexdef = 'CREATE INDEX idx_parent_activation_challenges_user ON public.parent_activation_challenges (expires_at)';
  }
  return { tables, columns, constraints, indexes };
}

function auditDatabase({ installed = false, parents = [] } = {}) {
  const calls = [];
  const meta = catalog(installed);
  const client = {
    async query(sql, params) {
      const text = String(sql);
      calls.push(text);
      if (/FROM pg_indexes/.test(text)) {
        assert.deepEqual(params, [['parent_activation_challenges', 'parent_auth_tokens', 'parent_sessions']]);
      }
      if (/^BEGIN TRANSACTION READ ONLY$/i.test(text) || /^ROLLBACK$/i.test(text)) return { rows: [] };
      if (/information_schema\.tables/.test(text)) {
        return { rows: meta.tables.map((table_name) => ({ table_name })) };
      }
      if (/information_schema\.columns/.test(text)) return { rows: meta.columns };
      if (/FROM pg_constraint/.test(text)) return { rows: meta.constraints };
      if (/FROM pg_indexes/.test(text)) return { rows: meta.indexes };
      if (/SELECT\s+p\.id\s*,\s*p\.is_active/i.test(text)) return { rows: parents };
      throw new Error(`unexpected audit SQL: ${text}`);
    },
    async release() { calls.push('RELEASE'); },
  };
  return {
    calls,
    pool: {
      async connect() { return client; },
      async end() { calls.push('END'); },
    },
  };
}

function migrationDatabase({
  installedAfterMigration = true, drift = false, malformedPrior = false, priorShape = false,
  missingRuntime = null,
} = {}) {
  const calls = [];
  let installed = malformedPrior ? 'malformed' : (priorShape ? 'prior' : false);
  const client = {
    async query(sql, params) {
      const text = String(sql);
      calls.push(text);
      if (/FROM pg_indexes/.test(text)) {
        assert.deepEqual(params, [['parent_activation_challenges', 'parent_auth_tokens', 'parent_sessions']]);
      }
      if (/^BEGIN$/.test(text) || /^COMMIT$/.test(text) || /^ROLLBACK$/.test(text)) return { rows: [] };
      if (/information_schema\.tables/.test(text)) {
        return { rows: catalog(installed).tables.map((table_name) => ({ table_name })) };
      }
      if (/information_schema\.columns/.test(text)) {
        const columns = catalog(installed).columns
          .filter((row) => `${row.table_name}.${row.column_name}` !== missingRuntime);
        return { rows: columns };
      }
      if (/FROM pg_constraint/.test(text)) return { rows: catalog(installed).constraints };
      if (/FROM pg_indexes/.test(text)) return { rows: catalog(installed).indexes };
      if (/parent_count/.test(text)) {
        return { rows: [{ parent_count: drift && installed ? 2 : 1, password_count: 1,
          password_fingerprint_count: 1, password_fingerprint_digest: 'private-digest' }] };
      }
      if (/FROM parent_students/.test(text)) return { rows: [{ count: 1 }] };
      if (/FROM parent_sessions/.test(text) || /FROM parent_auth_tokens/.test(text)) {
        return { rows: [{ count: 1 }] };
      }
      if (/CREATE TABLE IF NOT EXISTS parent_activation_challenges/.test(text)) {
        installed = installedAfterMigration;
        return { rows: [] };
      }
      throw new Error(`unexpected migration SQL: ${text}`);
    },
    async release() {
      await new Promise((resolve) => setImmediate(resolve));
      calls.push('RELEASE');
    },
  };
  return {
    calls,
    pool: {
      async connect() { return client; },
      async end() { calls.push('END'); },
    },
  };
}

test('audit uses only read/catalog SQL and reports missing schema before migration', async () => {
  const database = auditDatabase({
    parents: [{ id: 1, is_active: true, phone_number: '0731234567', email: null,
      activated_at: null, linked_learner_count: 0 }],
  });
  const report = await tooling.runAudit({ database });
  assert.equal(report.audit, true);
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((item) => item.includes('parent_activation_challenges')));
  assert.equal(report.rollout.total, 1);
  assert.deepEqual(report.rollout.representative_parent_ids.READY_FOR_SELF_ACTIVATION, [1]);
  assert.ok(database.calls.every((sql) => sql === 'RELEASE' || sql === 'END' ||
    /^BEGIN TRANSACTION READ ONLY$|^ROLLBACK$|^SELECT\b|^\s*SELECT\b/i.test(sql)));
});

test('audit reports ok after migration and includes all category keys', async () => {
  const report = await tooling.runAudit({ database: auditDatabase({ installed: true }) });
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(Object.keys(report.rollout.categories), tooling.CATEGORY_NAMES);
  assert.equal(report.rollout.total, 0);
});

test('category precedence, independent activation totals, cleanup count and limited ids', () => {
  const parents = [
    { id: 1, is_active: false, phone_number: '0731234567', activated_at: 'x' },
    { id: 2, is_active: true, phone_number: '0731234567', activated_at: null },
    { id: 3, is_active: true, phone_number: null, activated_at: null },
    { id: 4, is_active: true, phone_number: 'not-mobile', activated_at: null },
    { id: 5, is_active: true, phone_number: '0821234567', parent_account_status: 'needs_review' },
    { id: 6, is_active: true, phone_number: '0831234567', parent_account_status: 'active' },
    { id: 7, is_active: true, phone_number: '0841234567', linked_learner_count: 2 },
  ];
  const result = tooling.categorizeParents(parents, 1);
  assert.equal(result.categories.DISABLED, 1);
  assert.equal(result.categories.DUPLICATE_OR_SHARED_MOBILE, 1);
  assert.equal(result.categories.READY_FOR_SELF_ACTIVATION, 1);
  assert.equal(result.categories.NEEDS_REVIEW, 1);
  assert.equal(result.activated, 2); // includes disabled account 1, not just ALREADY_ACTIVATED
  assert.equal(result.unactivated, 5);
  assert.equal(result.valid_normalized_mobile, 5);
  assert.equal(result.admin_cleanup_count, 5);
  assert.ok(Object.values(result.representative_parent_ids).every((ids) => ids.length <= 1));
});

test('migration verifies on the transaction client, commits, awaits release and closes pool', async () => {
  const database = migrationDatabase();
  const result = await tooling.runMigration({ database });
  assert.equal(result.ok, true);
  assert.ok(database.calls.some((sql) => sql === 'BEGIN'));
  assert.ok(database.calls.some((sql) => sql === 'COMMIT'));
  assert.ok(database.calls.indexOf('COMMIT') < database.calls.indexOf('RELEASE'));
  assert.ok(database.calls.indexOf('RELEASE') < database.calls.indexOf('END'));
});

test('migration rolls back on preservation drift and schema verification failure', async () => {
  for (const database of [migrationDatabase({ drift: true }), migrationDatabase({ installedAfterMigration: false })]) {
    await assert.rejects(() => tooling.runMigration({ database }));
    assert.ok(database.calls.some((sql) => sql === 'ROLLBACK'));
    assert.equal(database.calls.some((sql) => sql === 'COMMIT'), false);
  }
});

test('unsupported malformed partial schema fails before migration SQL, while supported prior shape converges', async () => {
  const malformed = migrationDatabase({ malformedPrior: true });
  await assert.rejects(() => tooling.runMigration({ database: malformed }), /pre-migration schema unsupported/);
  assert.equal(malformed.calls.some((sql) => /CREATE TABLE IF NOT EXISTS parent_activation_challenges/.test(sql)), false);
  assert.equal(malformed.calls.some((sql) => sql === 'COMMIT'), false);

  const prior = migrationDatabase({ priorShape: true });
  const result = await tooling.runMigration({ database: prior });
  assert.equal(result.ok, true);
  assert.ok(prior.calls.some((sql) => /CREATE TABLE IF NOT EXISTS parent_activation_challenges/.test(sql)));
  assert.ok(prior.calls.some((sql) => sql === 'COMMIT'));
});

test('missing legacy session, token or learner dependency blocks migration before SQL', async () => {
  for (const missingRuntime of [
    'parent_sessions.refresh_token_hash',
    'parent_auth_tokens.token_hash',
    'parent_students.student_id',
    'users.grade_id',
  ]) {
    const database = migrationDatabase({ missingRuntime });
    await assert.rejects(() => tooling.runMigration({ database }), /pre-migration schema unsupported/);
    assert.equal(database.calls.some((sql) => /CREATE TABLE IF NOT EXISTS parent_activation_challenges/.test(sql)), false);
    assert.equal(database.calls.some((sql) => sql === 'COMMIT'), false);
  }
});

test('package commands and CLI use the default database path when no injection is supplied', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['migrate:parent-self-activation'],
    'node scripts/run-parent-self-activation-migration.js');
  assert.equal(packageJson.scripts['audit:parent-self-activation'],
    'node scripts/audit-parent-self-activation.js');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-parent-self-activation-migration.js'), 'utf8'),
    /runMigration\(\)/);
});