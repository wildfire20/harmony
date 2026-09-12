const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  TABLE_ALLOWLIST,
  QUERIES,
  runDiagnostic,
} = require('../scripts/audit-parent-schema-debug');

function fakeDatabase({ readOnly = 'on', failOn } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (failOn && failOn.test(String(sql))) throw new Error('catalog query failed');
      const text = String(sql);
      if (text === QUERIES.transactionReadOnly) {
        return { rows: [{ transaction_read_only: readOnly }] };
      }
      if (text.includes('FROM information_schema.columns')) {
        return {
          rows: [{
            table_schema: 'public',
            table_name: 'parent_auth_tokens',
            ordinal_position: 1,
            column_name: 'id',
            data_type: 'bigint',
            udt_name: 'int8',
            is_nullable: 'NO',
            column_default: "nextval('public.parent_auth_tokens_id_seq'::regclass)",
            is_identity: 'NO',
            identity_generation: null,
            is_generated: 'NEVER',
            generation_expression: null,
            character_maximum_length: null,
            raw_attidentity: '',
            raw_attgenerated: '',
          }],
        };
      }
      if (text.includes('FROM pg_catalog.pg_index')) {
        return {
          rows: [{
            table_schema: 'public',
            table_name: 'parent_auth_tokens',
            index_schema: 'public',
            index_name: 'parent_auth_tokens_pkey',
            access_method: 'btree',
            is_unique: true,
            is_primary: true,
            is_valid: true,
            is_ready: true,
            predicate: null,
            index_definition: 'CREATE UNIQUE INDEX parent_auth_tokens_pkey ON public.parent_auth_tokens USING btree (id)',
            raw_indkey: '1',
            raw_indoption: '0',
            indexed_keys: [{
              position: 1,
              attnum: 1,
              column: 'id',
              expression: 'id',
              option_bits: 0,
              direction: 'ASC',
              null_order: 'LAST',
              option_bits_decoded: { desc: false, nulls_first: false },
            }],
            included_columns: [],
          }],
        };
      }
      if (text.includes('FROM pg_catalog.pg_constraint')) {
        return {
          rows: [{
            table_schema: 'public',
            table_name: 'parent_auth_tokens',
            constraint_name: 'parent_auth_tokens_pkey',
            raw_contype: 'p',
            constraint_type: 'PRIMARY KEY',
            is_validated: true,
            is_deferrable: false,
            is_deferred: false,
            columns: ['id'],
            referenced_columns: [],
            constraint_definition: 'PRIMARY KEY (id)',
            raw_conkey: '{1}',
            raw_confkey: null,
          }],
        };
      }
      if (text.includes('pg_catalog.pg_depend')) {
        return {
          rows: [{
            sequence_schema: 'public',
            sequence_name: 'parent_auth_tokens_id_seq',
            owning_table_schema: 'public',
            owning_table: 'parent_auth_tokens',
            owning_column: 'id',
          }],
        };
      }
      if (text.includes('n.nspname <>')) {
        return { rows: [{ table_schema: 'archive', table_name: 'documents', relation_kind: 'r' }] };
      }
      return { rows: [] };
    },
    async release() {
      calls.push({ sql: 'RELEASE' });
    },
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      },
      async end() {
        calls.push({ sql: 'END' });
      },
    },
  };
}

test('diagnostic uses one read-only client and emits catalog metadata including raw index options', async () => {
  const database = fakeDatabase();
  const output = [];
  const diagnostic = await runDiagnostic({
    database,
    outputStream: { write(value) { output.push(value); } },
  });
  const statements = database.calls.filter((call) => call.sql !== 'RELEASE' && call.sql !== 'END');
  assert.equal(statements[0].sql, 'BEGIN TRANSACTION READ ONLY');
  assert.match(statements[1].sql, /^SET LOCAL statement_timeout/);
  assert.equal(statements[2].sql, 'SHOW transaction_read_only');
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(database.calls.slice(-2).map((call) => call.sql), ['RELEASE', 'END']);
  assert.deepEqual(diagnostic.table_allowlist, [...TABLE_ALLOWLIST]);
  assert.equal(diagnostic.indexes[0].raw_indkey, '1');
  assert.equal(diagnostic.indexes[0].indexed_keys[0].direction, 'ASC');
  assert.equal(diagnostic.indexes[0].indexed_keys[0].option_bits_decoded.nulls_first, false);
  assert.equal(diagnostic.sequences[0].sequence_schema, 'public');
  assert.match(output.join(''), /"column_default"/);
  assert.match(output.join(''), /"raw_indoption"/);
  assert.doesNotMatch(output.join(''), /password|email|token_hash|student_number/i);

  const catalogQueries = statements.slice(3, -1);
  assert.equal(catalogQueries.length, 6);
  for (const call of catalogQueries) {
    assert.deepEqual(call.params, [TABLE_ALLOWLIST]);
    assert.match(call.sql, /\bSELECT\b/i);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
    assert.doesNotMatch(call.sql, /\bSELECT\s+\*/i);
  }
});

