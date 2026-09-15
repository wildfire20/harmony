/*
 * Authoritative finance read model.
 *
 * invoices.amount_due/amount_paid are the maintained ledger balances.  A
 * payment_transactions row is an immutable allocation/event (invoice_id is
 * null for an unallocated payment).  Consumers must not independently add
 * payment_transactions to invoice.amount_paid: allocation rows are already
 * reflected in the invoice balance and doing so was the source of the
 * Admin/Parent discrepancy.
 */
const db = require('../config/database');
const { getCarryForwardSourceIds } = require('./carryForwardLineage');
const {
  isClassificationCorrection, resolveLegacyClassification,
} = require('./legacyClassification');
const { appendPeriodFilters, parseInvoiceFilterQuery } = require('../utils/invoiceQuery');

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const nonNegative = (value) => Math.max(0, money(value));
const INVOICE_STATUSES = ['Unpaid', 'Partial', 'Paid', 'Overpaid', 'Carried Forward'];

function dateOnlyParts(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function invoiceStatus(amountDue, amountPaid, originalStatus) {
  if (originalStatus === 'Carried Forward') return originalStatus;
  const due = money(amountDue);
  const paid = money(amountPaid);
  if (paid > due) return 'Overpaid';
  if (due > 0 && paid >= due) return 'Paid';
  if (paid > 0) return 'Partial';
  return due === 0 ? 'Paid' : 'Unpaid';
}

function isMissingOptionalFinanceSchema(error) {
  return error && (
    error.code === '42P01' ||
    error.code === '42703' ||
    (!error.code && /^Unexpected .*query:/.test(error.message || ''))
  );
}

function lineAmount(row) {
  return money(row.amount ?? row.line_amount ?? row.total_amount ?? row.unit_amount);
}

function normaliseInvoiceLines(rows) {
  const resolved = resolveLegacyClassification(rows).lines;
  return resolved.map((row) => {
    const type = String(row.line_type || row.type || 'charge').toLowerCase();
    const correction = isClassificationCorrection(row);
    const amount = lineAmount(row);
    return {
      id: row.id,
      line_type: correction
        ? 'classification_correction'
        : type === 'discount' || type === 'adjustment'
        ? 'discount'
        : 'charge',
      service_key: row.service_key || null,
      bundle_key: row.bundle_key || null,
      label: row.label || row.description || row.service_key || 'Charge',
      description: row.description || null,
      quantity: Number(row.quantity || 1),
      unit_amount: money(row.unit_amount ?? amount),
      amount,
      included: Boolean(row.is_included || row.included),
      discount_assignment_id: row.discount_assignment_id || null,
      metadata: row.metadata || null,
    };
  });
}

function invoiceStatusExpression(alias = 'i') {
  return `(CASE
    WHEN ${alias}.status = 'Carried Forward' THEN 'Carried Forward'
    WHEN COALESCE(${alias}.amount_paid, 0) > COALESCE(${alias}.amount_due, 0) THEN 'Overpaid'
    WHEN COALESCE(${alias}.amount_due, 0) = 0 THEN 'Paid'
    WHEN COALESCE(${alias}.amount_paid, 0) >= COALESCE(${alias}.amount_due, 0) THEN 'Paid'
    WHEN COALESCE(${alias}.amount_paid, 0) > 0 THEN 'Partial'
    ELSE 'Unpaid'
  END)`;
}

async function loadInvoiceLineItems(executor, invoiceIds) {
  if (!invoiceIds.length) return { available: true, rows: [] };
  try {
    const result = await executor.query(`
      SELECT id, invoice_id, line_type, service_key, bundle_key, label,
             description, quantity, unit_amount, amount, is_included,
             discount_assignment_id, metadata
      FROM invoice_line_items
      WHERE invoice_id = ANY($1::integer[])
      ORDER BY invoice_id, id
    `, [invoiceIds.map((id) => Number(id))]);
    return { available: true, rows: result.rows };
  } catch (error) {
    if (!isMissingOptionalFinanceSchema(error)) throw error;
    return { available: false, rows: [] };
  }
}

function buildInvoiceBreakdown(invoice, rawLines = [], reviewFlags = []) {
  const lines = normaliseInvoiceLines(rawLines);
  const charges = lines.filter((line) => line.line_type === 'charge' && !isClassificationCorrection(line));
  const discounts = lines.filter((line) => line.line_type === 'discount');
  const amountDue = money(invoice.amount_due);
  const amountPaid = money(invoice.amount_paid);
  const chargeTotals = {};
  charges.forEach((line) => {
    const key = line.service_key || 'other';
    chargeTotals[key] = money((chargeTotals[key] || 0) + line.amount);
  });
  const oneOffLines = charges.filter((line) => (
    line.metadata && (line.metadata.fee_id != null || line.metadata.category === 'one_off')
  ));
  const legacyLine = charges.find((line) => {
    const metadata = line.metadata || {};
    return metadata.source === 'legacy_invoice_reconciliation' ||
      metadata.legacy_reconciliation === true ||
      metadata.legacy_reconciliation === 'true';
  });
  const legacyMetadata = legacyLine?.metadata || {};
  return {
    ...invoice,
    status: invoiceStatus(amountDue, amountPaid, invoice.status),
    amount_due: amountDue,
    amount_paid: amountPaid,
    gross_charges: lines.length ? money(charges.reduce((sum, line) => sum + line.amount, 0)) : amountDue,
    discount_lines: discounts,
    discount_total: money(discounts.reduce((sum, line) => sum + line.amount, 0)),
    net_due: amountDue,
    allocated_effective_payments: amountPaid,
    outstanding_balance: nonNegative(amountDue - amountPaid),
    overpaid_amount: nonNegative(amountPaid - amountDue),
    credit: nonNegative(amountPaid - amountDue),
    line_items: lines,
    charge_totals: chargeTotals,
    service_charge_lines: charges.filter((line) => !oneOffLines.includes(line)),
    one_off_charge_lines: oneOffLines,
    one_off_fee_ids: [...new Set(oneOffLines
      .map((line) => line.metadata?.fee_id)
      .filter((id) => id != null)
      .map((id) => Number(id)))],
    legacy_reconciliation: legacyLine ? {
      state: 'RECONCILED',
      category: legacyMetadata.category || legacyLine.service_key,
      service_key: legacyMetadata.service_key || legacyLine.service_key,
      actor_id: legacyMetadata.actor_id == null ? null : Number(legacyMetadata.actor_id),
      actor_name: legacyMetadata.actor_name || null,
      classified_at: legacyMetadata.classified_at || null,
      reason: legacyMetadata.reason || null,
      previous_classification: legacyMetadata.previous_classification ?? null,
    } : null,
    snapshot_available: lines.some((line) => !isClassificationCorrection(line)),
    payment_review_flags: reviewFlags,
    review_required: reviewFlags.length > 0,
  };
}

/*
 * An allocation category is part of the invoice snapshot, never inferred from
 * the learner's current enrollment flags. This is deliberately exported for
 * payment-review and reconciliation callers so a selected one-off/service
 * obligation cannot drift into another category.
 */
function invoiceAllocationCategories(rawLines = []) {
  const lines = normaliseInvoiceLines(rawLines);
  const categories = new Set();
  lines.filter((line) => line.line_type === 'charge' && !line.included && line.amount > 0)
    .forEach((line) => {
      const category = line.metadata?.category === 'one_off' || line.metadata?.fee_id != null
        ? 'one_off'
        : line.service_key || 'other';
      categories.add(category);
    });
  return [...categories];
}

function invoiceCategoryBalances(rawLines = [], amountDue = 0, transactions = []) {
  const lines = normaliseInvoiceLines(rawLines);
  const balances = new Map();
  lines.filter((line) => line.line_type === 'charge' && !line.included && line.amount > 0)
    .forEach((line) => {
      const category = line.metadata?.category === 'one_off' || line.metadata?.fee_id != null
        ? 'one_off' : line.service_key || 'other';
      balances.set(category, money((balances.get(category) || 0) + line.amount));
    });
  const discounts = lines.filter((line) => line.line_type === 'discount' && line.amount > 0);
  discounts.filter((line) => line.service_key).forEach((line) => {
    balances.set(line.service_key, nonNegative((balances.get(line.service_key) || 0) - line.amount));
  });
  discounts.filter((line) => !line.service_key).forEach((line) => {
    const total = money([...balances.values()].reduce((sum, value) => sum + value, 0));
    let applied = 0;
    const entries = [...balances.entries()];
    entries.forEach(([category, value], index) => {
      const share = index === entries.length - 1 ? money(line.amount - applied)
        : money(line.amount * value / total);
      applied = money(applied + share);
      balances.set(category, nonNegative(value - share));
    });
  });
  const netTotal = money([...balances.values()].reduce((sum, value) => sum + value, 0));
  const difference = money(Number(amountDue) - netTotal);
  if (difference && balances.size) {
    const first = balances.keys().next().value;
    balances.set(first, nonNegative((balances.get(first) || 0) + difference));
  }
  transactions
    .filter((tx) => tx.allocation_category && !tx.is_reversed && Number(tx.amount) > 0)
    .forEach((tx) => balances.set(
      tx.allocation_category,
      nonNegative((balances.get(tx.allocation_category) || 0) - Number(tx.amount)),
    ));
  return [...balances.entries()].map(([category, amount]) => ({ category, amount }));
}

function enrolledServiceKeys(student, enrollmentRows) {
  if (!Array.isArray(enrollmentRows)) {
    // This is intentionally the legacy display-only path.  New billing
    // callers pass an enrollment array (including []) and therefore cannot
    // accidentally derive a charge from a current Boolean flag.
    return new Set([
      'tuition',
      ...(student.is_boarder ? ['boarding'] : []),
      ...(student.uses_transport ? ['transport'] : []),
      ...(student.uses_aftercare ? ['aftercare'] : []),
    ]);
  }
  return new Set(enrollmentRows
    // Ended rows remain authoritative for months through effective_end.
    // Only explicitly cancelled rows are excluded from historical billing.
    .filter((row) => row && row.state !== 'cancelled')
    .map((row) => String(row.service_key || '').toLowerCase())
    .filter((key) => ['tuition', 'boarding', 'transport', 'aftercare'].includes(key)));
}

function configuredComponents(student, prices, enrollmentRows) {
  const byKey = new Map(prices.map((price) => [price.service_key, price]));
  const enrolled = enrolledServiceKeys(student, enrollmentRows);
  const enabled = ['tuition', 'boarding', 'transport', 'aftercare']
    .map((key) => [key, enrolled.has(key)]);
  let subtotal = 0;
  const components = enabled
    .filter(([key, isEnabled]) => isEnabled && byKey.has(key))
    .map(([key]) => {
      const price = byKey.get(key);
      const amount = money(price.amount);
      subtotal += amount;
      return {
        key,
        label: price.label,
        description: price.description || null,
        amount,
        source: 'service_prices',
        enrolled: true,
      };
    });

  // Legacy flags are retained on the student read model for compatibility
  // display only. They never change a financial amount; new discounts require
  // an explicit approved learner_discount_assignments row.
  const discount = 0;
  const discountLabel = null;
  return {
    components,
    subtotal: money(subtotal),
    discount: money(discount),
    discountLabel,
    configuredTotal: subtotal,
  };
}

/*
 * New invoice generation uses this explicit billing configuration. Enrollment
 * flags select services; they never select discounts. A configured bundle is
 * represented by one charge and its included services are informational zero
 * lines, preventing tuition/aftercare from being charged twice while leaving
 * standalone transport billable.
 */
function configuredBillableLines(student, prices, enrollmentRows) {
  const enabled = new Map([...enrolledServiceKeys(student, enrollmentRows)]
    .map((key) => [key, true]));
  const includedByBundle = new Set();
  const lines = [];
  const eligiblePrices = prices.filter((price) =>
    enabled.get(price.service_key) && price.billing_mode !== 'informational');
  const bundleIncludedKeys = new Set(
    eligiblePrices.flatMap((price) => Array.isArray(price.included_service_keys)
      ? price.included_service_keys : []),
  );
  // Bundle owners are evaluated first regardless of display order. This
  // prevents a tuition row appearing before a boarding package from being
  // charged twice.
  eligiblePrices.sort((left, right) =>
    Number(Array.isArray(right.included_service_keys) && right.included_service_keys.length > 0) -
    Number(Array.isArray(left.included_service_keys) && left.included_service_keys.length > 0));
  for (const price of eligiblePrices) {
    if (bundleIncludedKeys.has(price.service_key) &&
        !(Array.isArray(price.included_service_keys) && price.included_service_keys.length > 0)) continue;
    const included = Array.isArray(price.included_service_keys)
      ? price.included_service_keys : [];
    if (includedByBundle.has(price.service_key)) continue;
    if (price.billing_mode === 'bundle_component' && price.bundle_key &&
        lines.some((line) => line.bundle_key === price.bundle_key)) continue;
    const amount = money(price.amount);
    lines.push({
      line_type: 'charge',
      service_key: price.service_key,
      bundle_key: price.bundle_key || null,
      label: price.label,
      description: price.description || null,
      quantity: 1,
      unit_amount: amount,
      amount,
      is_included: false,
      metadata: { billing_mode: price.billing_mode || 'standalone' },
    });
    if (price.bundle_key) includedByBundle.add(price.service_key);
    included.forEach((serviceKey) => {
      includedByBundle.add(serviceKey);
      const includedPrice = eligiblePrices.find((candidate) => candidate.service_key === serviceKey);
      if (includedPrice) {
        lines.push({
          line_type: 'charge',
          service_key: serviceKey,
          bundle_key: price.bundle_key,
          label: includedPrice.label,
          description: includedPrice.description || null,
          quantity: 1,
          unit_amount: 0,
          amount: 0,
          is_included: true,
          metadata: {
            billing_mode: 'bundle_component',
            included_in: price.service_key,
          },
        });
      }
    });
  }
  return lines;
}

function calculateApprovedDiscounts(assignments, chargeLines) {
  const discounts = [];
  const discountedByService = new Map();
  const billableCharges = (Array.isArray(chargeLines) ? chargeLines : [])
    .filter((line) => !line.is_included && Number(line.amount) > 0);
  const chargeGross = money(billableCharges.reduce((sum, line) => sum + line.amount, 0));
  let discountedTotal = 0;
  const seenAssignmentIds = new Set();
  const approvedAssignments = (Array.isArray(assignments) ? assignments : [])
    // Assignment ids are the identity of an approved discount.  A repeated
    // row can otherwise create a second discount line during retries or joins.
    // Rows without an id are not persisted approved assignments and are
    // deliberately ignored rather than treating a legacy flag as approval.
    .filter((assignment) => {
      if (!assignment || assignment.id == null) return false;
      const id = String(assignment.id);
      if (seenAssignmentIds.has(id)) return false;
      seenAssignmentIds.add(id);
      return true;
    });
  for (const assignment of approvedAssignments) {
    const targets = assignment.applicable_service_key
      ? billableCharges.filter((line) => line.service_key === assignment.applicable_service_key)
      : billableCharges;
    const targetGross = money(targets.reduce((sum, line) => sum + line.amount, 0));
    const targetServices = new Set(targets.map((line) => line.service_key));
    const targetDiscounted = money([...targetServices].reduce((sum, serviceKey) =>
      sum + (discountedByService.get(serviceKey) || 0), 0));
    const remainingInvoice = money(chargeGross - discountedTotal);
    const remainingTarget = money(targetGross - targetDiscounted);
    // Both caps apply to every assignment.  Scoped discounts used to skip the
    // invoice cap, while general discounts could leave a service overdrawn
    // after their proportional distribution.
    const available = Math.min(remainingInvoice, remainingTarget);
    if (available <= 0) continue;
    const requested = assignment.calculation_method === 'percentage'
      // Each assignment is calculated against its target gross amount; the
      // remaining target/invoice cap prevents cumulative discounts exceeding
      // the charge.
      ? money(targetGross * Number(assignment.percentage || 0) / 100)
      : money(assignment.amount);
    const amount = Math.min(available, requested);
    if (amount <= 0) continue;
    discounts.push({
      line_type: 'discount',
      service_key: assignment.applicable_service_key || null,
      label: {
        staff: 'Staff discount',
        sibling: 'Sibling discount',
        custom: 'Custom approved discount',
      }[assignment.discount_type] || 'Approved discount',
      description: assignment.reason,
      quantity: 1,
      unit_amount: amount,
      amount,
      is_included: false,
      discount_assignment_id: assignment.id,
      metadata: {
        discount_type: assignment.discount_type,
        calculation_method: assignment.calculation_method,
      },
    });
    if (assignment.applicable_service_key) {
      discountedByService.set(
        assignment.applicable_service_key,
        money((discountedByService.get(assignment.applicable_service_key) || 0) + amount),
      );
    } else if (targetGross > 0) {
      // Track a general discount against service capacity. Start with the
      // historical proportional split, cap each service, then redistribute
      // any overflow in deterministic charge-line order. This preserves the
      // existing ordering semantics while guaranteeing service-level caps.
      const targetByService = new Map();
      targets.forEach((line) => {
        targetByService.set(line.service_key, money(
          (targetByService.get(line.service_key) || 0) + line.amount,
        ));
      });
      const serviceOrder = [...targetByService.keys()];
      const allocations = new Map();
      let allocated = 0;
      serviceOrder.forEach((serviceKey, index) => {
        const gross = targetByService.get(serviceKey) || 0;
        const rawShare = index === serviceOrder.length - 1
          ? money(amount - allocated)
          : money(amount * gross / targetGross);
        const capacity = money(gross - (discountedByService.get(serviceKey) || 0));
        const share = Math.min(capacity, Math.max(0, rawShare));
        allocations.set(serviceKey, share);
        allocated = money(allocated + share);
      });
      let remainder = money(amount - allocated);
      for (const serviceKey of serviceOrder) {
        if (remainder <= 0) break;
        const gross = targetByService.get(serviceKey) || 0;
        const capacity = money(gross - (discountedByService.get(serviceKey) || 0) -
          (allocations.get(serviceKey) || 0));
        const extra = Math.min(capacity, remainder);
        allocations.set(serviceKey, money((allocations.get(serviceKey) || 0) + extra));
        remainder = money(remainder - extra);
      }
      allocations.forEach((share, serviceKey) => {
        discountedByService.set(serviceKey, money(
          (discountedByService.get(serviceKey) || 0) + share,
        ));
      });
    }
    discountedTotal = money(discountedTotal + amount);
  }
  return discounts;
}

function buildInvoiceSnapshotLines(student, prices, assignments = [], enrollmentRows) {
  const charges = configuredBillableLines(student, prices, enrollmentRows);
  return [...charges, ...calculateApprovedDiscounts(assignments, charges)];
}

// Kept separate so tests and future write paths can use the exact same
// calculation without opening another database connection.
async function getStudentLedger(studentId, executor = db) {
  const studentResult = await executor.query(`
    SELECT u.id, u.student_number, u.first_name, u.last_name, u.created_at,
           COALESCE(u.is_boarder, false) AS is_boarder,
           COALESCE(u.uses_transport, false) AS uses_transport,
           COALESCE(u.uses_aftercare, false) AS uses_aftercare,
           COALESCE(u.has_sibling_discount, false) AS has_sibling_discount,
           COALESCE(u.has_teacher_discount, false) AS has_teacher_discount
    FROM users u
    WHERE u.id = $1 AND u.role = 'student'
  `, [studentId]);
  if (!studentResult.rows.length) return null;
  const student = studentResult.rows[0];

  const [invoiceResult, transactionResult, priceResult] = await Promise.all([
    executor.query(`
      SELECT i.id, i.student_id, i.student_number, i.amount_due, i.amount_paid,
             i.outstanding_balance, i.overpaid_amount, i.due_date, i.status,
             i.carried_forward_to_invoice_id,
             COALESCE(i.description, '') AS description, i.reference_number,
             i.created_at, i.updated_at
      FROM invoices i
      WHERE i.student_id = $1
      ORDER BY i.due_date DESC, i.id DESC
    `, [studentId]),
    executor.query(`
      SELECT pt.id, pt.invoice_id, pt.student_id, pt.student_number,
             pt.reverses_transaction_id,
             to_jsonb(pt)->>'allocation_category' AS allocation_category,
             (pt.reverses_transaction_id IS NOT NULL) AS is_reversal,
             reversal.id AS reversal_id,
             (reversal.id IS NOT NULL) AS is_reversed,
             COALESCE(pt.reference, pt.reference_number) AS reference_number,
             pt.amount, COALESCE(pt.payment_date, pt.transaction_date) AS payment_date,
             pt.transaction_date, pt.description, pt.payment_method,
             pt.month, pt.year, pt.created_at
      FROM payment_transactions pt
      LEFT JOIN payment_transactions reversal
        ON reversal.reverses_transaction_id = pt.id
      WHERE pt.student_id = $1
      ORDER BY COALESCE(pt.payment_date, pt.transaction_date) DESC, pt.id DESC
    `, [studentId]),
    executor.query(`
      SELECT service_key, label, description, amount
      FROM service_prices
      ORDER BY display_order, service_key
    `),
  ]);

  const charge = configuredComponents(student, priceResult.rows);
  const carryForwardSourceIds = await getCarryForwardSourceIds(executor, invoiceResult.rows);
  const transactions = transactionResult.rows.map((row) => ({
    ...row,
    amount: money(row.amount),
    allocated: row.invoice_id != null,
    review_flags: row.invoice_id == null ? ['unallocated_payment'] : [],
  }));

  // Invoice line items are immutable snapshots. They may not exist on older
  // installations, so this read-only probe falls back to invoice balances.
  // Historical invoices are never rebuilt from today's prices or flags.
  let lineRows = [];
  if (invoiceResult.rows.length) {
    try {
      const lineResult = await executor.query(`
        SELECT id, invoice_id, line_type, service_key, bundle_key, label,
               description, quantity, unit_amount, amount, is_included,
               discount_assignment_id, metadata
        FROM invoice_line_items
        WHERE invoice_id = ANY($1::integer[])
        ORDER BY invoice_id, id
      `, [invoiceResult.rows.map((row) => Number(row.id))]);
      lineRows = lineResult.rows;
    } catch (error) {
      if (!isMissingOptionalFinanceSchema(error)) throw error;
    }
  }
  const linesByInvoice = new Map();
  lineRows.forEach((line) => {
    const invoiceId = Number(line.invoice_id);
    if (!linesByInvoice.has(invoiceId)) linesByInvoice.set(invoiceId, []);
    linesByInvoice.get(invoiceId).push(line);
  });
  const paymentRowsByInvoice = new Map();
  transactions.forEach((transaction) => {
    if (transaction.invoice_id == null) return;
    const invoiceId = Number(transaction.invoice_id);
    if (!paymentRowsByInvoice.has(invoiceId)) paymentRowsByInvoice.set(invoiceId, []);
    paymentRowsByInvoice.get(invoiceId).push(transaction);
  });

  const invoices = invoiceResult.rows.map((row) => {
    const amountDue = money(row.amount_due);
    const amountPaid = money(row.amount_paid);
    const outstanding = nonNegative(amountDue - amountPaid);
    const overpaid = nonNegative(amountPaid - amountDue);
    const lines = normaliseInvoiceLines(linesByInvoice.get(row.id) || []);
    const charges = lines.filter((line) => line.line_type === 'charge' && !isClassificationCorrection(line));
    const discounts = lines.filter((line) => line.line_type === 'discount');
    const grossCharges = money(charges.reduce((sum, line) => sum + line.amount, 0));
    const discountTotal = money(discounts.reduce((sum, line) => sum + line.amount, 0));
    const chargeTotals = {};
    charges.forEach((line) => {
      const key = line.service_key || 'other';
      chargeTotals[key] = money((chargeTotals[key] || 0) + line.amount);
    });
    const oneOffChargeLines = charges.filter((line) => (
      line.metadata && (line.metadata.fee_id != null || line.metadata.category === 'one_off')
    ));
    const legacyLine = charges.find((line) => {
      const metadata = line.metadata || {};
      return metadata.source === 'legacy_invoice_reconciliation' ||
        metadata.legacy_reconciliation === true ||
        metadata.legacy_reconciliation === 'true';
    });
    const legacyMetadata = legacyLine?.metadata || {};
    const paymentReviewFlags = [];
    const invoiceDate = dateOnlyParts(row.due_date);
    const invoiceMonth = invoiceDate?.month;
    const invoiceYear = invoiceDate?.year;
    for (const transaction of paymentRowsByInvoice.get(row.id) || []) {
      if (transaction.month != null && transaction.year != null &&
          invoiceDate &&
          (Number(transaction.month) !== invoiceMonth || Number(transaction.year) !== invoiceYear)) {
        paymentReviewFlags.push({
          type: 'transaction_month_mismatch',
          transaction_id: transaction.id,
          transaction_month: Number(transaction.month),
          transaction_year: Number(transaction.year),
          invoice_month: invoiceMonth,
          invoice_year: invoiceYear,
        });
      }
    }
    const status = invoiceStatus(amountDue, amountPaid, row.status);
    const carryForwardHistory = carryForwardSourceIds.has(Number(row.id)) ||
      status === 'Carried Forward';
    const categoryBalances = invoiceCategoryBalances(
      lines,
      amountDue,
      paymentRowsByInvoice.get(row.id) || [],
    );
    const effectiveCategorised = (paymentRowsByInvoice.get(row.id) || [])
      .some((transaction) => transaction.allocation_category && !transaction.is_reversed && Number(transaction.amount) > 0);
    const legacyCategoryReview = amountPaid > 0 && categoryBalances.length > 1 && !effectiveCategorised;
    if (legacyCategoryReview) {
      paymentReviewFlags.push({ type: 'legacy_category_allocation_unknown' });
    }
    return {
      ...row,
      status,
      counted_in_totals: !carryForwardHistory,
      amount_due: amountDue,
      amount_paid: amountPaid,
      outstanding_balance: outstanding,
      overpaid_amount: overpaid,
       gross_charges: lines.length ? grossCharges : amountDue,
      discount_lines: discounts,
      discount_total: discountTotal,
      net_due: amountDue,
      allocated_effective_payments: amountPaid,
      credit: overpaid,
      payment_review_flags: paymentReviewFlags,
      review_required: paymentReviewFlags.length > 0,
      line_items: lines,
      charge_totals: chargeTotals,
      service_charge_lines: charges.filter((line) => !oneOffChargeLines.includes(line)),
      one_off_charge_lines: oneOffChargeLines,
      one_off_fee_ids: [...new Set(oneOffChargeLines
        .map((line) => line.metadata?.fee_id)
        .filter((id) => id != null)
        .map((id) => Number(id)))],
      category_balances: legacyCategoryReview ? [] : categoryBalances,
      category_allocation_review_required: legacyCategoryReview,
      legacy_reconciliation: !carryForwardHistory && legacyLine ? {
        state: 'RECONCILED',
        category: legacyMetadata.category || legacyLine.service_key,
        service_key: legacyMetadata.service_key || legacyLine.service_key,
        actor_id: legacyMetadata.actor_id == null ? null : Number(legacyMetadata.actor_id),
        actor_name: legacyMetadata.actor_name || null,
        classified_at: legacyMetadata.classified_at || null,
        reason: legacyMetadata.reason || null,
        previous_classification: legacyMetadata.previous_classification ?? null,
      } : null,
      reconciliation_state: carryForwardHistory ? null : (
        legacyLine ? 'RECONCILED' : (
          lines.length === 0 && outstanding > 0 ? 'REQUIRES_RECONCILIATION' : null
        )
      ),
      carry_forward_history: carryForwardHistory,
      // This is derived from normalized rows loaded from the persisted
      // invoice-line snapshot, never from current pricing or enrollment.
      snapshot_available: lines.length > 0,
       // Enrollment information is not historical billing evidence. Billed
       // and bundled truth comes only from this invoice's immutable lines.
       service_components: charge.components.map(({ key, label, description, enrolled }) => ({
         key, label, description, enrolled: Boolean(enrolled),
       })),
    };
  });

  const countedInvoices = invoices.filter((invoice) => invoice.status !== 'Carried Forward');
  transactions.forEach((transaction) => {
    if (transaction.invoice_id == null) transaction.review_required = true;
  });
  const serviceComponents = charge.components.map(({ key, label, description, enrolled }) => ({
    key, label, description, enrolled: Boolean(enrolled),
  }));
  const totalDue = money(countedInvoices.reduce((sum, invoice) => sum + invoice.amount_due, 0));
  const totalPaid = money(countedInvoices.reduce((sum, invoice) => sum + invoice.amount_paid, 0));
  const outstanding = money(countedInvoices.reduce((sum, invoice) => sum + invoice.outstanding_balance, 0));
  const overpaid = money(countedInvoices.reduce((sum, invoice) => sum + invoice.overpaid_amount, 0));
  const unallocated = money(transactions
    .filter((transaction) => !transaction.allocated)
    .reduce((sum, transaction) => sum + transaction.amount, 0));

  return {
    student,
    invoices,
    transactions,
    service_components: serviceComponents,
    totals: {
      totalDue,
      totalPaid,
      outstanding,
      overpaid,
      unallocated,
      // Credits are explicit and never reduce billed totals. netOutstanding is
      // useful for collection work, while outstanding remains the invoice
      // balance shown by both Admin and Parent.
      credit: money(overpaid + unallocated),
      netOutstanding: money(outstanding - overpaid - unallocated),
    },
  };
}

/*
 * Summary used by the Admin invoice list/dashboard. Keep this beside the
 * student ledger so carry-forward history, invoice balances, and explicit
 * credits have one interpretation for every consumer.
 */
async function getFinanceSummary(filters = {}, executor = db) {
  filters = parseInvoiceFilterQuery(filters);
  const params = [];
  const clauses = [];
  if (filters.status) {
    if (!INVOICE_STATUSES.includes(filters.status)) throw new Error('Invalid invoice status filter');
    params.push(filters.status);
    clauses.push(`${invoiceStatusExpression('i')} = $${params.length}`);
  }
  appendPeriodFilters(clauses, params, 'i.due_date', filters);
  if (filters.studentNumber) {
    params.push(`%${String(filters.studentNumber)}%`);
    clauses.push(`i.student_number ILIKE $${params.length}`);
  }
  const invoiceResult = await executor.query(`
    SELECT i.id, i.status, i.amount_due, i.amount_paid, i.outstanding_balance,
           i.overpaid_amount, i.student_id
    FROM invoices i
     WHERE ${clauses.length ? clauses.join(' AND ') : 'TRUE'}
  `, params);

  const transactionParams = [];
  const transactionClauses = ['pt.invoice_id IS NULL'];
  if (filters.studentNumber) {
    transactionParams.push(`%${String(filters.studentNumber)}%`);
    transactionClauses.push(`pt.student_number ILIKE $${transactionParams.length}`);
  }
  appendPeriodFilters(
    transactionClauses,
    transactionParams,
    'COALESCE(pt.payment_date, pt.transaction_date)',
    filters,
  );
  const unallocatedResult = await executor.query(`
    SELECT COALESCE(SUM(pt.amount), 0) AS unallocated
    FROM payment_transactions pt
    WHERE ${transactionClauses.join(' AND ')}
  `, transactionParams);

  // Keep the invariant in the model as well as SQL so mocked/read-replica
  // results cannot accidentally reintroduce carry-forward double counting.
  const rows = invoiceResult.rows
    .map((row) => ({ ...row, status: invoiceStatus(row.amount_due, row.amount_paid, row.status) }))
    .filter((row) => row.status !== 'Carried Forward');
  const summary = {
    totalInvoices: rows.length,
    paidCount: rows.filter((row) => row.status === 'Paid').length,
    unpaidCount: rows.filter((row) => row.status === 'Unpaid').length,
    partialCount: rows.filter((row) => row.status === 'Partial').length,
    overpaidCount: rows.filter((row) => row.status === 'Overpaid').length,
    totalAmountDue: money(rows.reduce((sum, row) => sum + money(row.amount_due), 0)),
    totalAmountPaid: money(rows.reduce((sum, row) => sum + money(row.amount_paid), 0)),
    totalOutstanding: money(rows.reduce((sum, row) => sum + nonNegative(money(row.amount_due) - money(row.amount_paid)), 0)),
    totalOverpaid: money(rows.reduce((sum, row) => sum + nonNegative(money(row.amount_paid) - money(row.amount_due)), 0)),
    unallocated: money(unallocatedResult.rows[0]?.unallocated),
  };
  summary.credit = money(summary.totalOverpaid + summary.unallocated);
  summary.netOutstanding = money(summary.totalOutstanding - summary.credit);
  return summary;
}

/*
 * Internal ledger primitive. It must only be called by
 * financeCommandService inside withTransaction(), which sets the transaction
 * local harmony.finance_command=canonical marker enforced by the finance-core
 * invoice projection guard. Routes must not call this function directly.
 *
 * Allocate one payment atomically on a caller-owned transaction. Every
 * channel (manual entry, bank import, and approved proof) can use this helper.
 * The excess is deliberately recorded as an invoice-less transaction rather
 * than inflating the last invoice; this keeps overpayment/unallocated credit
 * visible and reversible without rewriting history.
 */
async function allocatePayment(executor, {
  studentId,
  amount,
  paymentDate,
  paymentMethod = 'manual_entry',
  reference,
  description,
  recordedBy,
  // An edit/reapplication may target one exact prior allocation.  Normal
  // payments leave this null and settle oldest outstanding invoices first.
  invoiceId = null,
  transactionMonth = null,
  transactionYear = null,
  /*
   * Optional parent/admin proposal. Each item is { invoiceId, amount,
   * category }. When supplied, only those exact invoice obligations may
   * receive this payment. An omitted proposal preserves the established
   * oldest-unpaid behavior.
   */
  allocationProposals = null,
  proposedAllocations = null,
}) {
  const allocationError = (message, safeMessage, status = 422) => {
    const error = new Error(message);
    error.status = status;
    error.safeMessage = safeMessage || 'One or more selected payment items must be reviewed before approval.';
    return error;
  };
  const total = money(amount);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Payment amount must be positive');
  const queryAt = async (stage, sql, params) => {
    try {
      return await executor.query(sql, params);
    } catch (error) {
      error.financeStage = stage;
      throw error;
    }
  };
  const normalizedStudentId = Number(studentId);
  if (!Number.isSafeInteger(normalizedStudentId) || normalizedStudentId <= 0) {
    throw allocationError('Invalid learner ID', 'The learner attached to this payment is invalid.', 422);
  }
  const studentResult = await queryAt(
    'load-learner',
    `SELECT id, student_number FROM users WHERE id = $1 AND role = 'student' FOR SHARE`,
    [normalizedStudentId],
  );
  if (!studentResult.rows.length) throw new Error('Student not found');
  const student = studentResult.rows[0];
  const date = paymentDate || new Date().toISOString().slice(0, 10);
  const ref = reference || `${String(paymentMethod).toUpperCase()}-${Date.now()}`;
  let remaining = total;
  const allocations = [];

  const rawProposals = allocationProposals || proposedAllocations;
  const proposals = Array.isArray(rawProposals)
    ? rawProposals.map((proposal) => ({
      invoiceId: Number(proposal.invoiceId ?? proposal.invoice_id),
      amount: proposal.amount == null ? null : money(proposal.amount),
      category: proposal.category || proposal.service_key || null,
      legacyInvoiceLevel: proposal.legacyInvoiceLevel === true || proposal.legacy_invoice_level === true,
    })).filter((proposal) => Number.isSafeInteger(proposal.invoiceId) && proposal.invoiceId > 0)
    : null;
  if (proposals && proposals.length === 0) {
    throw allocationError('At least one valid allocation proposal is required');
  }
  if (proposals && proposals.every((proposal) => proposal.amount != null)) {
    const proposedTotal = money(proposals.reduce((sum, proposal) => sum + proposal.amount, 0));
    if (proposedTotal > total) {
      throw allocationError(
        `Selected allocation total ${proposedTotal} exceeds payment amount ${total}`,
        'The selected allocation total exceeds the payment amount. Adjust the allocation before approving.',
      );
    }
  }
  // The correction route uses 0 as its explicit "no exact invoice" marker
  // for a formerly-unallocated event. Treat it as normal oldest-unpaid
  // allocation rather than accidentally forcing an invoice-id=0 query.
  const targetInvoiceId = invoiceId == null || Number(invoiceId) === 0 ? null : Number(invoiceId);
  if (targetInvoiceId != null && proposals && !proposals.some((proposal) => proposal.invoiceId === targetInvoiceId)) {
    throw allocationError('Selected invoice is not included in the allocation proposal');
  }
  const requestedInvoiceIds = proposals
    ? [...new Set(proposals.map((proposal) => proposal.invoiceId))]
    : null;
  const invoiceResult = await queryAt('lock-invoices', `
    SELECT id, student_number, reference_number, amount_due, amount_paid,
           GREATEST(amount_due - amount_paid, 0) AS outstanding_balance,
           due_date
    FROM invoices
    WHERE student_id = $1 AND amount_paid < amount_due
      AND ($2::integer IS NULL OR id = $2)
      AND ($3::integer[] IS NULL OR id = ANY($3::integer[]))
    ORDER BY due_date ASC, id ASC
    FOR UPDATE
  `, [normalizedStudentId, targetInvoiceId, requestedInvoiceIds]);

  const invoiceRowsById = new Map(invoiceResult.rows.map((invoice) => [Number(invoice.id), invoice]));
  if (proposals) {
    const missing = proposals.find((proposal) => !invoiceRowsById.has(proposal.invoiceId));
    if (missing) throw allocationError(
      `Invoice ${missing.invoiceId} is no longer outstanding for this learner`,
      'One of the selected payment items is no longer outstanding. Please review the allocation before approving.',
      409,
    );
  }

  let categoryByInvoice = new Map();
  let allocationLineRows = [];
  if (proposals) {
    const lineResult = await queryAt('load-invoice-lines', `
      SELECT id, invoice_id, line_type, service_key, amount, is_included, metadata
      FROM invoice_line_items
      WHERE invoice_id = ANY($1::integer[])
      ORDER BY invoice_id, id
    `, [requestedInvoiceIds]);
    allocationLineRows = lineResult.rows;
    proposals.filter((proposal) => proposal.legacyInvoiceLevel).forEach((proposal) => {
      const invoice = invoiceRowsById.get(proposal.invoiceId);
      if (invoice && !allocationLineRows.some((line) => Number(line.invoice_id) === proposal.invoiceId)) {
        allocationLineRows.push({
          invoice_id: proposal.invoiceId,
          line_type: 'charge',
          service_key: 'tuition',
          amount: invoice.amount_due,
          is_included: false,
          metadata: { legacy_invoice_level: true },
        });
      }
    });
    const linesByInvoice = new Map();
    lineResult.rows.forEach((line) => {
      if (!linesByInvoice.has(Number(line.invoice_id))) linesByInvoice.set(Number(line.invoice_id), []);
      linesByInvoice.get(Number(line.invoice_id)).push(line);
    });
    proposals.forEach((proposal) => {
      const categories = invoiceAllocationCategories(linesByInvoice.get(proposal.invoiceId) || []);
      categoryByInvoice.set(proposal.invoiceId, categories);
      if (proposal.category && !categories.includes(proposal.category)) {
        throw allocationError(`Allocation category does not match invoice ${proposal.invoiceId}`);
      }
    });
  }
  const categoryRemaining = new Map();
  if (proposals) {
    const priorResult = await queryAt('load-prior-allocations', `
      SELECT pt.invoice_id, pt.amount,
             to_jsonb(pt)->>'allocation_category' AS allocation_category,
             (reversal.id IS NOT NULL) AS is_reversed
      FROM payment_transactions pt
      LEFT JOIN payment_transactions reversal ON reversal.reverses_transaction_id=pt.id
      WHERE pt.invoice_id = ANY($1::integer[])
    `, [requestedInvoiceIds]);
    requestedInvoiceIds.forEach((id) => {
      const invoice = invoiceRowsById.get(id);
      const invoiceLines = allocationLineRows.filter((line) => Number(line.invoice_id) === id);
      const invoiceTransactions = priorResult.rows.filter((tx) => Number(tx.invoice_id) === id);
      const categories = invoiceAllocationCategories(invoiceLines);
      const hasCategorised = invoiceTransactions.some((tx) =>
        tx.allocation_category && !tx.is_reversed && Number(tx.amount) > 0);
      if (Number(invoice.amount_paid) > 0 && categories.length > 1 && !hasCategorised) {
        throw allocationError(
          'This legacy partially-paid multi-service invoice requires Admin allocation review',
          'This legacy invoice requires category reconciliation before this payment can be approved.',
          409,
        );
      }
      const values = invoiceCategoryBalances(
        invoiceLines,
        invoice.amount_due,
        invoiceTransactions,
      );
      values.forEach((value) => categoryRemaining.set(`${id}:${value.category}`, value.amount));
    });
  }

  const allocationTargets = proposals
    ? proposals.map((proposal) => ({ invoice: invoiceRowsById.get(proposal.invoiceId), proposal }))
    : invoiceResult.rows.map((invoice) => ({ invoice, proposal: null }));
  const paidByInvoice = new Map(invoiceResult.rows.map((invoice) => [Number(invoice.id), money(invoice.amount_paid)]));
  for (const { invoice, proposal } of allocationTargets) {
    if (remaining <= 0) break;
    const currentPaid = paidByInvoice.get(Number(invoice.id)) || 0;
    const invoiceRemaining = nonNegative(money(invoice.amount_due) - currentPaid);
    const proposalCap = proposal?.amount == null
      ? invoiceRemaining
      : nonNegative(proposal.amount);
    const categoryCap = proposal?.category
      ? nonNegative(categoryRemaining.get(`${invoice.id}:${proposal.category}`) || 0)
      : invoiceRemaining;
    if (proposal && proposal.amount != null && proposalCap > categoryCap) {
      throw allocationError(
        `Requested ${proposal.category || 'invoice'} allocation exceeds its outstanding balance`,
        'One of the selected payment items is no longer available for the requested amount. Please review the allocation before approving.',
      );
    }
    const toApply = money(Math.min(
      remaining,
      invoiceRemaining,
      proposalCap,
      categoryCap,
    ));
    if (toApply <= 0) {
      if (proposal) {
        throw allocationError(
          `Selected ${proposal.category || 'invoice'} obligation has no outstanding balance`,
          'One of the selected payment items is no longer outstanding. Please review the allocation before approving.',
        );
      }
      continue;
    }
    const newPaid = currentPaid + toApply;
    const due = money(invoice.amount_due);
    const status = newPaid > due ? 'Overpaid' : due === 0 ? 'Paid' : newPaid >= due ? 'Paid' : 'Partial';
    await queryAt('update-invoice-balance', `
      UPDATE invoices
      SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [newPaid.toFixed(2), status, invoice.id]);
    paidByInvoice.set(Number(invoice.id), newPaid);
    if (proposal?.category) {
      categoryRemaining.set(
        `${invoice.id}:${proposal.category}`,
        nonNegative(categoryCap - toApply),
      );
    }
    const tx = proposals ? await queryAt('insert-allocation-event', `
      INSERT INTO payment_transactions
        (invoice_id, student_id, student_number, reference_number, reference,
         amount, transaction_date, payment_date, description, payment_method,
          recorded_by, month, year, allocation_category)
      VALUES ($1,$2,$3,$4,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `, [
      invoice.id, normalizedStudentId, student.student_number, ref, toApply.toFixed(2),
      date, description || null, paymentMethod, recordedBy || null,
      transactionMonth || dateOnlyParts(invoice.due_date)?.month,
      transactionYear || dateOnlyParts(invoice.due_date)?.year,
      proposal?.category || null,
    ]) : await queryAt('insert-allocation-event', `
      INSERT INTO payment_transactions
        (invoice_id, student_id, student_number, reference_number, reference,
         amount, transaction_date, payment_date, description, payment_method,
         recorded_by, month, year)
      VALUES ($1,$2,$3,$4,$4,$5,$6,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      invoice.id, normalizedStudentId, student.student_number, ref, toApply.toFixed(2),
      date, description || null, paymentMethod, recordedBy || null,
      transactionMonth || dateOnlyParts(invoice.due_date)?.month,
      transactionYear || dateOnlyParts(invoice.due_date)?.year,
    ]);
    allocations.push({
      transactionId: tx.rows[0].id,
      invoiceId: invoice.id,
      category: proposal?.category || categoryByInvoice.get(Number(invoice.id))?.[0] || null,
      reference: invoice.reference_number,
      dueDate: invoice.due_date,
      status,
      amount: toApply,
    });
    remaining = money(remaining - toApply);
  }

  if (remaining > 0) {
    const tx = await queryAt('insert-unallocated-credit', `
      INSERT INTO payment_transactions
        (invoice_id, student_id, student_number, reference_number, reference,
         amount, transaction_date, payment_date, description, payment_method,
         recorded_by)
      VALUES (NULL,$1,$2,$3,$3,$4,$5,$5,$6,$7,$8)
      RETURNING id
    `, [
      normalizedStudentId, student.student_number, ref, remaining.toFixed(2), date,
      description || 'Unallocated overpayment', paymentMethod, recordedBy || null,
    ]);
    allocations.push({ transactionId: tx.rows[0].id, invoiceId: null, amount: remaining });
  }
  return { total, allocations };
}

/*
 * Internal ledger primitive; see allocatePayment above. It is reached only
 * through financeCommandService's marked command transaction.
 *
 * Reverse one immutable allocation without broad student/month/year updates.
 * The original event remains untouched; a negative compensating event is
 * recorded and the exact invoice balance is restored under a row lock.
 */
async function reversePayment(executor, { transactionId, recordedBy, description }) {
  const result = await executor.query(`
    SELECT id, invoice_id, student_id, student_number, reference_number, reference,
           reverses_transaction_id,
           amount, payment_date, transaction_date, payment_method, month, year
    FROM payment_transactions
    WHERE id = $1
    FOR UPDATE
  `, [transactionId]);
  if (!result.rows.length) throw new Error('Payment not found');
  const payment = result.rows[0];
  const amount = money(payment.amount);
  if (amount <= 0) throw new Error('Payment has already been reversed');
  if (payment.reverses_transaction_id != null) {
    throw new Error('A reversal transaction cannot itself be reversed');
  }

  // The original row is locked above. Re-checking after that lock makes
  // repeated requests idempotent and serializes concurrent delete/edit calls.
  const existingResult = await executor.query(`
    SELECT id, invoice_id
    FROM payment_transactions
    WHERE reverses_transaction_id = $1
    ORDER BY id ASC
    LIMIT 1
  `, [transactionId]);
  if (existingResult.rows.length) {
    return {
      payment,
      reversalId: existingResult.rows[0].id,
      effectiveInvoiceId: existingResult.rows[0].invoice_id ?? null,
      alreadyReversed: true,
    };
  }

  const savepoint = `finance_reversal_${String(transactionId).replace(/[^0-9]/g, '') || 'payment'}`;
  await executor.query(`SAVEPOINT ${savepoint}`);
  let targetInvoiceId = payment.invoice_id;
  if (payment.invoice_id != null) {
    const invoiceResult = await executor.query(`
      SELECT id, student_id, amount_due, amount_paid, status, due_date,
             carried_forward_to_invoice_id
      FROM invoices
      WHERE id = $1
      FOR UPDATE
    `, [payment.invoice_id]);
    if (!invoiceResult.rows.length) throw new Error('Payment invoice not found');
    const invoice = invoiceResult.rows[0];
    if (invoice.status === 'Carried Forward') {
      // Carry-forward preserves the source invoice as audit history. Its
      // replacement carries the remaining balance, so undoing an old
      // allocation increases the successor's amount_due rather than trying
      // to make the historical invoice visible again.
      const sourceYear = dateOnlyParts(invoice.due_date)?.year || payment.year;
      let successorResult;
      if (invoice.carried_forward_to_invoice_id != null) {
        successorResult = await executor.query(`
          SELECT id, amount_due, amount_paid, status
          FROM invoices
          WHERE id = $1 AND student_id = $2 AND status <> 'Carried Forward'
          FOR UPDATE
        `, [invoice.carried_forward_to_invoice_id, invoice.student_id]);
      } else {
        // Legacy rows have no persisted relationship. Use the established
        // description/year/date convention only when exactly one active
        // candidate exists; never guess among ambiguous successors.
        successorResult = await executor.query(`
          SELECT id, amount_due, amount_paid, status,
                 COUNT(*) OVER () AS candidate_count
          FROM invoices
          WHERE student_id = $1
            AND id <> $2
            AND status <> 'Carried Forward'
            AND description = $3
            AND due_date >= $4
          ORDER BY due_date ASC, id ASC
          FOR UPDATE
        `, [
          invoice.student_id,
          invoice.id,
          `Arrears from ${sourceYear}`,
          invoice.due_date,
        ]);
      }
      const successor = successorResult.rows.length === 1 &&
        (successorResult.rows[0].candidate_count == null ||
          Number(successorResult.rows[0].candidate_count) === 1)
        ? successorResult.rows[0]
        : null;
      if (!successor) {
        await executor.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw new Error('Cannot reverse payment: no active carry-forward successor exists');
      }
      const successorDue = money(successor.amount_due) + amount;
      const successorPaid = money(successor.amount_paid);
       const successorStatus = successorPaid > successorDue ? 'Overpaid' :
         successorDue === 0 ? 'Paid' : successorPaid >= successorDue ? 'Paid' :
           successorPaid > 0 ? 'Partial' : 'Unpaid';
      await executor.query(`
        UPDATE invoices
        SET amount_due = $1, status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [successorDue.toFixed(2), successorStatus, successor.id]);
      targetInvoiceId = successor.id;
    } else {
      const currentPaid = money(invoice.amount_paid);
      if (currentPaid < amount) {
        await executor.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw new Error('Cannot reverse payment: invoice balance is lower than the payment allocation');
      }
      const amountPaid = money(currentPaid - amount);
      const amountDue = money(invoice.amount_due);
       const status = amountPaid > amountDue ? 'Overpaid' :
         amountDue === 0 ? 'Paid' : amountPaid >= amountDue ? 'Paid' :
           amountPaid > 0 ? 'Partial' : 'Unpaid';
      await executor.query(`
        UPDATE invoices
        SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [amountPaid.toFixed(2), status, invoice.id]);
    }
  }

  let reversal;
  try {
    reversal = await executor.query(`
    INSERT INTO payment_transactions
      (invoice_id, student_id, student_number, reference_number, reference, reverses_transaction_id,
       amount, transaction_date, payment_date, description, payment_method,
       recorded_by, month, year)
    VALUES (
      $1,$2,$3,$4,$4,$5,$6,
      COALESCE($7::date,$8::date),
      COALESCE($7::date,$8::date),
      $9,$10,$11,$12,$13
    )
    RETURNING id
  `, [
    targetInvoiceId, payment.student_id, payment.student_number,
    payment.reference_number || payment.reference || `PAYMENT-${payment.id}-REV`,
    payment.id, (-amount).toFixed(2), payment.payment_date, payment.transaction_date,
    description || `Reversal of payment ${payment.id}`,
    // Keep the validated payment channel unchanged. Reversal identity is
    // authoritative in reverses_transaction_id; suffixing the channel can
    // exceed legacy VARCHAR/check constraints in older production schemas.
    payment.payment_method || 'manual_entry', recordedBy || null,
    payment.month, payment.year,
  ]);
  } catch (error) {
    if (error.code !== '23505') throw error;
    await executor.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    const concurrent = await executor.query(`
      SELECT id, invoice_id FROM payment_transactions
      WHERE reverses_transaction_id = $1
      ORDER BY id ASC LIMIT 1
    `, [transactionId]);
    if (!concurrent.rows.length) throw error;
    return {
      payment,
      reversalId: concurrent.rows[0].id,
      effectiveInvoiceId: concurrent.rows[0].invoice_id ?? null,
      alreadyReversed: true,
    };
  }
  await executor.query(`RELEASE SAVEPOINT ${savepoint}`);
  return {
    payment,
    reversalId: reversal.rows[0].id,
    effectiveInvoiceId: targetInvoiceId,
  };
}

module.exports = {
  money,
  invoiceStatus,
  invoiceStatusExpression,
  loadInvoiceLineItems,
  buildInvoiceBreakdown,
  invoiceAllocationCategories,
  invoiceCategoryBalances,
  configuredComponents,
  configuredBillableLines,
  calculateApprovedDiscounts,
  buildInvoiceSnapshotLines,
  getStudentLedger,
  getFinanceSummary,
  allocatePayment,
  reversePayment,
};