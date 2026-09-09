const test = require('node:test');
const assert = require('node:assert/strict');
const { fixEnrollmentStatusWidth } = require('../scripts/fix-enrollment-status-width');

const createDatabase = (initialLength) => {
  let length = initialLength;
  const queries = [];
  const client = {
    async query(sql) {
      const text = String(sql).trim();
      queries.push(text);
      if (text.includes('FROM information_schema.columns')) {
        return {
          rows: [{
            data_type: 'character varying',
            character_maximum_length: length,
          }],
        };
      }
      if (text === 'ALTER TABLE enrollments ALTER COLUMN status TYPE VARCHAR(40)') {
        length = 40;
      }
      return { rows: [] };
    },
    release() {},
  };
  return {
    database: { pool: { connect: async () => client } },
    queries,
    getLength: () => length,
  };
};

const quietLogger = { log() {} };

test('widens enrollments.status only when below VARCHAR(40)', async () => {
  const fixture = createDatabase(20);
  const result = await fixEnrollmentStatusWidth({
    database: fixture.database,
    logger: quietLogger,
  });
  assert.deepEqual(result, { beforeLength: 20, afterLength: 40, changed: true });
  assert.equal(fixture.getLength(), 40);
  assert.equal(
    fixture.queries.filter((query) => query.startsWith('ALTER TABLE')).length,
    1,
  );
  assert.ok(fixture.queries.includes('COMMIT'));
});

test('does nothing when enrollments.status is already VARCHAR(40) or larger', async () => {
  for (const existingLength of [40, 80]) {
    const fixture = createDatabase(existingLength);
    const result = await fixEnrollmentStatusWidth({
      database: fixture.database,
      logger: quietLogger,
    });
    assert.deepEqual(result, {
      beforeLength: existingLength,
      afterLength: existingLength,
      changed: false,
    });
    assert.equal(
      fixture.queries.filter((query) => query.startsWith('ALTER TABLE')).length,
      0,
    );
  }
});