test('diagnostic rejects a non-read-only transaction and still rolls back, releases, and ends', async () => {
  const database = fakeDatabase({ readOnly: 'off' });
  await assert.rejects(
    runDiagnostic({ database, outputStream: { write() {} } }),
    /not read-only/,
  );
  assert.equal(database.calls.at(-3).sql, 'ROLLBACK');
  assert.deepEqual(database.calls.slice(-2).map((call) => call.sql), ['RELEASE', 'END']);
});

test('diagnostic catalog failure rejects and performs cleanup without output', async () => {
  const database = fakeDatabase({ failOn: /pg_catalog\.pg_index/ });
  const output = [];
  await assert.rejects(
    runDiagnostic({ database, outputStream: { write(value) { output.push(value); } } }),
    /catalog query failed/,
  );
  assert.deepEqual(database.calls.slice(-3).map((call) => call.sql), ['ROLLBACK', 'RELEASE', 'END']);
  assert.deepEqual(output, []);
});

test('package command and parent wrappers retain the exact migration file lists and order', () => {
  const packageJson = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
  assert.equal(packageJson.scripts['audit:parent-schema-debug'], 'node scripts/audit-parent-schema-debug.js');
  const expected = {
    'run-parent-activation-migration.js': ['parent_activation_phase2.sql'],
    'run-parent-notifications-migration.js': [
      'parent_notifications_phase3.sql',
      'parent_notifications_phase3_legacy_push_repair.sql',
    ],
    'run-parent-targeting-migration.js': ['parent_targeting_phase4.sql'],
  };
  for (const [file, names] of Object.entries(expected)) {
    const source = fs.readFileSync(require.resolve(`../scripts/${file}`), 'utf8');
    const list = source.match(/migrationFiles:\s*\[([\s\S]*?)\]/)[1];
    assert.deepEqual([...list.matchAll(/'([^']+\.sql)'/g)].map((match) => match[1]), names);
    assert.match(source, /runParentPhaseMigration/);
    assert.match(source, /phase:/);
  }
});

test('diagnostic reuses shared database configuration without initializing it or defining TLS', () => {
  const source = fs.readFileSync(
    require.resolve('../scripts/audit-parent-schema-debug.js'),
    'utf8',
  );
  assert.match(source, /require\('\.\.\/config\/database'\)/);
  assert.doesNotMatch(source, /require\('pg'\)/);
  assert.doesNotMatch(source, /new Pool/);
  assert.doesNotMatch(source, /\bssl\s*:/);
  assert.doesNotMatch(source, /rejectUnauthorized/);
  assert.doesNotMatch(source, /PGSSLMODE|DATABASE_URL|PGSSLROOTCERT/);
  assert.doesNotMatch(source, /\.initialize\s*\(/);
  assert.match(source, /const databaseHandle = database \|\| sharedDatabase\(\)/);
  assert.match(source, /const pool = databaseHandle\.pool \|\| databaseHandle/);
  assert.match(source, /c\.is_identity/);
  assert.doesNotMatch(source, /c\.identity_column/);
  assert.match(source, /WHEN 'n' THEN 'NOT NULL'/);
  assert.match(source, /unnest\(ix\.indkey\) WITH ORDINALITY/);
  assert.match(source, /pg_get_indexdef\(ix\.indexrelid, k\.ord::integer, true\)/);
  assert.match(source, /ix\.indoption\[k\.ord - 1\]/);
});

test('shared runner awaits each migration on the transaction client before verification', () => {
  const source = fs.readFileSync(
    require.resolve('../scripts/run-parent-phase-migration.js'),
    'utf8',
  );
  assert.match(source, /for \(const migrationFile of migrationFiles\)/);
  assert.match(source, /await client\.query\(sql\)/);
  assert.match(source, /await checkSchemaPhaseReadiness\(client, phase\)/);
  assert.ok(source.indexOf('await client.query(sql)') < source.indexOf(
    'await checkSchemaPhaseReadiness(client, phase)',
  ));
  assert.doesNotMatch(source, /return\s+await\s+client\.query\(sql\)/);
});