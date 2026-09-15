/*
 * Shared advisory-lock identity for invoice obligations.
 *
 * Both legacy classification and parent pending-proof reservation use these
 * exact keys. The invoice-level key prevents two different representations of
 * the same invoice obligation from racing; detailed keys keep unrelated
 * invoices independent. Callers must acquire the returned keys in order.
 */
const INVOICE_OBLIGATION_LOCK_NAMESPACE = 'harmony:invoice-obligation:v1';

const normaliseCategory = (value) => String(value || '')
  .trim().toLowerCase().replace(/^one_off:\d+$/, 'one_off') || 'unknown';

function invoiceObligationLockKeys({ invoiceId, studentId, lineId = 'legacy', category, feeId = '' }) {
  const id = Number(invoiceId);
  const identity = Number.isSafeInteger(id) && id > 0
    ? `invoice:${id}`
    : `student:${Number(studentId) || 0}:category:${normaliseCategory(category)}:fee:${feeId == null ? '' : Number(feeId)}`;
  const prefix = `${INVOICE_OBLIGATION_LOCK_NAMESPACE}:${identity}`;
  const lineIdentity = lineId == null || lineId === 'legacy' ? 'legacy' : Number(lineId);
  const detail = `${prefix}:line:${lineIdentity}:category:${normaliseCategory(category)}:fee:${feeId == null ? '' : Number(feeId)}`;
  return [...new Set([prefix, detail])].sort();
}

async function acquireInvoiceObligationLocks(executor, descriptors = []) {
  const keys = [...new Set(descriptors.flatMap((descriptor) =>
    invoiceObligationLockKeys(descriptor)))].sort();
  for (const key of keys) {
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [INVOICE_OBLIGATION_LOCK_NAMESPACE, key],
    );
  }
  return keys;
}

module.exports = {
  INVOICE_OBLIGATION_LOCK_NAMESPACE,
  invoiceObligationLockKeys,
  acquireInvoiceObligationLocks,
  normaliseCategory,
};