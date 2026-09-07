const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { logAudit, getIp } = require('../utils/auditLogger');
const { ADMISSIONS_STATUSES } = require('../utils/admissions');
const {
  sendApplicationConfirmation,
  sendEnrollmentNotification,
  sendAdmissionsStatusEmail,
} = require('../services/gmailService');

const router = express.Router();
const LEGACY_STATUSES = ['pending', 'approved', 'rejected', 'waitlisted'];
let admissionsSchemaReady = false;

const requireAdmissionsSchema = async (req, res, next) => {
  if (admissionsSchemaReady) return next();
  try {
    const result = await db.query(`
      SELECT
        to_regclass('public.enrollment_application_reference_seq') IS NOT NULL
          AND to_regclass('public.enrollment_status_history') IS NOT NULL
          AND to_regclass('public.admissions_email_log') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'enrollments'
              AND column_name = 'application_reference'
          ) AS ready
    `);
    admissionsSchemaReady = Boolean(result.rows[0]?.ready);
    if (admissionsSchemaReady) return next();
  } catch (error) {
    console.error('Admissions schema readiness check failed:', error.message);
  }
  return res.status(503).json({
    message: 'Admissions is temporarily unavailable while a required database update is completed.',
  });
};

router.use(requireAdmissionsSchema);

const logEmailDelivery = async (enrollmentId, emailType, result) => {
  const deliveryStatus = result?.skipped ? 'skipped' : result?.success ? 'sent' : 'failed';
  try {
    await db.query(`
      INSERT INTO admissions_email_log
        (enrollment_id, email_type, delivery_status, message_id, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      enrollmentId,
      emailType,
      deliveryStatus,
      result?.messageId || null,
      result?.error ? String(result.error).slice(0, 500) : null,
    ]);
  } catch (error) {
    console.error(`Email delivery log failed for enrollment ${enrollmentId}:`, error.message);
  }
};

const initializeEnrollmentsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        application_reference VARCHAR(32) UNIQUE,
        parent_first_name VARCHAR(100) NOT NULL,
        parent_last_name VARCHAR(100) NOT NULL,
        parent_email VARCHAR(255) NOT NULL,
        parent_phone VARCHAR(50) NOT NULL,
        student_first_name VARCHAR(100) NOT NULL,
        student_last_name VARCHAR(100) NOT NULL,
        student_date_of_birth DATE NOT NULL,
        grade_applying VARCHAR(50) NOT NULL,
        boarding_option BOOLEAN DEFAULT false,
        previous_school VARCHAR(255),
        additional_notes TEXT,
        status VARCHAR(40) DEFAULT 'NEW',
        admin_notes TEXT,
        parent_status_message TEXT,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        registration_token_hash CHAR(64),
        registration_token_issued_at TIMESTAMP,
        registration_token_expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments(status)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_enrollments_email ON enrollments(parent_email)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_enrollments_created ON enrollments(created_at)');
  } catch (error) {
    console.error('Enrollments table initialization failed:', error.message);
  }
};

if (process.env.ENABLE_STARTUP_SCHEMA_CHANGES === 'true') initializeEnrollmentsTable();

const enrollmentValidation = [
  body('parentFirstName').trim().isLength({ min: 2, max: 100 }).withMessage('Parent first name must be between 2 and 100 characters'),
  body('parentLastName').trim().isLength({ min: 2, max: 100 }).withMessage('Parent last name must be between 2 and 100 characters'),
  body('parentEmail').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('parentPhone').trim().isLength({ min: 10, max: 50 }).withMessage('Please enter a valid phone number'),
  body('studentFirstName').trim().isLength({ min: 2, max: 100 }).withMessage('Learner first name must be between 2 and 100 characters'),
  body('studentLastName').trim().isLength({ min: 2, max: 100 }).withMessage('Learner last name must be between 2 and 100 characters'),
  body('studentDateOfBirth').isISO8601().withMessage('Please enter a valid date of birth'),
  body('gradeApplying').trim().isLength({ min: 1, max: 50 }).withMessage('Please select a grade'),
  body('previousSchool').optional({ checkFalsy: true }).trim().isLength({ max: 255 }),
  body('additionalNotes').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
];

router.post('/', enrollmentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      parentFirstName, parentLastName, parentEmail, parentPhone,
      studentFirstName, studentLastName, studentDateOfBirth,
      gradeApplying, boardingOption, previousSchool, additionalNotes,
    } = req.body;

    const result = await db.query(`
      INSERT INTO enrollments (
        application_reference,
        parent_first_name, parent_last_name, parent_email, parent_phone,
        student_first_name, student_last_name, student_date_of_birth,
        grade_applying, boarding_option, previous_school, additional_notes, status
      ) VALUES (
        'HLI-2027-' || LPAD(nextval('enrollment_application_reference_seq')::text, 4, '0'),
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'NEW'
      )
      RETURNING *
    `, [
      parentFirstName, parentLastName, parentEmail, parentPhone,
      studentFirstName, studentLastName, studentDateOfBirth,
      gradeApplying, Boolean(boardingOption), previousSchool || null, additionalNotes || null,
    ]);

    const enrollment = result.rows[0];
    const emailResults = await Promise.allSettled([
      sendApplicationConfirmation(enrollment),
      sendEnrollmentNotification(enrollment),
    ]);
    const emailTypes = ['application_confirmation', 'new_application_admin'];
    await Promise.all(emailResults.map(async (outcome, index) => {
      const result = outcome.status === 'fulfilled'
        ? outcome.value
        : { success: false, error: outcome.reason?.message || 'Email send failed' };
      await logEmailDelivery(enrollment.id, emailTypes[index], result);
      if (!result.success) {
        console.error(`Application ${enrollment.application_reference} saved; ${emailTypes[index]} email failed`);
      }
    }));

    return res.status(201).json({
      message: 'Enrollment application submitted successfully',
      enrollment: {
        id: enrollment.id,
        application_reference: enrollment.application_reference,
        status: enrollment.status,
      },
    });
  } catch (error) {
    console.error('Enrollment submission error:', error.message);
    return res.status(500).json({ message: 'Failed to submit enrollment application' });
  }
});

const requireAdmin = (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) {
    res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    return false;
  }
  return true;
};

router.get('/', authenticate, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const clauses = [];
    const params = [];

    if (status) {
      if (![...ADMISSIONS_STATUSES, ...LEGACY_STATUSES].includes(status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      clauses.push(`(
        application_reference ILIKE ${p}
        OR CONCAT_WS(' ', student_first_name, student_last_name) ILIKE ${p}
        OR CONCAT_WS(' ', parent_first_name, parent_last_name) ILIKE ${p}
        OR parent_email ILIKE ${p}
        OR parent_phone ILIKE ${p}
      )`);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM enrollments${where}`, params);
    const total = Number(countResult.rows[0].count);
    params.push(limit, (page - 1) * limit);
    const result = await db.query(
      `SELECT * FROM enrollments${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({
      enrollments: result.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching enrollments:', error.message);
    return res.status(500).json({ message: 'Failed to fetch enrollments' });
  }
});

router.get('/stats', authenticate, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const result = await db.query('SELECT status, COUNT(*)::int AS count FROM enrollments GROUP BY status');
    const stats = { total: 0 };
    [...ADMISSIONS_STATUSES, ...LEGACY_STATUSES].forEach((status) => { stats[status] = 0; });
    result.rows.forEach(({ status, count }) => {
      stats[status] = count;
      stats.total += count;
    });
    return res.json(stats);
  } catch (error) {
    console.error('Error fetching enrollment stats:', error.message);
    return res.status(500).json({ message: 'Failed to fetch enrollment statistics' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const result = await db.query(`
      SELECT e.*,
        COALESCE(
          json_agg(json_build_object(
            'previous_status', h.previous_status,
            'new_status', h.new_status,
            'parent_message', h.parent_message,
            'created_at', h.created_at
          ) ORDER BY h.created_at DESC) FILTER (WHERE h.id IS NOT NULL),
          '[]'
        ) AS status_history,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'email_type', email_type,
            'delivery_status', delivery_status,
            'created_at', created_at
          ) ORDER BY created_at DESC), '[]')
          FROM admissions_email_log
          WHERE enrollment_id = e.id
        ) AS email_delivery
      FROM enrollments e
      LEFT JOIN enrollment_status_history h ON h.enrollment_id = e.id
      WHERE e.id = $1
      GROUP BY e.id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Enrollment not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching enrollment:', error.message);
    return res.status(500).json({ message: 'Failed to fetch enrollment' });
  }
});

