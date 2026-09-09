const crypto = require('node:crypto');
const db = require('../config/database');

const TOKEN_PURPOSES = Object.freeze({
  UPDATE_APPLICATION: 'UPDATE_APPLICATION',
  COMPLETE_REGISTRATION: 'COMPLETE_REGISTRATION',
});

const TOKEN_TTL_MS = Object.freeze({
  [TOKEN_PURPOSES.UPDATE_APPLICATION]: 14 * 24 * 60 * 60 * 1000,
  [TOKEN_PURPOSES.COMPLETE_REGISTRATION]: 30 * 24 * 60 * 60 * 1000,
});

const PORTAL_ACCESS = Object.freeze({
  EDIT: 'edit',
  READ_ONLY: 'read_only',
});

class PortalTokenError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortalTokenError';
    this.code = code;
  }
}

const generatePortalToken = () => crypto.randomBytes(32).toString('base64url');
const hashPortalToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const getPortalAccess = ({ purpose, enrollmentStatus, formStatus }) => {
  if (purpose === TOKEN_PURPOSES.UPDATE_APPLICATION) {
    return enrollmentStatus === 'MORE_INFORMATION_REQUIRED' ? PORTAL_ACCESS.EDIT : null;
  }
  if (purpose !== TOKEN_PURPOSES.COMPLETE_REGISTRATION) return null;
  if (enrollmentStatus === 'APPROVED' || enrollmentStatus === 'approved') return PORTAL_ACCESS.EDIT;
  if (enrollmentStatus !== 'REGISTRATION_PENDING') return null;
  return formStatus === 'SUBMITTED' ? PORTAL_ACCESS.READ_ONLY : PORTAL_ACCESS.EDIT;
};

const tokenSafeLog = (event, context = {}) => {
  const safeContext = {
    ...(Number.isSafeInteger(Number(context.enrollmentId))
      ? { enrollmentId: Number(context.enrollmentId) }
      : {}),
    ...(Object.values(TOKEN_PURPOSES).includes(context.purpose)
      ? { purpose: context.purpose }
      : {}),
    ...(context.outcome ? { outcome: String(context.outcome).slice(0, 40) } : {}),
  };
  console.info(`Admissions portal token: ${event}`, safeContext);
};

const requirePurpose = (purpose) => {
  if (!Object.values(TOKEN_PURPOSES).includes(purpose)) {
    throw new PortalTokenError('INVALID_TOKEN_PURPOSE');
  }
};

async function issuePortalToken({
  enrollmentId,
  purpose,
  issuedBy = null,
  database = db,
  now = new Date(),
}) {
  requirePurpose(purpose);
  const numericEnrollmentId = Number(enrollmentId);
  if (!Number.isSafeInteger(numericEnrollmentId) || numericEnrollmentId < 1) {
    throw new PortalTokenError('INVALID_ENROLLMENT');
  }

  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const enrollmentResult = await client.query(`
      SELECT e.status, rr.form_status
      FROM enrollments e
      LEFT JOIN registration_records rr ON rr.enrollment_id = e.id
      WHERE e.id = $1
      FOR UPDATE OF e
    `, [numericEnrollmentId]);
    if (!enrollmentResult.rows.length) throw new PortalTokenError('INVALID_ENROLLMENT');

    const enrollment = enrollmentResult.rows[0];
    const access = getPortalAccess({
      purpose,
      enrollmentStatus: enrollment.status,
      formStatus: enrollment.form_status,
    });
    if (!access || access === PORTAL_ACCESS.READ_ONLY) {
      throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
    }

    const rawToken = generatePortalToken();
    const tokenHash = hashPortalToken(rawToken);
    const issuedAt = new Date(now);
    const expiresAt = new Date(issuedAt.getTime() + TOKEN_TTL_MS[purpose]);

    const priorResult = await client.query(`
      SELECT id
      FROM admissions_portal_tokens
      WHERE enrollment_id = $1 AND purpose = $2 AND revoked_at IS NULL
      FOR UPDATE
    `, [numericEnrollmentId, purpose]);

    if (priorResult.rows.length) {
      await client.query(`
        UPDATE admissions_portal_tokens
        SET revoked_at = $1
        WHERE id = ANY($2::bigint[])
      `, [issuedAt, priorResult.rows.map(({ id }) => id)]);
    }

    const inserted = await client.query(`
      INSERT INTO admissions_portal_tokens
        (enrollment_id, purpose, token_hash, issued_by, issued_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, enrollment_id, purpose, issued_at, expires_at
    `, [numericEnrollmentId, purpose, tokenHash, issuedBy, issuedAt, expiresAt]);
    const tokenRecord = inserted.rows[0];

    if (priorResult.rows.length) {
      await client.query(`
        UPDATE admissions_portal_tokens
        SET replaced_by_token_id = $1
        WHERE id = ANY($2::bigint[])
      `, [tokenRecord.id, priorResult.rows.map(({ id }) => id)]);
    }
    await client.query('COMMIT');
    tokenSafeLog('issued', { enrollmentId: numericEnrollmentId, purpose, outcome: 'success' });
    return { token: rawToken, ...tokenRecord, access };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    tokenSafeLog('issue_failed', { enrollmentId: numericEnrollmentId, purpose, outcome: error.code || 'failed' });
    throw error;
  } finally {
    client.release();
  }
}

