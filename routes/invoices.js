const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { notifyInvoice, notifyPayment } = require('../services/parentNotificationService');
const { logAudit, getIp } = require('../utils/auditLogger');
const {
  getStudentLedger, getFinanceSummary, allocatePayment,
  buildInvoiceSnapshotLines,
  invoiceStatusExpression, loadInvoiceLineItems, buildInvoiceBreakdown, invoiceStatus,
} = require('../services/financeLedger');
const {
  parseInvoiceFilterQuery, parseInvoiceListQuery, appendPeriodFilters,
} = require('../utils/invoiceQuery');
const { acquireInvoiceObligationLocks } = require('../services/invoiceObligationLocks');
const { getPayableObligations } = require('../services/payableObligations');
const { getCarryForwardSourceIds } = require('../services/carryForwardLineage');

const router = express.Router();
const RECONCILABLE_SERVICES = new Map([
  ['tuition', 'Tuition'],
  ['boarding', 'Boarding'],
  ['transport', 'Transport'],
  ['aftercare', 'Aftercare'],
]);
const LEGACY_CLASSIFICATION_SERVICES = new Map([
  ...RECONCILABLE_SERVICES,
  ['other_recurring', 'Other recurring'],
]);
const LEGACY_CLASSIFICATION_SOURCE = 'legacy_invoice_reconciliation';

const positiveInteger = (value) => {
  const raw = String(value == null ? '' : value);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

function dateOnly(value) {
  if (value == null || value === '') return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function csvText(value) {
  let text = String(value == null ? '' : value);
  // A leading apostrophe makes formula-like user input text in spreadsheet
  // applications. Amount columns intentionally do not use this helper.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function csvNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : '0';
}

// Configure multer for CSV uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '..', 'uploads', 'bank-statements');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      cb(null, `bank-statement-${timestamp}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || path.extname(file.originalname).toLowerCase() === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Generate monthly invoices for all active students
router.post('/generate-monthly', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('month').isInt({ min: 1, max: 12 }),
  body('year').isInt({ min: 2020, max: 2030 })
], async (req, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'amountDue')) {
      return res.status(400).json({
        success: false,
        message: 'amountDue is obsolete; monthly invoices use configured service prices, enrollment, and approved discounts',
      });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { month, year } = req.body;
    const dueDate = new Date(year, month, 0); // Last day of the month

    console.log('Generating monthly invoices from configured services:', { month, year });

    // New finance-truth generation is intentionally fail-closed until the
    // explicit additive schema is installed. Legacy flags must never drive a
    // new invoice.
    try {
      await db.query('SELECT 1 FROM learner_discount_assignments LIMIT 1');
      await db.query('SELECT 1 FROM invoice_line_items LIMIT 1');
      await db.query('SELECT billing_mode, bundle_key, included_service_keys FROM service_prices LIMIT 1');
    } catch (schemaError) {
      if (schemaError.code === '42P01' || schemaError.code === '42703') {
        return res.status(503).json({
          success: false,
          message: 'Monthly finance-truth generation is unavailable until migrations/mini_phase1_finance_truth.sql is applied',
        });
      }
      throw schemaError;
    }

    // Get ALL active students (no enrollment date filter — include everyone active)
    const studentsResult = await db.query(`
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.grade_id, u.class_id,
             COALESCE(u.is_boarder, false) AS is_boarder,
             COALESCE(u.uses_transport, false) AS uses_transport,
             COALESCE(u.uses_aftercare, false) AS uses_aftercare
      FROM users u
      WHERE u.role = 'student' AND u.is_active = true
    `);

    const students = studentsResult.rows;
    console.log(`Found ${students.length} active students`);

    if (students.length === 0) {
      return res.status(400).json({ message: 'No active students found' });
    }

    // Find which students already have an invoice for this specific month/year
    // This makes the endpoint idempotent: safe to re-run if generation was partial
    const existingResult = await db.query(`
      SELECT student_id FROM invoices
      WHERE EXTRACT(MONTH FROM due_date) = $1 AND EXTRACT(YEAR FROM due_date) = $2
    `, [month, year]);
    const existingStudentIds = new Set(existingResult.rows.map(r => r.student_id));

    const studentsToInvoice = students.filter(s => !existingStudentIds.has(s.id));
    let skippedCount = existingStudentIds.size;

    if (studentsToInvoice.length === 0) {
      return res.status(400).json({
        message: `All ${students.length} students already have invoices for ${month}/${year}. No new invoices needed.`
      });
    }

    console.log(`Creating invoices for ${studentsToInvoice.length} students (${skippedCount} already had invoices)`);

    const client = await db.pool.connect();
    const createdInvoices = [];
    let siblingDiscountCount = 0;
    let teacherDiscountCount = 0;
    try {
      await client.query('BEGIN');
      // Serialize generation for one calendar period and re-check while the
      // transaction owns the lock. The preflight check above is only a fast
      // response; it is not a concurrency guard.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('harmony-monthly-invoices'), $1::integer)`,
        [Number(year) * 100 + Number(month)],
      );
      const lockedExistingResult = await client.query(`
        SELECT student_id FROM invoices
        WHERE EXTRACT(MONTH FROM due_date) = $1
          AND EXTRACT(YEAR FROM due_date) = $2
        FOR SHARE
      `, [month, year]);
      const lockedExistingStudentIds = new Set(lockedExistingResult.rows.map((row) => row.student_id));
      const lockedStudentsToInvoice = students.filter((student) => !lockedExistingStudentIds.has(student.id));
      skippedCount = lockedExistingStudentIds.size;
      if (lockedStudentsToInvoice.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `All ${students.length} students already have invoices for ${month}/${year}. No new invoices needed.`,
        });
      }
      const pricesResult = await client.query(`
        SELECT service_key, label, description, amount, billing_mode,
               bundle_key, included_service_keys
        FROM service_prices
        ORDER BY display_order, service_key
      `);
      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
      for (const student of lockedStudentsToInvoice) {
        const assignmentsResult = await client.query(`
          SELECT id, discount_type, calculation_method, amount, percentage,
                 applicable_service_key, reason
          FROM learner_discount_assignments
          WHERE student_id = $1 AND is_active = TRUE
            AND starts_on <= $2::date
            AND (ends_on IS NULL OR ends_on >= $2::date)
          ORDER BY id
        `, [student.id, periodStart]);
        const lines = buildInvoiceSnapshotLines(student, pricesResult.rows, assignmentsResult.rows);
        const chargeLines = lines.filter((line) => line.line_type === 'charge' && !line.is_included);
        const discountLines = lines.filter((line) => line.line_type === 'discount');
        const gross = chargeLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
        const discountTotal = discountLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
        const netDue = Math.max(0, Math.round((gross - discountTotal) * 100) / 100);
        const invoiceResult = await client.query(`
          INSERT INTO invoices (
            student_id, student_number, amount_due, due_date, status,
            reference_number, created_by, created_at
          ) VALUES ($1, $2, $3, $4, 'Unpaid', $5, $6, NOW())
          RETURNING *
        `, [student.id, student.student_number, netDue, dueDate, student.student_number, req.user.id]);
        const invoice = invoiceResult.rows[0];
        for (const line of lines) {
          await client.query(`
            INSERT INTO invoice_line_items
              (invoice_id, line_type, service_key, bundle_key, label, description,
               quantity, unit_amount, amount, is_included, discount_assignment_id, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `, [
            invoice.id, line.line_type, line.service_key, line.bundle_key,
            line.label, line.description, line.quantity, line.unit_amount,
            line.amount, line.is_included, line.discount_assignment_id || null,
            JSON.stringify(line.metadata || {}),
          ]);
        }
        createdInvoices.push(invoice);
        siblingDiscountCount += discountLines.filter((line) => line.metadata.discount_type === 'sibling').length;
        teacherDiscountCount += discountLines.filter((line) => line.metadata.discount_type === 'staff').length;
      }
      await client.query('COMMIT');
    } catch (generationError) {
      await client.query('ROLLBACK');
      throw generationError;
    } finally {
      client.release();
    }
    await Promise.allSettled(createdInvoices.map((invoice) => notifyInvoice({
      invoiceId: invoice.id,
      learnerId: invoice.student_id,
      amount: invoice.amount_due,
    })));
    console.log(`Successfully created ${createdInvoices.length} invoices (${siblingDiscountCount} sibling, ${teacherDiscountCount} staff discounts)`);

    const skipMsg = skippedCount > 0 ? ` (${skippedCount} student${skippedCount !== 1 ? 's' : ''} already had invoices — skipped)` : '';
    const parts = [];
    if (siblingDiscountCount > 0) parts.push(`approved sibling discounts × ${siblingDiscountCount}`);
    if (teacherDiscountCount > 0) parts.push(`approved staff discounts × ${teacherDiscountCount}`);
    const discountMsg = parts.length > 0 ? ` — ${parts.join(', ')}` : '';

    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'invoice_generate',
      entityType: 'invoice', entityId: null,
      details: {
        summary: `Generated ${createdInvoices.length} invoices for ${month}/${year}`,
        month, year, invoices_created: createdInvoices.length, skipped: skippedCount,
        sibling_discounts: siblingDiscountCount, teacher_discounts: teacherDiscountCount
      },
      ipAddress: getIp(req)
    });
    res.status(201).json({
      success: true,
      message: `Successfully generated ${createdInvoices.length} invoices for ${month}/${year}${skipMsg}${discountMsg}`,
      invoices: createdInvoices,
      summary: {
        totalStudents: students.length,
        invoicesCreated: createdInvoices.length,
        skipped: skippedCount,
        siblingDiscountsApplied: siblingDiscountCount,
        teacherDiscountsApplied: teacherDiscountCount,
        month,
        year,
        dueDate
      }
    });

  } catch (error) {
    console.error('Generate invoices error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to generate invoices',
      error: error.message 
    });
  }
});

