/*
 * Preview-only service enrollment bootstrap.
 *
 * This is intentionally an operator proposal, not a migration or a write
 * command.  It uses the explicitly supplied read-only database and date,
 * reports rows that could be reviewed, and always rolls back its transaction.
 */
require('dotenv').config();

const {
  createFinanceReadonlyPool,
  beginVerifiedReadonlySession,
} = require('./finance-readonly-database');

function parseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(text)) {
    throw new Error('An explicit effective date is required: YYYY-MM-DD');
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('The effective date must be a valid ISO calendar date: YYYY-MM-DD');
  }
  return text;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const pool = createFinanceReadonlyPool(env);
  const effectiveStart = parseDate(argv[0]);
  const client = await pool.connect();
  try {
    const session = await beginVerifiedReadonlySession(client, () => {});
    const students = await client.query(`
      SELECT u.id AS student_id, u.student_number,
             u.first_name, u.last_name,
             COALESCE(u.is_boarder, false) AS is_boarder,
             COALESCE(u.uses_transport, false) AS uses_transport,
             COALESCE(u.uses_aftercare, false) AS uses_aftercare
      FROM users u
      WHERE u.role = 'student' AND u.is_active = true
      ORDER BY u.id
    `);

    let existing = { rows: [] };
    await client.query('SAVEPOINT service_bootstrap_existing');
    try {
      existing = await client.query(`
        SELECT student_id, service_key
        FROM service_enrollments
        WHERE state <> 'cancelled'
          AND effective_start <= $1::date
          AND (effective_end IS NULL OR effective_end >= $1::date)
      `, [effectiveStart]);
    } catch (error) {
      if (error.code === '42P01' || error.code === '42703') {
        await client.query('ROLLBACK TO SAVEPOINT service_bootstrap_existing');
      } else throw error;
    }
    await client.query('RELEASE SAVEPOINT service_bootstrap_existing');
    const existingKeys = new Set(existing.rows.map((row) =>
      `${Number(row.student_id)}:${String(row.service_key).toLowerCase()}`));
    const proposals = [];
    for (const student of students.rows) {
      const serviceKeys = [
        'tuition',
        ...(student.is_boarder ? ['boarding'] : []),
        ...(student.uses_transport ? ['transport'] : []),
        ...(student.uses_aftercare ? ['aftercare'] : []),
      ];
      serviceKeys.forEach((serviceKey) => {
        const alreadyEffective = existingKeys.has(`${Number(student.student_id)}:${serviceKey}`);
        proposals.push({
          student_id: Number(student.student_id),
          student_number: student.student_number,
          student_name: `${student.first_name} ${student.last_name}`.trim(),
          service_key: serviceKey,
          effective_start: effectiveStart,
          source: serviceKey === 'tuition' ? 'active_student' : `legacy_${serviceKey}_indicator`,
          status: alreadyEffective ? 'already_effective' : 'proposal',
          review_required: !alreadyEffective,
        });
      });
    }

    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      preview: true,
      readOnly: true,
      transaction_read_only: session.transactionReadOnly,
      effective_start: effectiveStart,
      proposals,
      summary: {
        active_learners: students.rows.length,
        proposal_rows: proposals.length,
        already_effective: proposals.filter((row) => row.status === 'already_effective').length,
        new_proposals: proposals.filter((row) => row.status === 'proposal').length,
        by_service: proposals.reduce((result, row) => {
          result[row.service_key] = (result[row.service_key] || 0) + 1;
          return result;
        }, {}),
      },
    }, null, 2));
    return { proposals };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (typeof pool.end === 'function') await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Finance service bootstrap preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseDate };