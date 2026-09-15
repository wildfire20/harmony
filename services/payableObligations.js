/*
 * Canonical payable-obligation read model.
 *
 * An obligation is a persisted invoice charge (or a safely identified legacy
 * invoice-level Tuition charge).  This module intentionally never consults
 * enrolment flags or current service pricing when deciding that money is due.
 * Parent payment choices, allocation targets and approval validation should all
 * use the identity returned here.
 */
const db = require('../config/database');
const { getCarryForwardSourceIds } = require('./carryForwardLineage');
const { resolveLegacyClassification } = require('./legacyClassification');

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const nonNegative = (value) => Math.max(0, money(value));
const isMissingFinanceSchema = (error) => error && (
  error.code === '42P01' || error.code === '42703'
);

const legacyTuitionDescription = (value) =>
  /\b(?:tuition|school\s+fees?)\b/i.test(String(value || ''));

const dateOnly = (value) => value == null ? null : String(value).slice(0, 10);
const billingPeriod = (value) => {
  const date = dateOnly(value);
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null;
};
const billingPeriodLabel = (value) => {
  const period = billingPeriod(value);
  if (!period) return null;
  const parsed = new Date(`${period}-01T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? period
    : parsed.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const calendarDateLabel = (value) => {
  const date = dateOnly(value);
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function lineCategory(line) {
  const metadata = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
  return metadata.category === 'one_off' || metadata.fee_id != null
    ? 'one_off'
    : String(line.service_key || 'other');
}

function lineLabel(line, category) {
  if (line?.label || line?.description) return line.label || line.description;
  return category === 'one_off' ? 'One-off fee' : (
    `${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, ' ')}`
  );
}

function pendingMatches(item, obligation) {
  if (!item || typeof item !== 'object') return false;
  const obligationId = String(item.obligation_id || '');
  const invoiceId = item.invoice_id == null ? null : Number(item.invoice_id);
  const lineId = item.invoice_line_item_id == null ? null : Number(item.invoice_line_item_id);
  const feeId = item.fee_id == null ? null : Number(item.fee_id);
  const assignmentId = item.assignment_id == null ? null : Number(item.assignment_id);
  const hasStableIdentity = Boolean(obligationId) || invoiceId != null ||
    lineId != null || feeId != null || assignmentId != null;
  if (!hasStableIdentity) return false;
  if (obligationId && obligationId !== String(obligation.obligation_id || '')) return false;
  if (invoiceId != null && invoiceId !== Number(obligation.invoice_id)) return false;
  if (lineId != null && lineId !== Number(obligation.invoice_line_item_id)) return false;
  if (feeId != null && feeId !== Number(obligation.one_off_fee_id)) return false;
  if (assignmentId != null && assignmentId !== Number(obligation.assignment_id)) return false;
  const category = String(item.category || item.service_key || '').replace(/^one_off:\d+$/, 'one_off');
  return !category || category === obligation.category;
}

function paymentState(outstanding, allocated, dueDate, pendingAmount, reconciliationRequired) {
  if (outstanding <= 0) return 'PAID';
  if (reconciliationRequired) return 'REQUIRES_RECONCILIATION';
  if (pendingAmount > 0) return 'PENDING_REVIEW';
  if (allocated > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

function dueState(outstanding, dueDate, asOf = new Date()) {
  if (outstanding <= 0 || !dueDate) return null;
  const today = dateOnly(asOf);
  return dateOnly(dueDate) < today ? 'OVERDUE' : 'DUE';
}

async function loadLines(executor, invoiceIds) {
  if (!invoiceIds.length) return { available: true, rows: [] };
  try {
    const result = await executor.query(`
      SELECT id, invoice_id, line_type, service_key, label, description,
             amount, is_included, metadata
      FROM invoice_line_items
      WHERE invoice_id = ANY($1::integer[])
      ORDER BY invoice_id, id
    `, [invoiceIds.map(Number)]);
    return { available: true, rows: result.rows };
  } catch (error) {
    if (isMissingFinanceSchema(error)) return { available: false, rows: [] };
    throw error;
  }
}

async function loadTransactions(executor, studentId) {
  try {
    const result = await executor.query(`
      SELECT pt.id, pt.invoice_id, pt.amount,
             to_jsonb(pt)->>'allocation_category' AS allocation_category,
             (pt.reverses_transaction_id IS NOT NULL) AS is_reversal,
             (reversal.id IS NOT NULL) AS is_reversed
      FROM payment_transactions pt
      LEFT JOIN payment_transactions reversal
        ON reversal.reverses_transaction_id = pt.id
      WHERE pt.student_id = $1
    `, [studentId]);
    return result.rows;
  } catch (error) {
    if (isMissingFinanceSchema(error)) return [];
    throw error;
  }
}

async function loadPending(executor, studentId, options = {}) {
  const excludedId = options.excludePaymentId ?? options.excludePendingPaymentId;
  const params = [studentId];
  let exclusion = '';
  if (excludedId != null && Number.isSafeInteger(Number(excludedId)) && Number(excludedId) > 0) {
    params.push(Number(excludedId));
    exclusion = ` AND id <> $${params.length}`;
  }
  try {
    const result = await executor.query(`
      SELECT id, selected_obligations
      FROM pending_payments
      WHERE student_id = $1 AND status = 'pending'${exclusion}
    `, params);
    return result.rows;
  } catch (error) {
    if (isMissingFinanceSchema(error)) return [];
    throw error;
  }
}

async function loadFees(executor, feeIds) {
  if (!feeIds.length) return new Map();
  try {
    const result = await executor.query(
      `SELECT id, name, description, due_date, is_active
       FROM student_one_off_fees WHERE id = ANY($1::integer[])`,
      [feeIds.map(Number)],
    );
    return new Map(result.rows.map((row) => [Number(row.id), row]));
  } catch (error) {
    if (isMissingFinanceSchema(error)) return new Map();
    throw error;
  }
}

/*
 * Return every persisted charge with a stable identity. Settled obligations
 * are retained for audit/history, but have visible=false and selectable=false;
 * callers rendering payment choices must filter to is_payable.
 */
async function getPayableObligations(studentId, executor = db, options = {}) {
  // Keep the executor-first convention used by the ledger while also
  // supporting getPayableObligations(studentId, { excludePaymentId }) for
  // callers that only need the canonical database connection.
  if (!executor || typeof executor.query !== 'function') {
    options = executor || options || {};
    executor = db;
  }
  const asOf = options.asOf || new Date();
  const invoiceResult = await executor.query(`
    SELECT i.id, i.student_id, i.amount_due, i.amount_paid, i.due_date,
           i.status, i.description, i.reference_number
    FROM invoices i
    WHERE i.student_id = $1
    ORDER BY i.due_date ASC NULLS LAST, i.id ASC
  `, [studentId]);
  if (!invoiceResult.rows.length) return [];

  const invoiceIds = invoiceResult.rows.map((row) => Number(row.id));
  const carryForwardSourceIds = await getCarryForwardSourceIds(executor, invoiceResult.rows);
  // A transaction-bound pg Client may execute only one query at a time. Keep
  // these reads sequential so classification/proof transactions do not rely on
  // deprecated concurrent client.query behaviour.
  const lineResult = await loadLines(executor, invoiceIds);
  const transactions = await loadTransactions(executor, studentId);
  const pendingRows = await loadPending(executor, studentId, options);
  const linesByInvoice = new Map();
  lineResult.rows.forEach((line) => {
    const id = Number(line.invoice_id);
    if (!linesByInvoice.has(id)) linesByInvoice.set(id, []);
    linesByInvoice.get(id).push(line);
  });

  const feeIds = lineResult.rows
    .map((line) => line.metadata?.fee_id)
    .filter((id) => id != null)
    .map(Number);
  const feeById = await loadFees(executor, [...new Set(feeIds)]);
  const obligations = [];

  invoiceResult.rows.forEach((invoice) => {
    const invoiceId = Number(invoice.id);
    // Carried-forward sources are historical evidence only. Never rebuild
    // them as a fresh payable obligation, even if a legacy anomaly leaves
    // their status or lineage column inconsistent.
    if (carryForwardSourceIds.has(invoiceId)) return;
    const amountDue = money(invoice.amount_due);
    const amountPaid = money(invoice.amount_paid);
    const invoiceLines = resolveLegacyClassification(linesByInvoice.get(invoiceId) || []).lines;
    const charges = invoiceLines.filter((line) =>
      String(line.line_type || 'charge').toLowerCase() === 'charge' &&
      !Boolean(line.is_included) && money(line.amount) > 0);
    const discounts = invoiceLines.filter((line) =>
      String(line.line_type || '').toLowerCase() === 'discount' && money(line.amount) > 0);
    const invoiceTransactions = transactions.filter((tx) =>
      Number(tx.invoice_id) === invoiceId && !tx.is_reversed && !tx.is_reversal && money(tx.amount) > 0);

    if (!charges.length) {
      const outstanding = nonNegative(amountDue - amountPaid);
      if (outstanding <= 0) {
        obligations.push(makeObligation({
          invoice, category: 'tuition', invoiceLineItemId: null,
          gross: amountDue, discount: 0, allocated: amountPaid,
          outstanding: 0, reconciliationRequired: false, line: null,
          pendingRows, asOf,
        }));
        return;
      }
      const safeTuition = legacyTuitionDescription(invoice.description);
      obligations.push(makeObligation({
        invoice, category: 'tuition', invoiceLineItemId: null,
        gross: amountDue, discount: 0, allocated: amountPaid,
        outstanding, reconciliationRequired: !safeTuition,
        line: safeTuition ? {
          label: 'Legacy Tuition',
          description: invoice.description || 'Legacy school fees',
          metadata: { legacy_invoice_level: true },
        } : null,
        pendingRows, asOf,
      }));
      return;
    }

    const categories = new Map();
    charges.forEach((line) => {
      const category = lineCategory(line);
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(line);
    });
    const grossByCategory = new Map([...categories].map(([category, rows]) => [
      category, money(rows.reduce((sum, row) => sum + money(row.amount), 0)),
    ]));
    const discountsByCategory = new Map();
    let generalDiscount = 0;
    discounts.forEach((discount) => {
      if (discount.service_key) {
        const category = String(discount.service_key);
        discountsByCategory.set(category, money(
          (discountsByCategory.get(category) || 0) + money(discount.amount),
        ));
      } else {
        generalDiscount = money(generalDiscount + money(discount.amount));
      }
    });
    const totalGross = money([...grossByCategory.values()].reduce((sum, value) => sum + value, 0));
    const netByCategory = new Map();
    grossByCategory.forEach((gross, category) => {
      const share = totalGross > 0 ? money(generalDiscount * gross / totalGross) : 0;
      netByCategory.set(category, nonNegative(
        gross - Math.min(gross, money((discountsByCategory.get(category) || 0) + share)),
      ));
    });
    const hasMultipleCategories = categories.size > 1;
    const hasCategorisedPayments = invoiceTransactions.some((tx) => tx.allocation_category);

    categories.forEach((rows, category) => {
      const net = netByCategory.get(category) || 0;
      const categoryPayments = invoiceTransactions
        .filter((tx) => String(tx.allocation_category || '') === category)
        .reduce((sum, tx) => sum + money(tx.amount), 0);
      const allocated = hasMultipleCategories
        ? (hasCategorisedPayments ? categoryPayments : 0)
        : amountPaid;
      const reconciliationRequired = hasMultipleCategories && amountPaid > 0 && !hasCategorisedPayments;
      const outstanding = nonNegative(net - allocated);
      const primaryLine = rows[0];
      const lineGross = money(rows.reduce((sum, row) => sum + money(row.amount), 0));
      const lineDiscount = nonNegative(lineGross - net);
      obligations.push(makeObligation({
        invoice, category, invoiceLineItemId: primaryLine.id,
        gross: lineGross, discount: lineDiscount, allocated, outstanding,
        reconciliationRequired, line: primaryLine, pendingRows, asOf,
      }));
    });
  });

  // The fee definition is presentation metadata only. Its active/archive
  // state never determines whether the persisted invoice obligation exists.
  obligations.forEach((obligation) => {
    const fee = obligation.one_off_fee_id == null
      ? null : feeById.get(Number(obligation.one_off_fee_id));
    if (!fee) return;
    if (!obligation.description && fee.description) obligation.description = fee.description;
    if (!obligation.label || obligation.label === 'One-off fee') obligation.label = fee.name;
  });

  return obligations.sort((left, right) =>
    String(left.due_date || '').localeCompare(String(right.due_date || '')) ||
    Number(left.invoice_id) - Number(right.invoice_id) ||
    String(left.obligation_id).localeCompare(String(right.obligation_id)));
}

function makeObligation({
  invoice, category, invoiceLineItemId, gross, discount, allocated,
  outstanding, reconciliationRequired, line, pendingRows, asOf,
}) {
  const metadata = line?.metadata && typeof line.metadata === 'object' ? line.metadata : {};
  const isLegacyReconciled = metadata.source === 'legacy_invoice_reconciliation' ||
    metadata.legacy_reconciliation === true || metadata.legacy_reconciliation === 'true';
  const oneOffFeeId = metadata.fee_id == null ? null : Number(metadata.fee_id);
  const assignmentId = metadata.assignment_id == null ? null : Number(metadata.assignment_id);
  const identity = `invoice:${Number(invoice.id)}:${invoiceLineItemId == null
    ? 'legacy' : `line:${Number(invoiceLineItemId)}`}`;
  const pendingAmount = pendingRows.reduce((sum, row) => {
    let selected = row.selected_obligations;
    if (typeof selected === 'string') {
      try { selected = JSON.parse(selected); } catch (_) { selected = []; }
    }
    selected = Array.isArray(selected) ? selected : [];
    return sum + selected.filter((item) => pendingMatches(item, {
      invoice_id: invoice.id,
      invoice_line_item_id: invoiceLineItemId,
      one_off_fee_id: oneOffFeeId,
      assignment_id: assignmentId,
      obligation_id: identity,
      category,
    })).reduce((inner, item) => inner + money(item.amount), 0);
  }, 0);
  const state = paymentState(outstanding, allocated, invoice.due_date, pendingAmount, reconciliationRequired);
  const label = lineLabel(line, category);
  const selectable = outstanding > 0 && state !== 'PAID' &&
    state !== 'PENDING_REVIEW' && state !== 'REQUIRES_RECONCILIATION';
  return {
    obligation_id: identity,
    obligation_type: invoiceLineItemId == null ? 'legacy_invoice' : (
      category === 'one_off' ? 'one_off' : 'recurring'
    ),
    category,
    service_key: category === 'one_off' ? (line?.service_key || 'one_off_fee') : category,
    invoice_id: Number(invoice.id),
    invoice_line_item_id: invoiceLineItemId == null ? null : Number(invoiceLineItemId),
    one_off_fee_id: oneOffFeeId,
    fee_id: oneOffFeeId,
    assignment_id: assignmentId,
    billing_period: billingPeriod(invoice.due_date),
    billing_period_label: billingPeriodLabel(invoice.due_date),
    description: line?.description || invoice.description || null,
    label,
    due_date: dateOnly(invoice.due_date),
    due_date_label: calendarDateLabel(invoice.due_date),
    reference_number: invoice.reference_number || null,
    gross_amount: money(gross),
    discount: money(discount),
    net_due: money(gross - discount),
    amount_allocated: money(allocated),
    amount_outstanding: money(outstanding),
    pending_amount: money(pendingAmount),
    status: state,
    reconciliation_state: reconciliationRequired ? 'REQUIRES_RECONCILIATION' : null,
    reconciliation_reason: reconciliationRequired
      ? 'This invoice has persisted charges but historical payment allocation is not identified by service.'
      : null,
    legacy_reconciliation: isLegacyReconciled ? {
      state: 'RECONCILED',
      source: metadata.source || 'legacy_invoice_reconciliation',
      category: metadata.category || category,
      actor_id: metadata.actor_id == null ? null : Number(metadata.actor_id),
      actor_name: metadata.actor_name || null,
      classified_at: metadata.classified_at || null,
      reason: metadata.reason || null,
    } : null,
    due_status: dueState(outstanding, invoice.due_date, asOf),
    visible: state !== 'PAID',
    selectable,
    is_payable: selectable,
    // Compatibility names used by the existing Parent/Admin clients.
    amount: money(outstanding),
    outstanding: money(outstanding),
    payment_status: state,
  };
}

module.exports = {
  getPayableObligations,
  loadPending,
  legacyTuitionDescription,
  pendingMatches,
};