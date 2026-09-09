/**
 * Audit Logger — records every significant admin/staff action to audit_logs table.
 * Non-blocking: errors are logged to console but never thrown to callers.
 */
const db = require('../config/database');

/**
 * @param {object} options
 * @param {number}  options.userId      - ID of the user performing the action
 * @param {string}  options.userName    - Display name of the user
 * @param {string}  options.userRole    - Role (admin, super_admin, teacher, …)
 * @param {string}  options.action      - Short slug: 'manual_payment_add', 'invoice_delete', …
 * @param {string}  [options.entityType] - 'payment', 'invoice', 'student', 'payment_proof', …
 * @param {number}  [options.entityId]  - PK of the affected row
 * @param {object}  [options.details]   - Extra context (amounts, names, old vs new values, …)
 * @param {string}  [options.ipAddress] - Remote IP
 */
async function logAudit(options) {
  const {
    userId, userName, userRole, action, entityType, entityId, details, ipAddress,
    executor = db, required = false,
  } = options;
  try {
    await executor.query(
      `INSERT INTO audit_logs
         (user_id, user_name, user_role, action, entity_type, entity_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId   || null,
        userName || null,
        userRole || null,
        action,
        entityType || null,
        entityId   || null,
        details ? JSON.stringify(details) : null,
        ipAddress  || null
      ]
    );
  } catch (err) {
    if (required) throw err;
    // Audit logging must never crash the calling request
    console.error('⚠️  Audit log write failed (non-fatal):', err.message);
  }
}

/**
 * Express middleware helper — pull the caller's IP from the request.
 */
function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

module.exports = { logAudit, getIp };