// Recalculate invoice statuses based on actual amount_paid vs amount_due
// Fixes cases where status is out of sync with the real payment data
router.post('/recalculate-status', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE invoices SET
        status = CASE
          WHEN amount_paid > amount_due THEN 'Overpaid'
          WHEN amount_due = 0 THEN 'Paid'
          WHEN amount_paid >= amount_due THEN 'Paid'
          WHEN amount_paid > 0            THEN 'Partial'
          ELSE 'Unpaid'
        END,
        updated_at = NOW()
      WHERE status IS DISTINCT FROM (
        CASE
          WHEN amount_paid > amount_due THEN 'Overpaid'
          WHEN amount_due = 0 THEN 'Paid'
          WHEN amount_paid >= amount_due THEN 'Paid'
          WHEN amount_paid > 0            THEN 'Partial'
          ELSE 'Unpaid'
        END
      )
      RETURNING id, status, student_number, amount_due, amount_paid, due_date
    `);

    console.log(`Recalculated status for ${result.rowCount} invoices`);

    res.json({
      success: true,
      message: result.rowCount > 0
        ? `Fixed ${result.rowCount} invoice${result.rowCount !== 1 ? 's' : ''} with incorrect status`
        : 'All invoice statuses are already correct — nothing to fix',
      fixed: result.rows
    });
  } catch (error) {
    console.error('Recalculate status error:', error);
    res.status(500).json({ success: false, message: 'Failed to recalculate statuses', error: error.message });
  }
});

// Audited correction for a service that should have been billed but has no
// authoritative persisted charge. It creates a new immutable invoice snapshot;
// it never edits or backfills an old invoice.
router.post('/reconcile-missing-charge', [
  authenticate,
  authorize('admin', 'super_admin'),
], async (req, res) => {
  const studentId = positiveInteger(req.body?.student_id);
  const serviceKey = String(req.body?.service_key || '').trim().toLowerCase();
  const amount = Number(req.body?.amount);
  const billingPeriod = String(req.body?.billing_period || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!studentId || !RECONCILABLE_SERVICES.has(serviceKey) ||
      !Number.isFinite(amount) || amount <= 0 ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod) ||
      reason.length < 10 || reason.length > 500) {
    return res.status(422).json({
      success: false,
      message: 'Learner, service, billing period, positive amount, and a reason of 10–500 characters are required.',
    });
  }

  const client = await db.pool.connect();
  let invoice;
  try {
    await client.query('BEGIN');
    const learner = (await client.query(`
      SELECT id, student_number, first_name, last_name
      FROM users
      WHERE id=$1::integer AND role='student' AND is_active=true
      FOR SHARE
    `, [studentId])).rows[0];
    if (!learner) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Active learner not found' });
    }
    const [year, month] = billingPeriod.split('-').map(Number);
    const dueDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const label = RECONCILABLE_SERVICES.get(serviceKey);
    const reference = `RECON-${learner.student_number}-${serviceKey.toUpperCase()}-${billingPeriod}`;
    invoice = (await client.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, due_date, status,
         reference_number, description, created_by, created_at)
      VALUES ($1::integer,$2,$3,$4::date,'Unpaid',$5,$6,$7::integer,NOW())
      RETURNING *
    `, [
      studentId, learner.student_number, amount.toFixed(2), dueDate, reference,
      `Reconciled ${label} charge — ${billingPeriod}`, Number(req.user.id),
    ])).rows[0];
    await client.query(`
      INSERT INTO invoice_line_items
        (invoice_id, line_type, service_key, label, description,
         quantity, unit_amount, amount, is_included, metadata)
      VALUES ($1::integer,'charge',$2,$3,$4,1,$5,$5,false,$6::jsonb)
    `, [
      Number(invoice.id), serviceKey, label, reason, amount.toFixed(2),
      JSON.stringify({
        source: 'admin_missing_charge_reconciliation',
        billing_period: billingPeriod,
      }),
    ]);
    await logAudit({
      executor: client,
      required: true,
      userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'missing_charge_reconciled',
      entityType: 'invoice',
      entityId: invoice.id,
      details: {
        student_id: studentId,
        service_key: serviceKey,
        billing_period: billingPeriod,
        amount: Number(amount.toFixed(2)),
        reason,
      },
      ipAddress: getIp(req),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Missing charge reconciliation error:', {
      message: error.message,
      code: error.code,
      service: serviceKey,
    });
    return res.status(500).json({ success: false, message: 'Failed to reconcile missing charge' });
  } finally {
    client.release();
  }
  await Promise.allSettled([notifyInvoice({
    invoiceId: invoice.id,
    learnerId: studentId,
    amount: invoice.amount_due,
  })]);
  return res.status(201).json({
    success: true,
    message: `${RECONCILABLE_SERVICES.get(serviceKey)} charge reconciled and added to the ledger`,
    invoice,
  });
});

