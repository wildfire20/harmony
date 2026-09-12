const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function fakeDatabase({ queryFailure, releaseFailure, endFailure } = {}) {
  const calls = [];
  const client = {
    async query(sql) {
      const text = String(sql);
      const label = /^BEGIN$/i.test(text) ? 'begin'
        : /^COMMIT$/i.test(text) ? 'commit'
          : /^ROLLBACK$/i.test(text) ? 'rollback'
            : 'migration';
      calls.push(label);
      if (queryFailure && queryFailure.test(text)) throw new Error('query failed');
      return { rows: [] };
    },
    release() {
      calls.push('release');
      if (releaseFailure) throw new Error('release failed');
    },
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      },
      async end() {
        calls.push('end');
        if (endFailure) throw new Error('end failed');
      },
    },
  };
}

async function withRunnerVerifier(result, callback, onVerify = () => {}) {
  const verifierPath = require.resolve('../scripts/parent-schema-verifier');
  const runnerPath = require.resolve('../scripts/run-parent-phase-migration');
  const verifier = require(verifierPath);
  const original = verifier.checkSchemaPhaseReadiness;
  verifier.checkSchemaPhaseReadiness = async () => {
    onVerify();
    return result;
  };
  delete require.cache[runnerPath];
  try {
    return await callback(require(runnerPath));
  } finally {
    verifier.checkSchemaPhaseReadiness = original;
    delete require.cache[runnerPath];
  }
}

