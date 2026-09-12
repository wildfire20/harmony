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
const { appendPeriodFilters } = require('../utils/invoiceQuery');

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const nonNegative = (value) => Math.max(0, money(value));
const INVOICE_STATUSES = ['Unpaid', 'Partial', 'Paid', 'Overpaid', 'Carried Forward'];

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
  return rows.map((row) => {
    const type = String(row.line_type || row.type || 'charge').toLowerCase();
    const amount = lineAmount(row);
    return {
      id: row.id,
      line_type: type === 'discount' || type === 'adjustment' ? 'discount' : 'charge',
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
  const charges = lines.filter((line) => line.line_type === 'charge');
  const discounts = lines.filter((line) => line.line_type === 'discount');
  const amountDue = money(invoice.amount_due);
  const amountPaid = money(invoice.amount_paid);
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
    snapshot_available: lines.length > 0,
    payment_review_flags: reviewFlags,
    review_required: reviewFlags.length > 0,
  };
}

function configuredComponents(student, prices) {
  const byKey = new Map(prices.map((price) => [price.service_key, price]));
  const enabled = [
    ['tuition', true],
    ['boarding', Boolean(student.is_boarder)],
    ['transport', Boolean(student.uses_transport)],
    ['aftercare', Boolean(student.uses_aftercare)],
  ];
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
function configuredBillableLines(student, prices) {
  const enabled = new Map([
    ['tuition', true],
    ['boarding', Boolean(student.is_boarder)],
    ['transport', Boolean(student.uses_transport)],
    ['aftercare', Boolean(student.uses_aftercare)],
  ]);
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
  const chargeGross = money(chargeLines.reduce((sum, line) => sum + line.amount, 0));
  let discountedTotal = 0;
  for (const assignment of assignments) {
    const targets = assignment.applicable_service_key
      ? chargeLines.filter((line) => line.service_key === assignment.applicable_service_key)
      : chargeLines;
    const targetGross = money(targets.reduce((sum, line) => sum + line.amount, 0));
    const targetDiscounted = money(targets.reduce((sum, line) =>
      sum + (discountedByService.get(line.service_key) || 0), 0));
    const remainingInvoice = money(chargeGross - discountedTotal);
    const remainingTarget = money(targetGross - targetDiscounted);
    const available = assignment.applicable_service_key
      ? remainingTarget : remainingInvoice;
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
      // A non-scoped discount consumes the remaining invoice gross. Track its
      // proportional service allocation so later scoped assignments cannot
      // discount a service below zero.
      let allocated = 0;
      targets.forEach((line, index) => {
        const share = index === targets.length - 1
          ? money(amount - allocated)
          : money(amount * line.amount / targetGross);
        allocated = money(allocated + share);
        discountedByService.set(line.service_key, money(
          (discountedByService.get(line.service_key) || 0) + share,
        ));
      });
    }
    discountedTotal = money(discountedTotal + amount);
  }
  return discounts;
}

function buildInvoiceSnapshotLines(student, prices, assignments = []) {
  const charges = configuredBillableLines(student, prices);
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
  normaliseInvoiceLines(lineRows).forEach((line, index) => {
    const invoiceId = Number(lineRows[index].invoice_id);
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
    const lines = linesByInvoice.get(row.id) || [];
    const charges = lines.filter((line) => line.line_type === 'charge');
    const discounts = lines.filter((line) => line.line_type === 'discount');
    const grossCharges = money(charges.reduce((sum, line) => sum + line.amount, 0));
    const discountTotal = money(discounts.reduce((sum, line) => sum + line.amount, 0));
    const paymentReviewFlags = [];
    const invoiceDate = row.due_date ? new Date(row.due_date) : null;
    const invoiceMonth = invoiceDate && invoiceDate.getUTCMonth() + 1;
    const invoiceYear = invoiceDate && invoiceDate.getUTCFullYear();
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
    return {
      ...row,
      status,
      counted_in_totals: status !== 'Carried Forward',
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
 * Allocate one payment atomically on a caller-owned transaction.  Every
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
}) {
  const total = money(amount);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Payment amount must be positive');
  const studentResult = await executor.query(
    `SELECT id, student_number FROM users WHERE id = $1 AND role = 'student' FOR SHARE`,
    [studentId],
  );
  if (!studentResult.rows.length) throw new Error('Student not found');
  const student = studentResult.rows[0];
  const date = paymentDate || new Date().toISOString().slice(0, 10);
  const ref = reference || `${String(paymentMethod).toUpperCase()}-${Date.now()}`;
  let remaining = total;
  const allocations = [];

  const invoiceResult = await executor.query(`
    SELECT id, student_number, reference_number, amount_due, amount_paid,
           GREATEST(amount_due - amount_paid, 0) AS outstanding_balance,
           due_date
    FROM invoices
    WHERE student_id = $1 AND status IN ('Unpaid', 'Partial')
      AND ($2::integer IS NULL OR id = $2)
    ORDER BY due_date ASC, id ASC
    FOR UPDATE
  `, [studentId, invoiceId]);

  for (const invoice of invoiceResult.rows) {
    if (remaining <= 0) break;
    const toApply = money(Math.min(remaining, nonNegative(invoice.outstanding_balance)));
    if (toApply <= 0) continue;
    const newPaid = money(invoice.amount_paid) + toApply;
    const due = money(invoice.amount_due);
    const status = newPaid > due ? 'Overpaid' : due === 0 ? 'Paid' : newPaid >= due ? 'Paid' : 'Partial';
    await executor.query(`
      UPDATE invoices
      SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [newPaid.toFixed(2), status, invoice.id]);
    const tx = await executor.query(`
      INSERT INTO payment_transactions
        (invoice_id, student_id, student_number, reference_number, reference,
         amount, transaction_date, payment_date, description, payment_method,
         recorded_by, month, year)
      VALUES ($1,$2,$3,$4,$4,$5,$6,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      invoice.id, studentId, student.student_number, ref, toApply.toFixed(2),
      date, description || null, paymentMethod, recordedBy || null,
      transactionMonth || new Date(invoice.due_date).getUTCMonth() + 1,
      transactionYear || new Date(invoice.due_date).getUTCFullYear(),
    ]);
    allocations.push({
      transactionId: tx.rows[0].id,
      invoiceId: invoice.id,
      reference: invoice.reference_number,
      dueDate: invoice.due_date,
      status,
      amount: toApply,
    });
    remaining = money(remaining - toApply);
  }

  if (remaining > 0) {
    const tx = await executor.query(`
      INSERT INTO payment_transactions
        (invoice_id, student_id, student_number, reference_number, reference,
         amount, transaction_date, payment_date, description, payment_method,
         recorded_by)
      VALUES (NULL,$1,$2,$3,$3,$4,$5,$5,$6,$7,$8)
      RETURNING id
    `, [
      studentId, student.student_number, ref, remaining.toFixed(2), date,
      description || 'Unallocated overpayment', paymentMethod, recordedBy || null,
    ]);
    allocations.push({ transactionId: tx.rows[0].id, invoiceId: null, amount: remaining });
  }
  return { total, allocations };
}

/*
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
      const sourceYear = invoice.due_date
        ? new Date(invoice.due_date).getUTCFullYear()
        : payment.year;
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
      const amountPaid = nonNegative(money(invoice.amount_paid) - amount);
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
    VALUES ($1,$2,$3,$4,$4,$5,$6,COALESCE($7,$8),COALESCE($7,$8),$9,$10,$11,$12,$13)
    RETURNING id
  `, [
    targetInvoiceId, payment.student_id, payment.student_number,
    payment.reference_number || payment.reference || `PAYMENT-${payment.id}-REV`,
    payment.id, (-amount).toFixed(2), payment.payment_date, payment.transaction_date,
    description || `Reversal of payment ${payment.id}`,
    `${payment.payment_method || 'manual_entry'}_reversal`, recordedBy || null,
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
  configuredComponents,
  configuredBillableLines,
  calculateApprovedDiscounts,
  buildInvoiceSnapshotLines,
  getStudentLedger,
  getFinanceSummary,
  allocatePayment,
  reversePayment,
};