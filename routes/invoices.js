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
const { parseInvoiceListQuery, appendPeriodFilters } = require('../utils/invoiceQuery');

const router = express.Router();

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
      ...buildInvoiceBreakdown(invoice, linesByInvoice.get(Number(invoice.id)) || [],
        flagsByInvoice.get(Number(invoice.id)) || []),
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
    const { status, month, year } = req.query;

    let query = `
      SELECT 
        i.reference_number, u.first_name, u.last_name, i.student_number,
        i.amount_due, i.amount_paid, i.outstanding_balance, i.overpaid_amount,
        i.due_date, i.status, i.created_at, i.updated_at,
        g.name as grade_name, c.name as class_name
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND i.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (month && year) {
      paramCount++;
      query += ` AND EXTRACT(MONTH FROM i.due_date) = $${paramCount}`;
      queryParams.push(parseInt(month));
      
      paramCount++;
      query += ` AND EXTRACT(YEAR FROM i.due_date) = $${paramCount}`;
      queryParams.push(parseInt(year));
    }

    query += ` ORDER BY i.due_date DESC`;

    const result = await db.query(query, queryParams);

    // Generate CSV content
    const csvHeaders = [
      'Reference Number', 'Student Number', 'First Name', 'Last Name',
      'Grade', 'Class', 'Amount Due', 'Amount Paid', 'Outstanding Balance',
      'Overpaid Amount', 'Due Date', 'Status', 'Created', 'Updated'
    ];

    let csvContent = csvHeaders.join(',') + '\n';

    result.rows.forEach(row => {
      const csvRow = [
        row.reference_number || '',
        row.student_number || '',  // This comes from the invoice table
        row.first_name || '',
        row.last_name || '',
        row.grade_name || '',
        row.class_name || '',
        row.amount_due || 0,
        row.amount_paid || 0,
        row.outstanding_balance || 0,
        row.overpaid_amount || 0,
        row.due_date?.toISOString().split('T')[0] || '',
        row.status || '',
        row.created_at?.toISOString().split('T')[0] || '',
        row.updated_at?.toISOString().split('T')[0] || ''
      ].map(field => {
        // Handle special characters and quotes in CSV
        const stringField = String(field);
        if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
          return `"${stringField.replace(/"/g, '""')}"`;
        }
        return `"${stringField}"`;
      }).join(',');
      
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
  try {
    console.log('Admin clearing all invoices:', req.user.email);

    // Start transaction
    await db.query('BEGIN');

    try {
      // Delete all payment transactions first (due to foreign key constraints)
      const transactionsResult = await db.query('DELETE FROM payment_transactions RETURNING id');
      console.log(`Deleted ${transactionsResult.rowCount} payment transactions`);

      // Delete all payment upload logs
      const uploadsResult = await db.query('DELETE FROM payment_upload_logs RETURNING id');
      console.log(`Deleted ${uploadsResult.rowCount} payment upload logs`);

      // Delete all invoices
      const invoicesResult = await db.query('DELETE FROM invoices RETURNING id');
      console.log(`Deleted ${invoicesResult.rowCount} invoices`);

      // Commit transaction
      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'All invoices and related data cleared successfully',
        deleted: {
          invoices: invoicesResult.rowCount,
          transactions: transactionsResult.rowCount,
          uploadLogs: uploadsResult.rowCount
        }
      });

    } catch (innerError) {
      // Rollback on error
      await db.query('ROLLBACK');
      throw innerError;
    }

  } catch (error) {
    console.error('Clear invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear invoices',
      error: error.message
    });
  }
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
      // Test payment_transactions
      await db.query(`
        INSERT INTO payment_transactions (
          reference_number, amount, payment_date, 
          description, status
        ) VALUES ($1, $2, $3, $4, $5)
      `, ['MIGRATION_TEST', 1.00, new Date(), 'Migration test transaction', 'Matched']);
      
      // Test payment_upload_logs
      await db.query(`
        INSERT INTO payment_upload_logs (
          filename, uploaded_by, transactions_processed, 
          matched_count, partial_count, overpaid_count,
          unmatched_count, duplicate_count, error_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, ['test-migration.csv', 1, 1, 1, 0, 0, 0, 0, 0]);
      
      // Clean up test data
      await db.query(`DELETE FROM payment_transactions WHERE reference_number = 'MIGRATION_TEST'`);
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