// Classify an existing, line-less historical invoice.  This is deliberately
// separate from reconcile-missing-charge: it never creates an invoice and the
// line amount is copied from the authoritative invoice header.
router.post('/:id/classify-legacy', [
  authenticate,
  authorize('admin', 'super_admin'),
], async (req, res) => {
  const invoiceId = positiveInteger(req.params.id);
  const category = String(req.body?.category || req.body?.service_key || '').trim().toLowerCase();
  const reason = String(req.body?.reason || '').trim();
  if (!invoiceId || !LEGACY_CLASSIFICATION_SERVICES.has(category) ||
      reason.length < 10 || reason.length > 500) {
    return res.status(422).json({
      success: false,
      message: 'A valid invoice, recurring category, and a meaningful reason of 10–500 characters are required.',
    });
  }

  const client = await db.pool.connect();
  let classified;
  try {
    await client.query('BEGIN');
    // Acquire the shared advisory key before the invoice row lock. Parent
    // proof submission follows this same order, preventing a
    // classification-vs-proof deadlock under concurrency.
    await acquireInvoiceObligationLocks(client, [{
      invoiceId,
      category,
    }]);
    const invoiceResult = await client.query(`
      SELECT i.id, i.student_id, i.student_number, i.amount_due, i.amount_paid,
             i.outstanding_balance, i.overpaid_amount, i.due_date,
             i.reference_number, i.description, i.status
      FROM invoices i
      WHERE i.id = $1::integer
      FOR UPDATE
    `, [invoiceId]);
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const carryForwardSourceIds = await getCarryForwardSourceIds(client, [invoice]);
    if (carryForwardSourceIds.has(invoiceId)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Carried-forward source invoices and invoices with an active successor cannot be classified.',
      });
    }

    const amountDue = Number(invoice.amount_due);
    const amountPaid = Number(invoice.amount_paid);
    const outstanding = Math.max(amountDue - amountPaid, 0);
    if (!Number.isFinite(amountDue) || amountDue <= 0 || outstanding <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Only invoices with a positive outstanding balance can be classified.',
      });
    }

    const pendingResult = await client.query(`
      SELECT id, selected_obligations
      FROM pending_payments
      WHERE student_id = $1::integer AND status = 'pending'
    `, [invoice.student_id]);
    const pendingReferencesInvoice = pendingResult.rows.some((pending) => {
      let selected = pending.selected_obligations;
      if (typeof selected === 'string') {
        try { selected = JSON.parse(selected); } catch (_) { selected = []; }
      }
      selected = Array.isArray(selected) ? selected : [];
      return selected.some((item) => {
        const obligationId = String(item?.obligation_id || '');
        return Number(item?.invoice_id) === invoiceId ||
          obligationId === `invoice:${invoiceId}:legacy` ||
          obligationId.startsWith(`invoice:${invoiceId}:line:`);
      });
    });
    if (pendingReferencesInvoice) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This invoice has an active pending payment proof and cannot be classified until it is reviewed.',
      });
    }

    // Locking the invoice serializes this check with another classifier.  Any
    // line is existing immutable invoice evidence (including discounts and
    // included/adjustment rows) and must not be relabelled or supplemented by
    // this legacy-only action.
    const linesResult = await client.query(`
      SELECT id, line_type, service_key, metadata
      FROM invoice_line_items
      WHERE invoice_id = $1::integer
      ORDER BY id
    `, [invoiceId]);
    const alreadyClassified = linesResult.rows.some((line) => {
      const metadata = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
      return metadata.source === LEGACY_CLASSIFICATION_SOURCE ||
        metadata.legacy_reconciliation === true ||
        metadata.legacy_reconciliation === 'true';
    });
    if (alreadyClassified || linesResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This invoice already has an immutable charge snapshot or classification.',
      });
    }

    // Preserve a separate allocation snapshot as evidence.  The invoice
    // amount_paid remains authoritative; this total is never used to rewrite
    // the invoice or allocations.
    const allocationResult = await client.query(`
      SELECT pt.id, pt.amount,
             to_jsonb(pt)->>'allocation_category' AS allocation_category,
             pt.reverses_transaction_id,
             (reversal.id IS NOT NULL) AS is_reversed
      FROM payment_transactions pt
      LEFT JOIN payment_transactions reversal
        ON reversal.reverses_transaction_id = pt.id
      WHERE pt.invoice_id = $1::integer
        AND pt.reverses_transaction_id IS NULL
        AND reversal.id IS NULL
      ORDER BY pt.id
    `, [invoiceId]);
    const allocations = allocationResult.rows || [];
    const allocationCategories = [...new Set(
      allocations.map((row) => row.allocation_category).filter(Boolean),
    )];
    if (allocationCategories.length > 1 || (
      allocationCategories.length === 1 && allocationCategories[0] !== category
    )) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'This invoice has conflicting payment allocation categories and requires explicit reconciliation.',
      });
    }
    const allocation = {
      allocation_total: allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      allocation_count: allocations.length,
    };
    const headerSnapshot = {
      id: Number(invoice.id),
      student_id: Number(invoice.student_id),
      amount_due: String(invoice.amount_due),
      amount_paid: String(invoice.amount_paid),
      outstanding_balance: String(invoice.outstanding_balance ?? outstanding),
      overpaid_amount: String(invoice.overpaid_amount ?? Math.max(amountPaid - amountDue, 0)),
      due_date: invoice.due_date == null ? null : String(invoice.due_date).slice(0, 10),
      reference_number: invoice.reference_number || null,
      status: invoice.status || null,
    };
    const classifiedAt = new Date().toISOString();
    const metadata = {
      source: LEGACY_CLASSIFICATION_SOURCE,
      legacy_reconciliation: true,
      category,
      service_key: category,
      reason,
      actor_id: Number(req.user.id),
      actor_name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || null,
      classified_at: classifiedAt,
      previous_classification: null,
      immutable_header_snapshot: headerSnapshot,
      allocation_snapshot: {
        invoice_amount_paid: String(invoice.amount_paid),
        allocation_total: String(allocation.allocation_total),
        allocation_count: Number(allocation.allocation_count || 0),
      },
      payable_outstanding_before: outstanding,
    };
    const lineResult = await client.query(`
      INSERT INTO invoice_line_items
        (invoice_id, line_type, service_key, label, description,
         quantity, unit_amount, amount, is_included, metadata)
      VALUES ($1::integer, 'charge', $2, $3, $4,
              1, $5::numeric, $5::numeric, false, $6::jsonb)
      RETURNING id, invoice_id, line_type, service_key, label, description,
                amount, metadata
    `, [
      invoiceId,
      category,
      LEGACY_CLASSIFICATION_SERVICES.get(category),
      invoice.description || `Legacy ${LEGACY_CLASSIFICATION_SERVICES.get(category)} invoice`,
      invoice.amount_due,
      JSON.stringify(metadata),
    ]);

    // Validate through both canonical finance read models, not only arithmetic
    // based on the header. Any drift means the transaction must be rolled back.
    const payableAfter = await getPayableObligations(invoice.student_id, client);
    const payableMatch = payableAfter.find((obligation) =>
      Number(obligation.invoice_id) === invoiceId && obligation.category === category);
    const ledgerAfter = await getStudentLedger(invoice.student_id, client);
    const ledgerMatch = ledgerAfter?.invoices?.find((item) => Number(item.id) === invoiceId);
    if (!payableMatch || !payableMatch.is_payable ||
        Number(payableMatch.net_due) !== amountDue ||
        Number(payableMatch.amount_outstanding) !== outstanding ||
        payableMatch.reconciliation_state ||
        !ledgerMatch ||
        ledgerMatch.legacy_reconciliation?.state !== 'RECONCILED' ||
        ledgerMatch.legacy_reconciliation?.category !== category ||
        Number(ledgerMatch.net_due) !== amountDue ||
        Number(ledgerMatch.outstanding_balance) !== outstanding) {
      throw Object.assign(new Error('Canonical payable read models did not preserve the legacy invoice obligation'), {
        status: 409,
      });
    }

    const afterInvoiceResult = await client.query(`
      SELECT id, student_id, amount_due, amount_paid, outstanding_balance,
             overpaid_amount, due_date, reference_number, status
      FROM invoices
      WHERE id = $1::integer
    `, [invoiceId]);
    const after = afterInvoiceResult.rows[0];
    const same = after && headerSnapshot.id === Number(after.id) &&
      headerSnapshot.student_id === Number(after.student_id) &&
      headerSnapshot.amount_due === String(after.amount_due) &&
      headerSnapshot.amount_paid === String(after.amount_paid) &&
      headerSnapshot.outstanding_balance === String(after.outstanding_balance) &&
      headerSnapshot.overpaid_amount === String(after.overpaid_amount) &&
      headerSnapshot.due_date === (after.due_date == null ? null : String(after.due_date).slice(0, 10)) &&
      headerSnapshot.reference_number === (after.reference_number || null) &&
      headerSnapshot.status === (after.status || null);
    const afterAllocationResult = await client.query(`
      SELECT pt.id, pt.amount,
             to_jsonb(pt)->>'allocation_category' AS allocation_category,
             pt.reverses_transaction_id,
             (reversal.id IS NOT NULL) AS is_reversed
      FROM payment_transactions pt
      LEFT JOIN payment_transactions reversal
        ON reversal.reverses_transaction_id = pt.id
      WHERE pt.invoice_id = $1::integer
        AND pt.reverses_transaction_id IS NULL
        AND reversal.id IS NULL
      ORDER BY pt.id
    `, [invoiceId]);
    const afterAllocationRows = afterAllocationResult.rows || [];
    const afterAllocation = {
      allocation_total: afterAllocationRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      allocation_count: afterAllocationRows.length,
    };
    if (!same ||
        Number(lineResult.rows[0]?.amount) !== amountDue ||
        Math.max(Number(after.amount_due) - Number(after.amount_paid), 0) !== outstanding ||
        String(allocation.allocation_total) !== String(afterAllocation.allocation_total) ||
        Number(allocation.allocation_count || 0) !== Number(afterAllocation.allocation_count || 0)) {
      throw Object.assign(new Error('Invoice financial fields changed during legacy classification'), {
        status: 409,
      });
    }

    await logAudit({
      executor: client,
      required: true,
      userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'LEGACY_INVOICE_CLASSIFIED',
      entityType: 'invoice',
      entityId: invoiceId,
      details: {
        invoice_id: invoiceId,
        student_id: Number(invoice.student_id),
        previous_classification: null,
        new_classification: category,
        actor: { id: Number(req.user.id), name: metadata.actor_name, role: req.user.role },
        reason,
        classified_at: classifiedAt,
      },
      ipAddress: getIp(req),
    });
    await client.query('COMMIT');
    classified = {
      invoice: after,
      line: lineResult.rows[0],
      metadata: { ...metadata, payable_outstanding_after: outstanding },
      financial_invariants: {
        invoice_id: invoiceId,
        authoritative_amount_due: amountDue,
        authoritative_outstanding_before: outstanding,
        payable_net_due_after: amountDue,
        payable_outstanding_after: outstanding,
        unchanged: true,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status === 409 || error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: error.safeMessage || error.message || 'Invoice was classified concurrently; refresh and try again.',
      });
    }
    console.error('Legacy invoice classification error:', error);
    return res.status(500).json({ success: false, message: 'Failed to classify legacy invoice' });
  } finally {
    client.release();
  }
  return res.status(200).json({
    success: true,
    message: `Existing invoice classified as ${LEGACY_CLASSIFICATION_SERVICES.get(category)}`,
    ...classified,
  });
});

// Manual arrears entry: admin creates an arrears invoice for a specific student
router.post('/manual-arrears', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { studentNumber, amount, description, dueDate } = req.body;
    if (!studentNumber || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Student number and a positive amount are required' });
    }

    // Find student
    const studentResult = await db.query(
      `SELECT id, student_number, first_name, last_name FROM users WHERE student_number ILIKE $1 AND role = 'student' LIMIT 1`,
      [studentNumber]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: `No student found with number "${studentNumber}"` });
    }
    const student = studentResult.rows[0];

    const effectiveDueDate = dueDate || `${new Date().getFullYear()}-12-31`;
    const desc = description || 'Manual arrears entry';

    const result = await db.query(`
      INSERT INTO invoices (student_id, student_number, amount_due, due_date, status, reference_number, description, created_by, created_at)
      VALUES ($1, $2, $3, $4, 'Unpaid', $5, $6, $7, NOW())
      RETURNING *
    `, [student.id, student.student_number, parseFloat(amount), effectiveDueDate, student.student_number, desc, req.user.id]);

    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'manual_arrears_created',
      entityType: 'invoice', entityId: result.rows[0].id,
      details: {
        summary: `Manual arrears invoice of R${parseFloat(amount).toFixed(2)} for ${student.first_name} ${student.last_name}`,
        student: `${student.first_name} ${student.last_name}`, student_number: student.student_number,
        amount: parseFloat(amount), description: desc, due_date: effectiveDueDate
      },
      ipAddress: getIp(req)
    });
    await notifyInvoice({
      invoiceId: result.rows[0].id,
      learnerId: student.id,
      amount: result.rows[0].amount_due,
    });

    res.json({
      success: true,
      message: `Arrears invoice of R${parseFloat(amount).toFixed(2)} created for ${student.first_name} ${student.last_name} (${student.student_number})`,
      invoice: result.rows[0],
      student: { id: student.id, studentNumber: student.student_number, firstName: student.first_name, lastName: student.last_name }
    });
  } catch (error) {
    console.error('Manual arrears error:', error);
    res.status(500).json({ success: false, message: 'Failed to create arrears invoice', error: error.message });
  }
});

// Preview students with outstanding balances from a given year (for carry-forward)
router.get('/arrears-preview', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { year } = req.query;
    if (!year || isNaN(parseInt(year))) {
      return res.status(400).json({ success: false, message: 'A valid year is required' });
    }

    const result = await db.query(`
      SELECT
        u.id            AS student_id,
        u.student_number,
        u.first_name,
        u.last_name,
        SUM(i.outstanding_balance)  AS total_outstanding,
        COUNT(i.id)                 AS invoice_count
      FROM users u
      JOIN invoices i ON i.student_id = u.id
      WHERE u.role = 'student'
        AND EXTRACT(YEAR FROM i.due_date) = $1
        AND i.status NOT IN ('Paid', 'Overpaid', 'Carried Forward')
        AND i.outstanding_balance > 0
      GROUP BY u.id, u.student_number, u.first_name, u.last_name
      HAVING SUM(i.outstanding_balance) > 0
      ORDER BY u.student_number
    `, [parseInt(year)]);

    res.json({ success: true, students: result.rows, year: parseInt(year) });
  } catch (error) {
    console.error('Arrears preview error:', error);
    res.status(500).json({ success: false, message: 'Failed to load arrears preview', error: error.message });
  }
});

// Carry forward outstanding arrears from a previous year into a new invoice
router.post('/carry-forward', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { fromYear, dueDate, students } = req.body;

    if (!fromYear || !students || students.length === 0) {
      return res.status(400).json({ success: false, message: 'fromYear and at least one student are required' });
    }

    // Default due date to December 31 of the year being carried FROM (not the current year)
    const effectiveDueDate = dueDate || new Date(parseInt(fromYear), 11, 31);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const created = [];
      for (const s of students) {
        const amount = parseFloat(s.amount);
        if (!amount || amount <= 0) continue;

        // Create the arrears invoice in the current year
        const invoiceResult = await client.query(`
          INSERT INTO invoices (
            student_id, student_number, amount_due, due_date, status,
            reference_number, description, created_by, created_at
          ) VALUES ($1, $2, $3, $4, 'Unpaid', $5, $6, $7, NOW())
          RETURNING *
        `, [
          s.student_id,
          s.student_number,
          amount,
          effectiveDueDate,
          s.student_number,
          `Arrears from ${fromYear}`,
          req.user.id
        ]);
        created.push(invoiceResult.rows[0]);

        // Mark every source invoice in this aggregate as Carried Forward and
        // persist the lineage in the same transaction. Exclude the newly
        // created successor because its due date may share fromYear.
        await client.query(`
          UPDATE invoices
          SET status = 'Carried Forward',
              carried_forward_to_invoice_id = $1,
              updated_at = NOW()
          WHERE student_id = $2
            AND EXTRACT(YEAR FROM due_date) = $3
            AND id <> $1
            AND status NOT IN ('Paid', 'Overpaid', 'Carried Forward')
            AND outstanding_balance > 0
        `, [invoiceResult.rows[0].id, s.student_id, parseInt(fromYear)]);
      }

      await client.query('COMMIT');

      console.log(`Carried forward arrears for ${created.length} students from ${fromYear}`);
      await Promise.allSettled(created.map((invoice) => notifyInvoice({
        invoiceId: invoice.id,
        learnerId: invoice.student_id,
        amount: invoice.amount_due,
      })));

      await logAudit({
        userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        userRole: req.user.role, action: 'invoice_carry_forward',
        entityType: 'invoice', entityId: null,
        details: {
          summary: `Arrears carried forward for ${created.length} student(s) from ${fromYear}`,
          from_year: fromYear, students_count: created.length, due_date: effectiveDueDate
        },
        ipAddress: getIp(req)
      });

      res.json({
        success: true,
        message: `Arrears carried forward for ${created.length} student${created.length !== 1 ? 's' : ''} from ${fromYear}`,
        created
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Carry forward error:', error);
    res.status(500).json({ success: false, message: 'Failed to carry forward arrears', error: error.message });
  }
});

// Edit an arrears invoice (due_date, amount_due, description)
router.put('/:id/arrears', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('due_date').isISO8601().withMessage('Valid due date is required'),
  body('amount_due').optional().isFloat({ min: 0.01 }),
  body('description').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { id } = req.params;
    const { due_date, amount_due, description } = req.body;

    // Fetch the invoice first — only allow editing arrears/manual-arrears invoices
    const existing = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const inv = existing.rows[0];
    const isArrears = (inv.description || '').toLowerCase().includes('arrears') ||
                      inv.status === 'Carried Forward';
    if (!isArrears) {
      return res.status(403).json({ success: false, message: 'Only arrears invoices can be edited here.' });
    }

    const fields = ['due_date = $1', 'updated_at = NOW()'];
    const params = [due_date];
    let p = 2;

    if (amount_due !== undefined) {
      fields.push(`amount_due = $${p++}`);
      params.push(parseFloat(amount_due));
      // outstanding_balance is a generated column — PostgreSQL recalculates it automatically
    }
    if (description !== undefined) {
      fields.push(`description = $${p++}`);
      params.push(description);
    }

    params.push(parseInt(id));
    const result = await db.query(
      `UPDATE invoices SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      params
    );

    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'invoice_arrears_edit',
      entityType: 'invoice', entityId: parseInt(id),
      details: {
        summary: `Arrears invoice #${id} edited`,
        old_due_date: inv.due_date, new_due_date: due_date,
        old_amount: inv.amount_due, new_amount: amount_due || inv.amount_due,
        student_id: inv.student_id
      },
      ipAddress: getIp(req)
    });

    res.json({ success: true, message: 'Arrears invoice updated', invoice: result.rows[0] });
  } catch (error) {
    console.error('Edit arrears invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to update arrears invoice', error: error.message });
  }
});

// Get all invoices with filtering and pagination
// Per-learner finance view.  This intentionally delegates to the same ledger
// model as the Parent Portal instead of re-summing payment_transactions.
router.get('/ledger/:studentId', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const studentId = Number.parseInt(req.params.studentId, 10);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid student ID' });
    }
    const ledger = await getStudentLedger(studentId);
    if (!ledger) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, ...ledger });
  } catch (error) {
    console.error('Get finance ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch finance ledger' });
  }
});

router.get('/', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    let filters;
    try {
      filters = parseInvoiceListQuery(req.query);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    const {
      status, month, year, studentNumber, page, limit, sortBy, sortOrder,
    } = filters;

    // First, let's get the total count of active students
    const studentCountQuery = `
      SELECT COUNT(*) as total_students
      FROM users 
      WHERE role = 'student' AND is_active = true
    `;
    const studentCountResult = await db.query(studentCountQuery);
    const totalStudents = parseInt(studentCountResult.rows[0].total_students);

    // Get invoices query - corrected to use users table
    let query = `
      SELECT 
        i.id, i.student_id, i.student_number, i.amount_due, i.amount_paid, 
        i.outstanding_balance, i.overpaid_amount, i.due_date, i.status, 
        i.reference_number, i.description, i.created_at, i.updated_at,
        u.first_name, u.last_name, u.grade_id, u.class_id,
        g.name as grade_name, c.name as class_name
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    // Add filters
    if (status) {
      paramCount++;
      query += ` AND ${invoiceStatusExpression('i')} = $${paramCount}`;
      queryParams.push(status);
    }

    const invoicePeriodClauses = [];
    appendPeriodFilters(invoicePeriodClauses, queryParams, 'i.due_date', { month, year });
    for (const clause of invoicePeriodClauses) {
      paramCount++;
      query += ` AND ${clause}`;
    }

    if (studentNumber) {
      paramCount++;
      query += ` AND i.student_number ILIKE $${paramCount}`;
      queryParams.push(`%${studentNumber}%`);
    }

    // Add sorting
    query += ` ORDER BY i.${sortBy} ${sortOrder}`;

    // Add pagination
    const offset = (page - 1) * limit;
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    console.log('Invoices query:', query);
    console.log('Query params:', queryParams);

    const result = await db.query(query, queryParams);
    result.rows = result.rows.map((invoice) => ({
      ...invoice,
      status: invoiceStatus(invoice.amount_due, invoice.amount_paid, invoice.status),
      outstanding_balance: Math.max((Number(invoice.amount_due) || 0) - (Number(invoice.amount_paid) || 0), 0),
      overpaid_amount: Math.max((Number(invoice.amount_paid) || 0) - (Number(invoice.amount_due) || 0), 0),
    }));
    const invoiceIds = result.rows.map((invoice) => invoice.id);
    const lineData = await loadInvoiceLineItems(db, invoiceIds);
    const carryForwardSourceIds = await getCarryForwardSourceIds(db, result.rows);
    const linesByInvoice = new Map();
    lineData.rows.forEach((line) => {
      const key = Number(line.invoice_id);
      if (!linesByInvoice.has(key)) linesByInvoice.set(key, []);
      linesByInvoice.get(key).push(line);
    });
    let paymentRows = [];
    if (invoiceIds.length) {
      try {
        const payments = await db.query(`
          SELECT id, invoice_id, month, year
          FROM payment_transactions
          WHERE invoice_id = ANY($1::integer[])
        `, [invoiceIds]);
        paymentRows = payments.rows;
      } catch (error) {
        if (!/^Unexpected .*query:/.test(error.message || '') &&
            error.code !== '42P01' && error.code !== '42703') throw error;
      }
    }
    const flagsByInvoice = new Map();
    paymentRows.forEach((payment) => {
      const invoice = result.rows.find((item) => Number(item.id) === Number(payment.invoice_id));
      if (!invoice || payment.month == null || payment.year == null || !invoice.due_date) return;
      const date = new Date(invoice.due_date);
      if (Number(payment.month) === date.getUTCMonth() + 1 &&
          Number(payment.year) === date.getUTCFullYear()) return;
      if (!flagsByInvoice.has(Number(invoice.id))) flagsByInvoice.set(Number(invoice.id), []);
      flagsByInvoice.get(Number(invoice.id)).push({
        type: 'transaction_month_mismatch',
        transaction_id: payment.id,
        transaction_month: Number(payment.month),
        transaction_year: Number(payment.year),
      });
    });
    result.rows = result.rows.map((invoice) => ({
      ...(() => {
        const lineItems = linesByInvoice.get(Number(invoice.id)) || [];
        const classifiedLine = lineItems.find((line) => {
          const metadata = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
          return metadata.source === LEGACY_CLASSIFICATION_SOURCE ||
            metadata.legacy_reconciliation === true ||
            metadata.legacy_reconciliation === 'true';
        });
        const metadata = classifiedLine?.metadata || {};
        const carryForwardHistory = carryForwardSourceIds.has(Number(invoice.id)) ||
          invoice.status === 'Carried Forward';
        return {
          ...buildInvoiceBreakdown(invoice, lineItems, flagsByInvoice.get(Number(invoice.id)) || []),
          legacy_reconciliation: !carryForwardHistory && classifiedLine ? {
            state: 'RECONCILED',
            category: metadata.category || classifiedLine.service_key,
            service_key: metadata.service_key || classifiedLine.service_key,
            actor_id: metadata.actor_id == null ? null : Number(metadata.actor_id),
            actor_name: metadata.actor_name || null,
            classified_at: metadata.classified_at || null,
            reason: metadata.reason || null,
            previous_classification: metadata.previous_classification ?? null,
          } : null,
          reconciliation_state: carryForwardHistory ? null : (
            classifiedLine ? 'RECONCILED' : (
              !lineData.available ||
              lineItems.some((line) => String(line.line_type || '').toLowerCase() === 'charge') ||
              Number(invoice.amount_due || 0) <= Number(invoice.amount_paid || 0)
                ? null
                : 'REQUIRES_RECONCILIATION'
            )
          ),
          carry_forward_history: carryForwardHistory,
        };
      })(),
      snapshot_available: lineData.available && (linesByInvoice.get(Number(invoice.id)) || []).length > 0,
      snapshot_unavailable_reason: lineData.available
        ? ((linesByInvoice.get(Number(invoice.id)) || []).length ? null : 'No persisted invoice line-item snapshot')
        : 'Invoice line-item schema is not installed',
    }));
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      WHERE 1=1
    `;
    
    const countParams = [];
    let countParamIndex = 0;

    if (status) {
      countParamIndex++;
      countQuery += ` AND ${invoiceStatusExpression('i')} = $${countParamIndex}`;
      countParams.push(status);
    }

    const countPeriodClauses = [];
    appendPeriodFilters(countPeriodClauses, countParams, 'i.due_date', { month, year });
    for (const clause of countPeriodClauses) {
      countParamIndex++;
      countQuery += ` AND ${clause}`;
    }

    if (studentNumber) {
      countParamIndex++;
      countQuery += ` AND i.student_number ILIKE $${countParamIndex}`;
      countParams.push(`%${studentNumber}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalInvoices = parseInt(countResult.rows[0].total);

    // Derive dashboard totals from the same authoritative finance model used
    // by Parent and the per-student ledger. This also excludes carry-forward
    // source invoices while retaining them in the history list.
    const financeSummary = await getFinanceSummary({
      status,
      month,
      year,
      studentNumber,
    });

    res.json({
      success: true,
      invoices: result.rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalInvoices / limit),
        totalInvoices,
        limit
      },
      summary: {
        totalStudents, // Add total students count here
        totalInvoices: financeSummary.totalInvoices,
        paidCount: financeSummary.paidCount,
        unpaidCount: financeSummary.unpaidCount,
        partialCount: financeSummary.partialCount,
        overpaidCount: financeSummary.overpaidCount,
        totalAmountDue: financeSummary.totalAmountDue,
        totalAmountPaid: financeSummary.totalAmountPaid,
        totalOutstanding: financeSummary.totalOutstanding,
        totalOverpaid: financeSummary.totalOverpaid,
        overpaid: financeSummary.totalOverpaid,
        unallocated: financeSummary.unallocated,
        credit: financeSummary.credit,
        netOutstanding: financeSummary.netOutstanding
      }
    });

  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message 
    });
  }
});

// Upload and process bank statement CSV
router.post('/process-bank-statement', [
  authenticate,
  authorize('admin', 'super_admin'),
  upload.single('bankStatement')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No CSV file uploaded' 
      });
    }

    console.log('Processing bank statement:', req.file.filename);

    const transactions = [];
    const errors = [];
    const results = {
      matched: [],
      partial: [],
      overpaid: [],
      unmatched: [],
      duplicates: [],
      errors: []
    };

    // Parse CSV file with enhanced column detection
    await new Promise((resolve, reject) => {
      let headerProcessed = false;
      let columnMapping = {};
      
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('headers', (headers) => {
          console.log('CSV Headers detected:', headers);
          
          // Create flexible column mapping
          headers.forEach((header, index) => {
            const normalizedHeader = header.toLowerCase().trim();
            
            // Map reference variations
            if (normalizedHeader.includes('ref') || 
                normalizedHeader.includes('student') || 
                normalizedHeader.includes('number') ||
                normalizedHeader === 'id') {
              columnMapping.reference = header;
            }
            
            // Map amount variations
            if (normalizedHeader.includes('amount') || 
                normalizedHeader.includes('value') || 
                normalizedHeader.includes('sum') ||
                normalizedHeader.includes('total') ||
                normalizedHeader.includes('payment')) {
              columnMapping.amount = header;
            }
            
            // Map date variations
            if (normalizedHeader.includes('date') || 
                normalizedHeader.includes('time') ||
                normalizedHeader.includes('when')) {
              columnMapping.date = header;
            }
            
            // Map description variations
            if (normalizedHeader.includes('desc') || 
                normalizedHeader.includes('note') || 
                normalizedHeader.includes('comment') ||
                normalizedHeader.includes('detail') ||
                normalizedHeader.includes('memo')) {
              columnMapping.description = header;
            }
          });
          
          console.log('Column mapping:', columnMapping);
        })
        .on('data', (row) => {
          try {
            // Skip empty rows
            const rowValues = Object.values(row).filter(val => val && val.trim());
            if (rowValues.length === 0) {
              return;
            }
            
            console.log('Processing row:', row);
            
            // Extract data using flexible mapping
            let reference = '';
            let amount = 0;
            let date = null;
            let description = '';
            
            // Try to find reference
            if (columnMapping.reference) {
              reference = row[columnMapping.reference];
            } else {
              // Fallback: look for any field that looks like a reference
              const possibleRefs = Object.keys(row).filter(key => 
                key.toLowerCase().includes('ref') || 
                key.toLowerCase().includes('student') ||
                key.toLowerCase().includes('number')
              );
              if (possibleRefs.length > 0) {
                reference = row[possibleRefs[0]];
              }
            }
            
            // Try to find amount
            if (columnMapping.amount) {
              let amountStr = row[columnMapping.amount];
              // Clean the amount string - remove commas, spaces, and currency symbols
              amountStr = amountStr.toString().replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
              amount = parseFloat(amountStr);
              console.log(`Amount parsing: "${row[columnMapping.amount]}" -> "${amountStr}" -> ${amount}`);
            } else {
              // Fallback: look for any numeric field that could be amount
              for (const [key, value] of Object.entries(row)) {
                let cleanValue = value.toString().replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
                const numValue = parseFloat(cleanValue);
                if (!isNaN(numValue) && numValue > 0) {
                  amount = numValue;
                  console.log(`Fallback amount parsing: "${value}" -> "${cleanValue}" -> ${numValue}`);
                  break;
                }
              }
            }
            
            // Try to find date
            if (columnMapping.date) {
              date = new Date(row[columnMapping.date]);
            } else {
              // Fallback: look for any field that looks like a date
              const possibleDates = Object.keys(row).filter(key => 
                key.toLowerCase().includes('date') || 
                key.toLowerCase().includes('time')
              );
              if (possibleDates.length > 0) {
                date = new Date(row[possibleDates[0]]);
              }
            }
            
            // Description is optional
            if (columnMapping.description) {
              description = row[columnMapping.description] || '';
            }
            
            // Clean and validate reference
            reference = String(reference || '').trim();
            
            // If no clear reference found, try to extract from description
            if (!reference && description) {
              // Look for patterns like "Grade X", "Gr X", student names, etc.
              const descLower = description.toLowerCase();
              
              // Try to extract student number patterns
              const studentNumMatch = description.match(/\b\d{6,7}\b/); // 6-7 digit student numbers
              if (studentNumMatch) {
                reference = studentNumMatch[0];
              }
              // Try to extract grade references that might map to student numbers
              else if (descLower.includes('grade') || descLower.includes('gr')) {
                // Extract names before "Grade" or "Gr"
                const nameMatch = description.match(/([A-Za-z\s]+)\s+(Grade?|Gr\.?)/i);
                if (nameMatch) {
                  reference = nameMatch[1].trim();
                }
              }
              // Last resort: use the full description as reference for manual review
              else {
                reference = description.trim();
              }
            }
            
            // Validate transaction data
            if (!reference) {
              errors.push(`Missing reference in row: ${JSON.stringify(row)}`);
              return;
            }
            
            if (isNaN(amount) || amount <= 0) {
              errors.push(`Invalid amount in row: ${JSON.stringify(row)}`);
              return;
            }
            
            if (!date || isNaN(date.getTime())) {
              // Try current date as fallback
              date = new Date();
              console.log('Using current date as fallback for row:', row);
            }

            const transaction = {
              reference,
              amount,
              date,
              description: String(description || '').trim()
            };
            
            console.log('Parsed transaction:', transaction);
            transactions.push(transaction);
            
          } catch (error) {
            console.error('Error parsing row:', error);
            errors.push(`Error parsing row: ${JSON.stringify(row)} - ${error.message}`);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Parsed ${transactions.length} transactions from CSV`);
    console.log('Sample transactions:', transactions.slice(0, 3));
    console.log('Parsing errors:', errors);

    if (transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid transactions found in CSV file',
        errors,
        debug: {
          fileSize: req.file.size,
          fileName: req.file.filename,
          mimetype: req.file.mimetype
        }
      });
    }

    // Process each transaction with better error handling
    console.log('Starting transaction processing...');
    
    for (const transaction of transactions) {
      // Start a database transaction for each payment
      const client = await db.pool.connect();
      
      try {
        await client.query('BEGIN');
        console.log(`Processing transaction: ${JSON.stringify(transaction)}`);
        
        // Check for duplicate transactions
        const duplicateCheck = await client.query(`
          SELECT id FROM payment_transactions 
          WHERE reference_number = $1 AND amount = $2 AND payment_date = $3
        `, [transaction.reference, transaction.amount, transaction.date]);

        if (duplicateCheck.rows.length > 0) {
          results.duplicates.push({
            ...transaction,
            reason: 'Duplicate transaction already processed'
          });
          await client.query('ROLLBACK');
          continue;
        }

        // Find matching invoice with improved reference matching
        console.log(`Looking for invoice with reference: "${transaction.reference}"`);
        
        // Try exact match first
        let invoiceResult = await client.query(`
          SELECT * FROM invoices 
          WHERE reference_number = $1 AND status IN ('Unpaid', 'Partial')
          ORDER BY due_date ASC
          LIMIT 1
        `, [transaction.reference]);

        // If no exact match, try normalized matching
        if (invoiceResult.rows.length === 0) {
          // Normalize reference number (pad with zeros for numeric values)
          const normalizedRef = transaction.reference.toString().padStart(3, '0');
          console.log(`Trying normalized reference: "${normalizedRef}"`);
          
          invoiceResult = await client.query(`
            SELECT * FROM invoices 
            WHERE reference_number = $1 AND status IN ('Unpaid', 'Partial')
            ORDER BY due_date ASC
            LIMIT 1
          `, [normalizedRef]);
        }

        // If still no match, try removing leading zeros
        if (invoiceResult.rows.length === 0) {
          const trimmedRef = transaction.reference.toString().replace(/^0+/, '') || '0';
          console.log(`Trying trimmed reference: "${trimmedRef}"`);
          
          invoiceResult = await client.query(`
            SELECT * FROM invoices 
            WHERE reference_number = $1 AND status IN ('Unpaid', 'Partial')
            ORDER BY due_date ASC
            LIMIT 1
          `, [trimmedRef]);
        }

        // Debug: Show available references if no match found
        if (invoiceResult.rows.length === 0) {
          const availableRefs = await client.query(`
            SELECT reference_number, status FROM invoices 
            WHERE status IN ('Unpaid', 'Partial') 
            LIMIT 10
          `);
          console.log('Available invoice references:', availableRefs.rows.map(r => r.reference_number));
        }

        if (invoiceResult.rows.length === 0) {
          // For unmatched transactions, just count them (don't insert to DB due to NOT NULL constraints)
          console.log(`UNMATCHED: Transaction ${transaction.reference} - ${transaction.description}`);
          
          await client.query('COMMIT');
          
          // Add to results AFTER successful commit
          results.unmatched.push({
            ...transaction,
            reason: 'No matching invoice found'
          });
          continue;
        }

        const invoice = invoiceResult.rows[0];

        console.log(`Invoice found: ${invoice.reference_number}`);

        const allocation = await allocatePayment(client, {
          studentId: invoice.student_id,
          amount: transaction.amount,
          paymentDate: transaction.date,
          paymentMethod: 'bank_transfer',
          reference: transaction.reference,
          description: transaction.description,
          recordedBy: req.user.id,
        });
        const overpayment = allocation.allocations.find((item) => item.invoiceId == null);
        const applied = allocation.allocations
          .filter((item) => item.invoiceId != null)
          .reduce((sum, item) => sum + item.amount, 0);
        const resultCategory = overpayment
          ? 'overpaid'
          : allocation.allocations.some((item) => item.status === 'Partial')
            ? 'partial'
            : 'matched';
        const updatedInvoice = await client.query(
          'SELECT outstanding_balance FROM invoices WHERE id = $1',
          [invoice.id],
        );
        
        // Commit the transaction
        await client.query('COMMIT');
        console.log(`Successfully processed transaction for ${transaction.reference}`);
        await Promise.allSettled(allocation.allocations.map((item) => notifyPayment({
          kind: 'applied',
          paymentId: item.transactionId,
          learnerId: invoice.student_id,
          amount: item.amount,
        })));

        // Add to results AFTER successful commit
        if (resultCategory === 'matched') {
          results.matched.push({ ...transaction, invoice: invoice.reference_number });
        } else if (resultCategory === 'overpaid') {
          results.overpaid.push({ 
            ...transaction, 
            invoice: invoice.reference_number,
            overpaidAmount: overpayment?.amount || 0,
          });
        } else if (resultCategory === 'partial') {
          results.partial.push({ 
            ...transaction, 
            invoice: invoice.reference_number,
            remainingBalance: parseFloat(updatedInvoice.rows[0]?.outstanding_balance) || 0,
            appliedAmount: applied,
          });
        }

      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Transaction processing error:', error);
        results.errors.push({
          ...transaction,
          error: error.message
        });
      } finally {
        client.release();
      }
    }

    // Log upload activity - match actual database schema
    try {
      await db.query(`
        INSERT INTO payment_upload_logs (
          filename, uploaded_by, transactions_processed, 
          matched_count, partial_count, overpaid_count,
          unmatched_count, duplicate_count, error_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        req.file.filename,
        req.user.id,
        transactions.length,
        results.matched.length,
        results.partial.length,
        results.overpaid.length,
        results.unmatched.length,
        results.duplicates.length,
        results.errors.length
      ]);
      console.log('Upload log recorded successfully');
    } catch (logError) {
      console.error('Failed to log upload activity:', logError);
      // Don't fail the entire process if logging fails
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log('\n=== PROCESSING RESULTS SUMMARY ===');
    console.log(`Total transactions processed: ${transactions.length}`);
    console.log(`Matched: ${results.matched.length}`);
    console.log(`Partial: ${results.partial.length}`);
    console.log(`Overpaid: ${results.overpaid.length}`);
    console.log(`Unmatched: ${results.unmatched.length}`);
    console.log(`Duplicates: ${results.duplicates.length}`);
    console.log(`Errors: ${results.errors.length}`);
    console.log('=====================================\n');

    res.json({
      success: true,
      message: `Processed ${transactions.length} transactions successfully`,
      summary: {
        totalProcessed: transactions.length,
        matched: results.matched.length,
        partial: results.partial.length,
        overpaid: results.overpaid.length,
        unmatched: results.unmatched.length,
        duplicates: results.duplicates.length,
        errors: results.errors.length
      },
      results
    });

  } catch (error) {
    console.error('Bank statement processing error:', error);
    console.error('Error stack:', error.stack);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('Cleaned up uploaded file');
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process bank statement',
      error: error.message,
      debug: {
        fileName: req.file?.filename,
        fileSize: req.file?.size,
        errorType: error.constructor.name,
        errorStack: error.stack
      }
    });
  }
});

// Get payment transactions with filtering
router.get('/transactions', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { 
      status, 
      referenceNumber, 
      dateFrom, 
      dateTo,
      page = 1, 
      limit = 50 
    } = req.query;

    let query = `
      SELECT 
        pt.id, pt.invoice_id, pt.reference_number, pt.amount, 
        pt.payment_date, pt.description, pt.created_at,
        i.student_number, i.amount_due, i.status as invoice_status,
        s.first_name, s.last_name
      FROM payment_transactions pt
      LEFT JOIN invoices i ON pt.invoice_id = i.id
      LEFT JOIN students s ON i.student_id = s.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND pt.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (referenceNumber) {
      paramCount++;
      query += ` AND pt.reference_number ILIKE $${paramCount}`;
      queryParams.push(`%${referenceNumber}%`);
    }

    if (dateFrom) {
      paramCount++;
      query += ` AND pt.payment_date >= $${paramCount}`;
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      paramCount++;
      query += ` AND pt.payment_date <= $${paramCount}`;
      queryParams.push(dateTo);
    }

    query += ` ORDER BY pt.payment_date DESC, pt.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await db.query(query, queryParams);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM payment_transactions pt WHERE 1=1`;
    const countParams = [];
    let countParamIndex = 0;

    if (status) {
      countParamIndex++;
      countQuery += ` AND pt.status = $${countParamIndex}`;
      countParams.push(status);
    }

    if (referenceNumber) {
      countParamIndex++;
      countQuery += ` AND pt.reference_number ILIKE $${countParamIndex}`;
      countParams.push(`%${referenceNumber}%`);
    }

    if (dateFrom) {
      countParamIndex++;
      countQuery += ` AND pt.payment_date >= $${countParamIndex}`;
      countParams.push(dateFrom);
    }

    if (dateTo) {
      countParamIndex++;
      countQuery += ` AND pt.payment_date <= $${countParamIndex}`;
      countParams.push(dateTo);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalTransactions = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      transactions: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalTransactions / parseInt(limit)),
        totalTransactions,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
});

// Export invoices to CSV
router.get('/export/csv', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    let filters;
    try {
      filters = parseInvoiceFilterQuery(req.query);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    const { status, month, year, studentNumber } = filters;
    const clauses = [];
    const queryParams = [];
    if (status) {
      queryParams.push(status);
      clauses.push(`${invoiceStatusExpression('i')} = $${queryParams.length}`);
    }
    appendPeriodFilters(clauses, queryParams, 'i.due_date', { month, year });
    if (studentNumber) {
      queryParams.push(`%${studentNumber}%`);
      clauses.push(`i.student_number ILIKE $${queryParams.length}`);
    }

    const query = `
      SELECT 
        i.id, i.reference_number, u.first_name, u.last_name, i.student_number,
        i.description, i.amount_due, i.amount_paid, i.due_date, i.status,
        i.created_at, i.updated_at,
        g.name as grade_name, c.name as class_name
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE ${clauses.length ? clauses.join(' AND ') : 'TRUE'}
      ORDER BY i.due_date DESC, i.id DESC
    `;

    const result = await db.query(query, queryParams);
    const invoiceIds = result.rows.map((row) => Number(row.id));
    const lineData = await loadInvoiceLineItems(db, invoiceIds);
    const linesByInvoice = new Map();
    lineData.rows.forEach((line) => {
      const id = Number(line.invoice_id);
      if (!linesByInvoice.has(id)) linesByInvoice.set(id, []);
      linesByInvoice.get(id).push(line);
    });
    const projectedRows = result.rows.map((row) => buildInvoiceBreakdown(
      row,
      linesByInvoice.get(Number(row.id)) || [],
    ));

    // Generate CSV content
    const csvHeaders = [
      'Reference Number', 'Student Number', 'First Name', 'Last Name',
      'Grade', 'Class', 'Description', 'Amount Due', 'Amount Paid', 'Outstanding Balance',
      'Overpaid Amount', 'Due Date', 'Status', 'Created', 'Updated'
    ];

    let csvContent = csvHeaders.join(',') + '\n';

    projectedRows.forEach(row => {
      const statusValue = invoiceStatus(row.amount_due, row.amount_paid, row.status);
      const csvRow = [
        csvText(row.reference_number),
        csvText(row.student_number),
        csvText(row.first_name),
        csvText(row.last_name),
        csvText(row.grade_name),
        csvText(row.class_name),
        csvText(row.description),
        csvNumber(row.net_due),
        csvNumber(row.allocated_effective_payments),
        csvNumber(row.outstanding_balance),
        csvNumber(row.credit),
        csvText(dateOnly(row.due_date)),
        csvText(statusValue),
        csvText(dateOnly(row.created_at)),
        csvText(dateOnly(row.updated_at)),
      ].join(',');
      
      csvContent += csvRow + '\n';
    });

    const filename = `invoices-export-${Date.now()}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Export CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export invoices',
      error: error.message
    });
  }
});

// Clear all invoices (admin only)
router.delete('/clear-all', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  // Finance events are immutable. Corrections must use the audited reversal
  // flow; this legacy destructive endpoint must never erase payment history.
  return res.status(410).json({
    success: false,
    message: 'Destructive invoice clearing is disabled; use audited reversals and corrections',
  });
});

// Database migration endpoint - SUPER ADMIN ONLY
router.post('/migrate-database', [
  (req, res, next) => {
    if (process.env.ENABLE_HTTP_MIGRATIONS !== 'true' || process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' });
    }
    next();
  },
  authenticate,
  authorize('super_admin')
], async (req, res) => {
  try {
    console.log('🔄 Starting comprehensive database migration...');
    
    let migrationResults = [];
    
    // 1. Fix payment_transactions table
    console.log('Step 1: Fixing payment_transactions table...');
    
    // Check current columns
    const currentColumns = await db.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions'
      ORDER BY ordinal_position
    `);
    
    console.log('Current payment_transactions columns:', currentColumns.rows.map(r => r.column_name));
    migrationResults.push(`Current columns: ${currentColumns.rows.map(r => r.column_name).join(', ')}`);
    
    const hasTransactionDate = currentColumns.rows.some(r => r.column_name === 'transaction_date');
    const hasPaymentDate = currentColumns.rows.some(r => r.column_name === 'payment_date');
    
    // Fix payment_date column - code expects payment_date but production has transaction_date
    if (hasTransactionDate && !hasPaymentDate) {
      console.log('Renaming transaction_date to payment_date...');
      await db.query(`ALTER TABLE payment_transactions RENAME COLUMN transaction_date TO payment_date`);
      migrationResults.push('✅ Renamed transaction_date to payment_date');
    } else if (!hasPaymentDate) {
      console.log('Adding payment_date column...');
      await db.query(`ALTER TABLE payment_transactions ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE`);
      migrationResults.push('✅ Added payment_date column');
    } else {
      migrationResults.push('✅ payment_date column already exists');
    }
    
    // 2. Fix payment_upload_logs table
    console.log('Step 2: Fixing payment_upload_logs table...');
    
    const uploadLogColumns = await db.query(`
      SELECT column_name
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs'
      ORDER BY ordinal_position
    `);
    
    console.log('Current payment_upload_logs columns:', uploadLogColumns.rows.map(r => r.column_name));
    
    const hasTransactionsProcessed = uploadLogColumns.rows.some(r => r.column_name === 'transactions_processed');
    
    if (!hasTransactionsProcessed) {
      console.log('Recreating payment_upload_logs table with correct schema...');
      
      // Drop and recreate the table
      await db.query(`DROP TABLE IF EXISTS payment_upload_logs CASCADE`);
      
      await db.query(`
        CREATE TABLE payment_upload_logs (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          uploaded_by INTEGER NOT NULL,
          transactions_processed INTEGER DEFAULT 0,
          matched_count INTEGER DEFAULT 0,
          partial_count INTEGER DEFAULT 0,
          overpaid_count INTEGER DEFAULT 0,
          unmatched_count INTEGER DEFAULT 0,
          duplicate_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      
      migrationResults.push('✅ Recreated payment_upload_logs table with correct schema');
    } else {
      migrationResults.push('✅ payment_upload_logs table already has correct schema');
    }
    
    // 3. Test the fixed schema
    console.log('Step 3: Testing the fixed schema...');
    
    try {
      // Payment transactions are immutable after the integrity migration.
      // Schema verification must not create and delete a historical event.
      await db.query(`
        SELECT payment_date
        FROM payment_transactions
        LIMIT 0
      `);
      
      // Test payment_upload_logs
      await db.query(`
        INSERT INTO payment_upload_logs (
          filename, uploaded_by, transactions_processed, 
          matched_count, partial_count, overpaid_count,
          unmatched_count, duplicate_count, error_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, ['test-migration.csv', 1, 1, 1, 0, 0, 0, 0, 0]);
      
      // Clean up only the non-financial schema test row.
      await db.query(`DELETE FROM payment_upload_logs WHERE filename = 'test-migration.csv'`);
      
      migrationResults.push('✅ Schema test successful - both tables working correctly');
      
    } catch (testError) {
      migrationResults.push(`❌ Schema test failed: ${testError.message}`);
    }
    
    // 4. Show final schema
    const finalPaymentTransactions = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    const finalUploadLogs = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs' 
      ORDER BY ordinal_position
    `);
    
    res.json({
      success: true,
      message: 'Comprehensive database migration completed successfully',
      migrationResults,
      finalSchemas: {
        payment_transactions: finalPaymentTransactions.rows,
        payment_upload_logs: finalUploadLogs.rows
      }
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Database migration failed',
      error: error.message
    });
  }
});

// ─── DELETE pre-enrollment invoices ──────────────────────────────────────────
// Removes invoices that were created for months BEFORE a student's enrollment
// date (their created_at month). These are "ghost" invoices that should never
// have existed for mid-year enrollees.
router.delete('/cleanup-pre-enrollment', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    // Dry run by default; pass ?confirm=true to actually delete
    const dryRun = req.query.confirm !== 'true';

    const previewResult = await db.query(`
      SELECT
        i.id,
        i.student_number,
        u.first_name,
        u.last_name,
        i.due_date,
        i.status,
        i.amount_due,
        i.amount_paid,
        DATE_TRUNC('month', u.created_at) AS enrollment_month
      FROM invoices i
      JOIN users u ON i.student_id = u.id
      WHERE u.role = 'student'
        AND i.due_date < DATE_TRUNC('month', u.created_at)
        AND i.amount_paid = 0
      ORDER BY u.last_name, u.first_name, i.due_date
    `);

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        message: `Found ${previewResult.rows.length} pre-enrollment invoices that can be deleted. Add ?confirm=true to proceed.`,
        invoices: previewResult.rows
      });
    }

    // Only delete invoices with zero payment (never touched)
    const deleteResult = await db.query(`
      DELETE FROM invoices
      WHERE id IN (
        SELECT i.id
        FROM invoices i
        JOIN users u ON i.student_id = u.id
        WHERE u.role = 'student'
          AND i.due_date < DATE_TRUNC('month', u.created_at)
          AND i.amount_paid = 0
      )
      RETURNING id, student_number, due_date
    `);

    console.log(`Admin ${req.user.email} deleted ${deleteResult.rows.length} pre-enrollment invoices`);

    res.json({
      success: true,
      dryRun: false,
      deleted: deleteResult.rows.length,
      message: `Successfully deleted ${deleteResult.rows.length} pre-enrollment invoices (unpaid only).`,
      deletedInvoices: deleteResult.rows
    });

  } catch (error) {
    console.error('Cleanup pre-enrollment invoices error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── DELETE single invoice by ID ─────────────────────────────────────────────
// Safety: only deletes if amount_paid = 0 (never touched by a real payment)
router.delete('/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  const { id } = req.params;
  try {
    // Verify the invoice exists and has no payments
    const check = await db.query(
      `SELECT i.id, i.student_number, i.due_date, i.amount_paid, i.status
       FROM invoices i
       WHERE i.id = $1`,
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoice = check.rows[0];
    if (parseFloat(invoice.amount_paid) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an invoice that has payments recorded against it'
      });
    }

    await db.query('DELETE FROM invoices WHERE id = $1', [id]);

    console.log(`Admin ${req.user.email} deleted invoice ${id} (${invoice.student_number}, due: ${invoice.due_date})`);

    res.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Delete single invoice error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
