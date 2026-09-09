const db = require('../config/database');

const TARGET_LENGTH = 40;

const readStatusColumn = async (client) => {
  const result = await client.query(`
    SELECT data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'enrollments'
      AND column_name = 'status'
  `);
  if (!result.rows.length) {
    throw new Error('public.enrollments.status was not found');
  }
  return result.rows[0];
};

const formatLength = (column) => (
  column.character_maximum_length === null
    ? `${column.data_type} (unbounded)`
    : `${column.data_type}(${Number(column.character_maximum_length)})`
);

async function fixEnrollmentStatusWidth({ database = db, logger = console } = {}) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");

    const before = await readStatusColumn(client);
    logger.log(`enrollments.status before: ${formatLength(before)}`);

    const currentLength = Number(before.character_maximum_length);
    if (before.data_type !== 'character varying' || !Number.isFinite(currentLength)) {
      throw new Error(`Unsupported enrollments.status type: ${formatLength(before)}`);
    }

    if (currentLength < TARGET_LENGTH) {
      await client.query('ALTER TABLE enrollments ALTER COLUMN status TYPE VARCHAR(40)');
      logger.log('enrollments.status widened to VARCHAR(40)');
    } else {
      logger.log('enrollments.status is already VARCHAR(40) or larger; no change required');
    }

    const after = await readStatusColumn(client);
    logger.log(`enrollments.status after: ${formatLength(after)}`);
    if (
      after.data_type !== 'character varying'
      || Number(after.character_maximum_length) < TARGET_LENGTH
    ) {
      throw new Error('enrollments.status width verification failed');
    }

    await client.query('COMMIT');
    return {
      beforeLength: currentLength,
      afterLength: Number(after.character_maximum_length),
      changed: currentLength < TARGET_LENGTH,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  fixEnrollmentStatusWidth()
    .catch((error) => {
      console.error(`Enrollment status width fix failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  TARGET_LENGTH,
  fixEnrollmentStatusWidth,
};