test('manual runner orders migration, verification, commit, cleanup, then success', async () => {
  const database = fakeDatabase();
  const output = [];
  const order = database.calls;
  const originalLog = console.log;
  console.log = (message) => {
    output.push(message);
    order.push('success');
  };
  try {
    await withRunnerVerifier({ status: 'APPLIED', missing: [] }, ({ runParentPhaseMigration }) =>
      runParentPhaseMigration({
        database,
        phase: 'parent_targeting_phase4',
        migrationFiles: ['parent_targeting_phase4.sql'],
        successMessage: 'applied',
      }), () => order.push('verify'));
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(order, ['begin', 'migration', 'verify', 'commit', 'release', 'end', 'success']);
  assert.deepEqual(output, ['applied']);
});

test('verification failure rolls back and never prints success', async () => {
  const database = fakeDatabase();
  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(message);
  try {
    await assert.rejects(
      withRunnerVerifier(
        { status: 'INCOMPLETE', missing: ['index documents.idx_documents_target_parent_ids'] },
        ({ runParentPhaseMigration }) => runParentPhaseMigration({
          database,
          phase: 'parent_targeting_phase4',
          migrationFiles: ['parent_targeting_phase4.sql'],
          successMessage: 'applied',
        }),
      ),
      /verification failed.*idx_documents_target_parent_ids/,
    );
  } finally {
    console.log = originalLog;
  }
  assert.ok(database.calls.includes('rollback'));
  assert.equal(database.calls.includes('commit'), false);
  assert.deepEqual(output, []);
});

test('SQL execution failure rolls back without commit or success', async () => {
  const database = fakeDatabase({ queryFailure: /Parent-safe targeting/ });
  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(message);
  try {
    await assert.rejects(
      withRunnerVerifier({ status: 'APPLIED', missing: [] }, ({ runParentPhaseMigration }) =>
        runParentPhaseMigration({
          database,
          phase: 'parent_targeting_phase4',
          migrationFiles: ['parent_targeting_phase4.sql'],
          successMessage: 'applied',
        })),
      /query failed/,
    );
  } finally {
    console.log = originalLog;
  }
  assert.ok(database.calls.includes('rollback'));
  assert.equal(database.calls.includes('commit'), false);
  assert.deepEqual(output, []);
});

test('commit failure rolls back and does not print success', async () => {
  const database = fakeDatabase({ queryFailure: /^COMMIT$/i });
  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(message);
  try {
    await assert.rejects(
      withRunnerVerifier({ status: 'APPLIED', missing: [] }, ({ runParentPhaseMigration }) =>
        runParentPhaseMigration({
          database,
          phase: 'parent_targeting_phase4',
          migrationFiles: ['parent_targeting_phase4.sql'],
          successMessage: 'applied',
        })),
      /query failed/,
    );
  } finally {
    console.log = originalLog;
  }
  assert.ok(database.calls.includes('rollback'));
  assert.equal(database.calls.includes('commit'), true);
  assert.deepEqual(output, []);
});

test('release failure still attempts pool end and never prints success', async () => {
  const database = fakeDatabase({ releaseFailure: true });
  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(message);
  try {
    await assert.rejects(
      withRunnerVerifier({ status: 'APPLIED', missing: [] }, ({ runParentPhaseMigration }) =>
        runParentPhaseMigration({
          database,
          phase: 'parent_targeting_phase4',
          migrationFiles: ['parent_targeting_phase4.sql'],
          successMessage: 'applied',
        })),
      /release failed/,
    );
  } finally {
    console.log = originalLog;
  }
  assert.ok(database.calls.includes('release'));
  assert.ok(database.calls.includes('end'));
  assert.deepEqual(output, []);
});

test('pool end failure after release never prints success', async () => {
  const database = fakeDatabase({ endFailure: true });
  const output = [];
  const originalLog = console.log;
  console.log = (message) => output.push(message);
  try {
    await assert.rejects(
      withRunnerVerifier({ status: 'APPLIED', missing: [] }, ({ runParentPhaseMigration }) =>
        runParentPhaseMigration({
          database,
          phase: 'parent_targeting_phase4',
          migrationFiles: ['parent_targeting_phase4.sql'],
          successMessage: 'applied',
        })),
      /end failed/,
    );
  } finally {
    console.log = originalLog;
  }
  assert.ok(database.calls.includes('release'));
  assert.ok(database.calls.includes('end'));
  assert.deepEqual(output, []);
});

test('Phase 3 semantic uniqueness runs in the base migration before repair', () => {
  const base = fs.readFileSync(
    require.resolve('../migrations/parent_notifications_phase3.sql'),
    'utf8',
  );
  const repair = fs.readFileSync(
    require.resolve('../migrations/parent_notifications_phase3_legacy_push_repair.sql'),
    'utf8',
  );
  const runner = fs.readFileSync(
    require.resolve('../scripts/run-parent-notifications-migration.js'),
    'utf8',
  );
  assert.doesNotMatch(base, /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
  assert.match(base, /DO\s+\$\$[\s\S]*?uq_parent_push_subscriptions_endpoint[\s\S]*?CREATE\s+UNIQUE\s+INDEX/i);
  assert.doesNotMatch(repair, /CREATE\s+UNIQUE\s+INDEX/i);
  assert.match(runner, /parent_notifications_phase3\.sql[\s\S]*parent_notifications_phase3_legacy_push_repair\.sql/);
});

test('Phase 3 repair and Phase 4 indexes retain additive contracts', () => {
  const repair = fs.readFileSync(
    require.resolve('../migrations/parent_notifications_phase3_legacy_push_repair.sql'),
    'utf8',
  );
  const verifier = fs.readFileSync(
    require.resolve('../scripts/audit-parent-rollout-preflight.js'),
    'utf8',
  );
  const targeting = fs.readFileSync(
    require.resolve('../migrations/parent_targeting_phase4.sql'),
    'utf8',
  );
  assert.match(verifier, /parent_push_subscriptions', 'id', \['bigint', 'integer'\]/);
  assert.match(verifier, /parent_push_subscriptions', 'created_at', \['timestamp with time zone', 'timestamp without time zone'\]/);
  assert.match(repair, /SET is_active = true\s+WHERE is_active IS NULL/);
  assert.match(repair, /ON DELETE CASCADE/);
  assert.match(targeting, /CREATE INDEX IF NOT EXISTS idx_announcements_target_parent_ids\s+ON announcements USING GIN/i);
  assert.match(targeting, /CREATE INDEX IF NOT EXISTS idx_documents_target_parent_ids\s+ON documents USING GIN/i);
});