async function validatePortalToken(rawToken, { database = db, now = new Date() } = {}) {
  if (typeof rawToken !== 'string' || rawToken.length < 40 || rawToken.length > 128) return null;
  const tokenHash = hashPortalToken(rawToken);
  const result = await database.query(`
    SELECT
      t.id AS token_id, t.enrollment_id, t.purpose, t.issued_at, t.expires_at,
      e.status AS enrollment_status, rr.form_status
    FROM admissions_portal_tokens t
    JOIN enrollments e ON e.id = t.enrollment_id
    LEFT JOIN registration_records rr ON rr.enrollment_id = e.id
    WHERE t.token_hash = $1
      AND t.revoked_at IS NULL
      AND t.expires_at > $2
    LIMIT 1
  `, [tokenHash, now]);
  if (!result.rows.length) return null;
  const record = result.rows[0];
  const access = getPortalAccess({
    purpose: record.purpose,
    enrollmentStatus: record.enrollment_status,
    formStatus: record.form_status,
  });
  if (!access) return null;
  return { ...record, access };
}

async function recordPortalTokenUse(tokenId, { database = db, now = new Date() } = {}) {
  await database.query(`
    UPDATE admissions_portal_tokens
    SET first_used_at = COALESCE(first_used_at, $2),
        last_used_at = $2,
        use_count = use_count + 1
    WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2
  `, [tokenId, now]);
}

async function revokePortalTokens({
  enrollmentId,
  purpose,
  database = db,
  now = new Date(),
}) {
  requirePurpose(purpose);
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const enrollment = await client.query(
      'SELECT id FROM enrollments WHERE id = $1 FOR UPDATE',
      [enrollmentId],
    );
    if (!enrollment.rows.length) throw new PortalTokenError('INVALID_ENROLLMENT');
    const result = await client.query(`
      UPDATE admissions_portal_tokens
      SET revoked_at = $3
      WHERE enrollment_id = $1 AND purpose = $2 AND revoked_at IS NULL
      RETURNING id
    `, [enrollmentId, purpose, now]);
    await client.query('COMMIT');
    tokenSafeLog('revoked', {
      enrollmentId,
      purpose,
      outcome: result.rows.length ? 'success' : 'no_active_token',
    });
    return result.rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const reissuePortalToken = (options) => issuePortalToken(options);

async function withValidatedPortalToken(rawToken, {
  database = db,
  now = new Date(),
  requireEdit = true,
  action,
} = {}) {
  if (typeof action !== 'function') throw new TypeError('A portal token action is required');
  if (typeof rawToken !== 'string' || rawToken.length < 40 || rawToken.length > 128) {
    throw new PortalTokenError('INVALID_OR_EXPIRED_TOKEN');
  }
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT
        t.id AS token_id, t.enrollment_id, t.purpose, t.issued_at, t.expires_at,
        e.status AS enrollment_status, rr.form_status
      FROM admissions_portal_tokens t
      JOIN enrollments e ON e.id = t.enrollment_id
      LEFT JOIN registration_records rr ON rr.enrollment_id = e.id
      WHERE t.token_hash = $1
        AND t.revoked_at IS NULL
        AND t.expires_at > $2
      FOR UPDATE OF t, e
    `, [hashPortalToken(rawToken), now]);
    if (!result.rows.length) throw new PortalTokenError('INVALID_OR_EXPIRED_TOKEN');
    const record = result.rows[0];
    const access = getPortalAccess({
      purpose: record.purpose,
      enrollmentStatus: record.enrollment_status,
      formStatus: record.form_status,
    });
    if (!access || (requireEdit && access !== PORTAL_ACCESS.EDIT)) {
      throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
    }
    await client.query(`
      UPDATE admissions_portal_tokens
      SET first_used_at = COALESCE(first_used_at, $2),
          last_used_at = $2,
          use_count = use_count + 1
      WHERE id = $1
    `, [record.token_id, now]);
    const actionResult = await action(client, { ...record, access });
    await client.query('COMMIT');
    return actionResult;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PORTAL_ACCESS,
  TOKEN_PURPOSES,
  TOKEN_TTL_MS,
  PortalTokenError,
  generatePortalToken,
  getPortalAccess,
  hashPortalToken,
  issuePortalToken,
  recordPortalTokenUse,
  reissuePortalToken,
  revokePortalTokens,
  tokenSafeLog,
  validatePortalToken,
  withValidatedPortalToken,
};