router.put('/:id/status', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { status } = req.body;
  const adminNotes = typeof req.body.adminNotes === 'string' ? req.body.adminNotes.trim().slice(0, 4000) : '';
  const parentMessage = typeof req.body.parentMessage === 'string' ? req.body.parentMessage.trim().slice(0, 1000) : '';
  if (!ADMISSIONS_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM enrollments WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Enrollment not found' });
    }
    const current = currentResult.rows[0];
    if (current.status === status) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Application status unchanged', enrollment: current, statusChanged: false });
    }

    const updatedResult = await client.query(`
      UPDATE enrollments
      SET status = $1, admin_notes = $2, parent_status_message = $3,
          reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 RETURNING *
    `, [status, adminNotes || null, parentMessage || null, req.user.id, req.params.id]);
    await client.query(`
      INSERT INTO enrollment_status_history
        (enrollment_id, previous_status, new_status, changed_by, parent_message)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.params.id, current.status, status, req.user.id, parentMessage || null]);
    await client.query('COMMIT');

    const enrollment = updatedResult.rows[0];
    await logAudit({
      userId: req.user.id,
      userName: req.user.email || `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'admissions_status_change',
      entityType: 'enrollment',
      entityId: enrollment.id,
      details: { reference: enrollment.application_reference, previousStatus: current.status, newStatus: status },
      ipAddress: getIp(req),
    });

    const emailResult = await sendAdmissionsStatusEmail(enrollment, status, parentMessage || null);
    await logEmailDelivery(enrollment.id, `status_${status.toLowerCase()}`, emailResult);
    if (!emailResult.success) {
      console.error(`Status updated for ${enrollment.application_reference}; parent email failed`);
    }
    return res.json({
      message: `Application status changed to ${status}`,
      enrollment,
      statusChanged: true,
      emailSent: Boolean(emailResult.success && !emailResult.skipped),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating enrollment status:', error.message);
    return res.status(500).json({ message: 'Failed to update enrollment status' });
  } finally {
    client.release();
  }
});

module.exports = router;