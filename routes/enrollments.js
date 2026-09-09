const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { logAudit, getIp } = require('../utils/auditLogger');
const { ADMISSIONS_STATUSES } = require('../utils/admissions');
const { buildPortalLink } = require('../services/admissionsPortalLinks');
const {
  TOKEN_PURPOSES,
  PortalTokenError,
  issuePortalTokenInTransaction,
  getPortalAccess,
  revokePortalTokensInTransaction,
} = require('../services/admissionsPortalTokenService');
const {
  EMAIL_ERROR_CATEGORIES,
  normalizeEmailResult,
  sendApplicationConfirmation,
  sendEnrollmentNotification,
  sendAdmissionsStatusEmail,
} = require('../services/gmailService');
const { getAdmissionsDocumentStream, deleteAdmissionsDocument } = require('../services/admissionsDocumentService');
const { notifyAdmissionsAdmins } = require('../services/admissionsNotificationService');

const router = express.Router();
const LEGACY_STATUSES = ['pending', 'approved', 'rejected', 'waitlisted'];
const EMAIL_COMPATIBLE_LEGACY_STATUSES = ['approved', 'rejected', 'waitlisted'];
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

const logEmailDelivery = async (enrollmentId, emailType, result, executor = db, required = false) => {
  const safeResult = normalizeEmailResult(result);
  const deliveryStatus = safeResult.skipped ? 'skipped' : safeResult.success ? 'sent' : 'failed';
  try {
    await executor.query(`
      INSERT INTO admissions_email_log
        (enrollment_id, email_type, delivery_status, message_id, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      enrollmentId,
      emailType,
      deliveryStatus,
      safeResult.messageId || null,
      safeResult.error || null,
    ]);
  } catch (error) {
    console.error(`Email delivery log failed for enrollment ${enrollmentId}:`, error.message);
    if (required) throw error;
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
    try {
      await notifyAdmissionsAdmins({ enrollmentId: enrollment.id, event: 'NEW_APPLICATION' });
    } catch (notificationError) {
      console.error('Admissions notification failed:', notificationError.message);
    }
    const emailResults = await Promise.allSettled([
      sendApplicationConfirmation(enrollment),
      sendEnrollmentNotification(enrollment),
    ]);
    const emailTypes = ['application_confirmation', 'new_application_admin'];
    await Promise.all(emailResults.map(async (outcome, index) => {
      const result = outcome.status === 'fulfilled'
        ? normalizeEmailResult(outcome.value)
        : { success: false, error: EMAIL_ERROR_CATEGORIES.UNKNOWN };
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
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required.' });
    return false;
  }
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
      enrollments: result.rows.map(safeEnrollment),
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
            'email_type', latest.email_type,
            'delivery_status', latest.delivery_status,
             'error_message', latest.error_message,
            'created_at', latest.created_at
          ) ORDER BY latest.created_at DESC), '[]')
          FROM (
            SELECT DISTINCT ON (email_type)
              email_type, delivery_status, error_message, created_at
            FROM admissions_email_log
            WHERE enrollment_id = e.id
            ORDER BY email_type, created_at DESC, id DESC
          ) latest
        ) AS email_delivery
      FROM enrollments e
      LEFT JOIN enrollment_status_history h ON h.enrollment_id = e.id
      WHERE e.id = $1
      GROUP BY e.id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Enrollment not found' });
    const enrollment = result.rows[0];
    delete enrollment.registration_token_hash;
    delete enrollment.registration_token_issued_at;
    delete enrollment.registration_token_expires_at;
    const [recordResult, checklistResult, tokenResult, documentResult] = await Promise.all([
      db.query('SELECT form_status, submitted_at, service_selections, requested_application_fields FROM registration_records WHERE enrollment_id = $1', [req.params.id]),
      db.query(`SELECT item_type, status, parent_submission_choice, requested_at, received_at FROM registration_checklist_items WHERE enrollment_id = $1 ORDER BY item_type`, [req.params.id]),
      db.query(`SELECT t.purpose, t.issued_at, t.expires_at, t.revoked_at, t.first_used_at, t.last_used_at, t.use_count,
        rr.form_status FROM admissions_portal_tokens t
        LEFT JOIN registration_records rr ON rr.enrollment_id = t.enrollment_id
        WHERE t.enrollment_id = $1 ORDER BY t.issued_at DESC`, [req.params.id]),
      db.query(`
        SELECT DISTINCT ON (ci.item_type)
          ci.item_type, d.public_id, d.original_filename, d.file_size,
          d.review_status, d.rejection_reason, d.uploaded_at
        FROM admissions_portal_documents d
        JOIN registration_checklist_items ci ON ci.id = d.checklist_item_id
        WHERE d.enrollment_id = $1
          AND d.deleted_at IS NULL
          AND d.superseded_by_document_id IS NULL
        ORDER BY ci.item_type, d.uploaded_at DESC
      `, [req.params.id]),
    ]);
    const record = recordResult.rows[0];
    enrollment.portalData = {
      requestedFields: record?.requested_application_fields || [],
      registration: {
        formStatus: record?.form_status || 'NOT_STARTED',
        submittedAt: record?.submitted_at || null,
        serviceSelections: record?.service_selections || {},
      },
      checklist: checklistResult.rows.map((item) => {
        const document = documentResult.rows.find((entry) => entry.item_type === item.item_type);
        return {
          itemType: item.item_type,
          status: document?.review_status === 'PENDING'
            ? 'UPLOADED_PENDING_REVIEW'
            : document?.review_status || item.status,
          checklistStatus: item.status,
          parentChoice: item.parent_submission_choice,
          requestedAt: item.requested_at,
          receivedAt: item.received_at,
          document: document ? {
            publicId: document.public_id,
            originalFilename: document.original_filename,
            fileSize: Number(document.file_size),
            reviewStatus: document.review_status,
            rejectionReason: document.rejection_reason,
            uploadedAt: document.uploaded_at,
          } : null,
        };
      }),
      secureLinks: [],
    };
    const latestByPurpose = new Map();
    tokenResult.rows.forEach((token) => { if (!latestByPurpose.has(token.purpose)) latestByPurpose.set(token.purpose, token); });
    enrollment.portalData.secureLinks = [...latestByPurpose.values()].map((token) => ({
      purpose: token.purpose,
      status: token.revoked_at ? 'REVOKED' : (new Date(token.expires_at) <= new Date() ? 'EXPIRED' : (
        getPortalAccess({ purpose: token.purpose, enrollmentStatus: enrollment.status, formStatus: token.form_status }) === 'read_only'
          ? 'SUBMITTED_READ_ONLY' : (getPortalAccess({ purpose: token.purpose, enrollmentStatus: enrollment.status, formStatus: token.form_status }) ? 'ACTIVE' : 'REVOKED')
      )),
      issuedAt: token.issued_at,
      expiresAt: token.expires_at,
      lastUsedAt: token.last_used_at,
      useCount: token.use_count,
    }));
    delete enrollment.registration;
    delete enrollment.checklist;
    delete enrollment.portalLinks;
    enrollment.email_delivery = (enrollment.email_delivery || []).map((entry) => ({
      ...entry,
      ...(entry.error_message ? {
        error_message: Object.values(EMAIL_ERROR_CATEGORIES).includes(entry.error_message)
          ? entry.error_message : EMAIL_ERROR_CATEGORIES.UNKNOWN,
      } : {}),
    }));
    return res.json(enrollment);
  } catch (error) {
    console.error('Error fetching enrollment:', error.message);
    return res.status(500).json({ message: 'Failed to fetch enrollment' });
  }
});

router.get('/:id/documents', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await db.query(`
      SELECT d.public_id, d.original_filename, d.content_type, d.detected_content_type,
             d.sha256, d.file_size, d.review_status, d.scan_status, d.rejection_reason,
             d.deleted_at, d.replaced_at, d.uploaded_at, ci.item_type
      FROM admissions_portal_documents d
      LEFT JOIN registration_checklist_items ci ON ci.id = d.checklist_item_id
      WHERE d.enrollment_id = $1 ORDER BY d.uploaded_at DESC
    `, [req.params.id]);
    return res.json({ documents: result.rows.map((row) => ({
      publicId: row.public_id, originalFilename: row.original_filename, contentType: row.content_type,
      detectedContentType: row.detected_content_type, sha256: row.sha256,
      fileSize: Number(row.file_size), reviewStatus: row.review_status, scanStatus: row.scan_status,
      rejectionReason: row.rejection_reason, deletedAt: row.deleted_at, replacedAt: row.replaced_at,
      uploadedAt: row.uploaded_at, itemType: row.item_type,
    })) });
  } catch (error) {
    console.error('Admissions document list failed:', error.message);
    return res.status(500).json({ message: 'Failed to fetch admissions documents' });
  }
});

router.patch('/:id/documents/:publicId/review', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const reviewStatus = req.body?.reviewStatus || req.body?.status;
  if (!['RECEIVED', 'REPLACEMENT_REQUIRED'].includes(reviewStatus)) {
    return res.status(400).json({ message: 'Invalid document review status' });
  }
  const rejectionReason = typeof req.body?.rejectionReason === 'string'
    ? req.body.rejectionReason.trim().slice(0, 1000) : null;
  if (reviewStatus === 'REPLACEMENT_REQUIRED' && !rejectionReason) {
    return res.status(400).json({ message: 'A replacement reason is required' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const enrollment = await client.query(
      'SELECT id FROM enrollments WHERE id = $1 FOR UPDATE',
      [req.params.id],
    );
    if (!enrollment.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Enrollment not found' });
    }
    const result = await client.query(`
      UPDATE admissions_portal_documents
       SET review_status = $1,
           rejection_reason = $2,
          reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
       WHERE public_id = $4 AND enrollment_id = $5 AND deleted_at IS NULL
         AND superseded_by_document_id IS NULL
       RETURNING public_id, enrollment_id, checklist_item_id, review_status, rejection_reason, reviewed_at
    `, [reviewStatus, rejectionReason, req.user.id, req.params.publicId, req.params.id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document not found' });
    }
    const document = result.rows[0];
    await client.query(`
      UPDATE registration_checklist_items
      SET status = CASE WHEN $1 = 'RECEIVED' THEN 'RECEIVED' ELSE 'MISSING' END,
          received_at = CASE WHEN $1 = 'RECEIVED' THEN CURRENT_TIMESTAMP ELSE NULL END,
          parent_submission_choice = 'UPLOAD_ONLINE',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [reviewStatus, document.checklist_item_id]);
    await logAudit({
      userId: req.user.id,
      userName: req.user.email,
      userRole: req.user.role,
      action: reviewStatus === 'RECEIVED' ? 'admissions_document_received' : 'admissions_document_replacement_requested',
      entityType: 'enrollment',
      entityId: req.params.id,
      details: { documentPublicId: document.public_id, reviewStatus },
      ipAddress: getIp(req),
      executor: client,
      required: true,
    });
    await client.query('COMMIT');
    try {
      await notifyAdmissionsAdmins({
        enrollmentId: document.enrollment_id,
        event: reviewStatus === 'RECEIVED' ? 'DOCUMENT_REVIEWED' : 'DOCUMENT_REPLACEMENT_REQUIRED',
        documentPublicId: document.public_id,
      });
    } catch (error) { console.error('Admissions notification failed:', error.message); }
    return res.json({ document });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Admissions document review failed:', {
      code: error.code,
      constraint: error.constraint,
      message: error.message,
    });
    return res.status(500).json({ message: 'Failed to review admissions document' });
  } finally { if (client) client.release(); }
});

router.get('/:id/documents/:publicId/download', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await db.query(`
       SELECT storage_key, original_filename, content_type
       FROM admissions_portal_documents
       WHERE enrollment_id = $1 AND public_id = $2 AND deleted_at IS NULL
         AND superseded_by_document_id IS NULL
    `, [req.params.id, req.params.publicId]);
    if (!result.rows.length) return res.status(404).json({ message: 'Document not found' });
    const document = result.rows[0];
    const stream = await getAdmissionsDocumentStream(document.storage_key);
    res.set({
      'Content-Type': document.content_type,
      'Content-Disposition': `attachment; filename="${document.original_filename.replace(/["\\\r\n]/g, '_')}"`,
      'Cache-Control': 'no-store',
    });
    stream.on('error', () => { if (!res.headersSent) res.status(502).json({ message: 'Document download failed' }); });
    return stream.pipe(res);
  } catch (error) {
    console.error('Admissions document download failed:', error.message);
    return res.status(error.status || 502).json({ message: 'Document download failed' });
  }
});

router.delete('/:id/documents/:publicId', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const enrollment = await client.query(
      'SELECT id FROM enrollments WHERE id = $1 FOR UPDATE',
      [req.params.id],
    );
    if (!enrollment.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Enrollment not found' });
    }
    const found = await client.query(`
      SELECT id, storage_key, checklist_item_id FROM admissions_portal_documents
       WHERE enrollment_id = $1 AND public_id = $2
         AND deleted_at IS NULL AND superseded_by_document_id IS NULL
       FOR UPDATE
    `, [req.params.id, req.params.publicId]);
    if (!found.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Document not found' }); }
    const document = found.rows[0];
    await client.query(
      'UPDATE admissions_portal_documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [document.id],
    );
    if (document.checklist_item_id) {
      await client.query(`UPDATE registration_checklist_items SET status = 'MISSING', received_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [document.checklist_item_id]);
    }
    await client.query('COMMIT');
    await deleteAdmissionsDocument(document.storage_key);
    return res.json({ removed: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Admissions document removal failed:', error.message);
    return res.status(500).json({ message: 'Failed to remove admissions document' });
  } finally { if (client) client.release(); }
});

router.put('/:id/status', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { status } = req.body;
  const adminNotes = typeof req.body.adminNotes === 'string' ? req.body.adminNotes.trim().slice(0, 4000) : '';
  const parentMessage = typeof req.body.parentMessage === 'string' ? req.body.parentMessage.trim().slice(0, 1000) : '';
  if (status === 'MORE_INFORMATION_REQUIRED') {
    return res.status(400).json({ message: 'Use /information-request with requested fields or checklist items.' });
  }
  if (!ADMISSIONS_STATUSES.includes(status) && !EMAIL_COMPATIBLE_LEGACY_STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

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
      return res.json({
        message: 'Application status unchanged',
        enrollment: safeEnrollment(current),
        statusChanged: false,
      });
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
    let portalToken = null;
    if (status === 'APPROVED' || status === 'approved') {
      await revokePortalTokensInTransaction({ client, enrollmentId: req.params.id, purpose: TOKEN_PURPOSES.UPDATE_APPLICATION });
      portalToken = await issuePortalTokenInTransaction({
        client, enrollmentId: req.params.id, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION, issuedBy: req.user.id,
      });
    } else {
      await revokePortalTokensInTransaction({ client, enrollmentId: req.params.id, purpose: TOKEN_PURPOSES.UPDATE_APPLICATION });
      if (status !== 'REGISTRATION_PENDING') {
        await revokePortalTokensInTransaction({ client, enrollmentId: req.params.id, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION });
      }
    }
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

    let emailResult;
    try {
      emailResult = normalizeEmailResult(
        await sendAdmissionsStatusEmail(
          enrollment,
          status,
          parentMessage || null,
          portalToken ? buildPortalLink({ token: portalToken.token, purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION }) : null,
        ),
      );
    } catch {
      emailResult = { success: false, error: EMAIL_ERROR_CATEGORIES.UNKNOWN };
    }
    await logEmailDelivery(enrollment.id, `status_${status.toLowerCase()}`, emailResult);
    if (!emailResult.success) {
      console.error(`Status updated for ${enrollment.application_reference}; parent email failed`);
    }
    return res.json({
      message: `Application status changed to ${status}`,
      enrollment: safeEnrollment(enrollment),
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

const REQUESTED_FIELDS = new Set(['parentEmail', 'parentPhone', 'previousSchool', 'additionalNotes']);
const CHECKLIST_REQUEST_ITEMS = new Set(['BIRTH_CERTIFICATE', 'PARENT_GUARDIAN_ID', 'LATEST_SCHOOL_REPORT', 'TRANSFER_DOCUMENT']);
const CHECKLIST_ITEMS = new Set([...CHECKLIST_REQUEST_ITEMS, 'REGISTRATION_FORM']);
const portalPurpose = (value) => Object.values(TOKEN_PURPOSES).includes(value) ? value : null;
const safeTokenMetadata = (token, now = new Date()) => ({
  purpose: token.purpose,
  status: token.revoked_at ? 'REVOKED' : (new Date(token.expires_at) <= now ? 'EXPIRED' : 'ACTIVE'),
  issuedAt: token.issued_at,
  expiresAt: token.expires_at,
  lastUsedAt: token.last_used_at || null,
  useCount: token.use_count || 0,
});
const safeEnrollment = (enrollment) => {
  if (!enrollment) return enrollment;
  const safe = { ...enrollment };
  delete safe.registration_token_hash;
  delete safe.registration_token_issued_at;
  delete safe.registration_token_expires_at;
  return safe;
};

const sendPortalEmail = async ({ enrollment, purpose, token, parentMessage = null }) => {
  const link = buildPortalLink({ token, purpose });
  return normalizeEmailResult(await sendAdmissionsStatusEmail(
    safeEnrollment(enrollment),
    purpose === TOKEN_PURPOSES.UPDATE_APPLICATION ? 'MORE_INFORMATION_REQUIRED' : 'APPROVED',
    parentMessage,
    link,
  ));
};

router.post('/:id/information-request', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const requestedFields = Array.isArray(req.body?.requestedFields) ? [...new Set(req.body.requestedFields)] : [];
  const checklistItems = Array.isArray(req.body?.checklistItems) ? [...new Set(req.body.checklistItems)] : [];
  const parentMessage = typeof req.body?.parentMessage === 'string' ? req.body.parentMessage.trim() : '';
  if (requestedFields.some((field) => !REQUESTED_FIELDS.has(field))
    || checklistItems.some((item) => !CHECKLIST_REQUEST_ITEMS.has(item))
    || parentMessage.length > 1000
    || (!requestedFields.length && !checklistItems.length)) {
    return res.status(400).json({ message: 'Invalid information request' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM enrollments WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!currentResult.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Enrollment not found' }); }
    const current = currentResult.rows[0];
    await client.query(`
      INSERT INTO registration_records (enrollment_id, requested_application_fields, updated_at)
      VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (enrollment_id) DO UPDATE SET
        requested_application_fields = EXCLUDED.requested_application_fields,
        application_update_submitted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `, [req.params.id, JSON.stringify(requestedFields)]);
    for (const item of checklistItems) {
      await client.query(`
        INSERT INTO registration_checklist_items (enrollment_id, item_type, status, requested_by, requested_at, updated_at)
        VALUES ($1, $2, 'MISSING', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (enrollment_id, item_type) DO UPDATE SET
          requested_by = EXCLUDED.requested_by, requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
          status = CASE WHEN registration_checklist_items.status = 'RECEIVED' THEN registration_checklist_items.status ELSE 'MISSING' END
      `, [req.params.id, item, req.user.id]);
    }
    await client.query(`
      UPDATE registration_checklist_items SET requested_at = NULL, requested_by = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE enrollment_id = $1 AND item_type <> ALL($2::text[]) AND status <> 'RECEIVED'
    `, [req.params.id, checklistItems]);
    const statusChanged = current.status !== 'MORE_INFORMATION_REQUIRED';
    const updated = await client.query(`
      UPDATE enrollments SET status = 'MORE_INFORMATION_REQUIRED', parent_status_message = $1, reviewed_by = $2,
        reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *
    `, [parentMessage || null, req.user.id, req.params.id]);
    if (statusChanged) {
      await client.query(`INSERT INTO enrollment_status_history (enrollment_id, previous_status, new_status, changed_by, parent_message)
        VALUES ($1, $2, 'MORE_INFORMATION_REQUIRED', $3, $4)`,
      [req.params.id, current.status, req.user.id, parentMessage || null]);
    }
    await revokePortalTokensInTransaction({
      client,
      enrollmentId: req.params.id,
      purpose: TOKEN_PURPOSES.COMPLETE_REGISTRATION,
    });
    const token = await issuePortalTokenInTransaction({
      client, enrollmentId: req.params.id, purpose: TOKEN_PURPOSES.UPDATE_APPLICATION, issuedBy: req.user.id,
    });
    await client.query('COMMIT');
    await logAudit({ userId: req.user.id, userName: req.user.email, userRole: req.user.role, action: 'information_request', entityType: 'enrollment', entityId: req.params.id, details: { requestedFields, checklistItems }, ipAddress: getIp(req) });
    let emailResult;
    try { emailResult = await sendPortalEmail({ enrollment: updated.rows[0], purpose: TOKEN_PURPOSES.UPDATE_APPLICATION, token: token.token, parentMessage }); }
    catch { emailResult = { success: false, error: EMAIL_ERROR_CATEGORIES.UNKNOWN }; }
    await logEmailDelivery(req.params.id, 'status_more_information_required', emailResult);
    return res.json({ message: 'Information request sent', enrollment: safeEnrollment(updated.rows[0]), statusChanged, emailSent: Boolean(emailResult.success && !emailResult.skipped) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Information request failed:', error.message);
    return res.status(500).json({ message: 'Failed to request additional information' });
  } finally { if (client) client.release(); }
});

router.patch('/:id/checklist/:itemType', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const itemType = req.params.itemType;
  const status = req.body?.status;
  if (!CHECKLIST_ITEMS.has(itemType) && itemType !== 'REGISTRATION_FORM') {
    return res.status(400).json({ message: 'Invalid checklist item' });
  }
  if (!['MISSING', 'RECEIVED', 'NOT_APPLICABLE'].includes(status)) {
    return res.status(400).json({ message: 'Invalid checklist status' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const enrollment = await client.query('SELECT id FROM enrollments WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!enrollment.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Enrollment not found' }); }
    const activeDocument = await client.query(`
      SELECT 1
      FROM admissions_portal_documents d
      JOIN registration_checklist_items ci ON ci.id = d.checklist_item_id
      WHERE d.enrollment_id = $1 AND ci.item_type = $2
        AND d.deleted_at IS NULL AND d.superseded_by_document_id IS NULL
      LIMIT 1
    `, [req.params.id, itemType]);
    if (activeDocument.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Review or remove the active uploaded document instead of changing its checklist state.',
      });
    }
    const item = await client.query(`
      INSERT INTO registration_checklist_items (enrollment_id, item_type, status, requested_by, requested_at, received_at, updated_at)
      VALUES ($1, $2, $3::text, $4, CASE WHEN $3::text = 'MISSING' THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN $3::text = 'RECEIVED' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
      ON CONFLICT (enrollment_id, item_type) DO UPDATE SET status = EXCLUDED.status,
        received_at = EXCLUDED.received_at,
        requested_by = CASE WHEN EXCLUDED.status = 'MISSING' THEN EXCLUDED.requested_by ELSE registration_checklist_items.requested_by END,
        requested_at = CASE WHEN EXCLUDED.status = 'MISSING' THEN COALESCE(registration_checklist_items.requested_at, CURRENT_TIMESTAMP) ELSE registration_checklist_items.requested_at END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING item_type, status, requested_at, received_at
    `, [req.params.id, itemType, status, req.user.id]);
    await client.query('COMMIT');
    await logAudit({ userId: req.user.id, userName: req.user.email, userRole: req.user.role, action: 'checklist_status_change', entityType: 'enrollment', entityId: req.params.id, details: { itemType, status }, ipAddress: getIp(req) });
    return res.json({ checklistItem: item.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Checklist update failed:', error.message);
    return res.status(500).json({ message: 'Failed to update checklist item' });
  } finally { if (client) client.release(); }
});

const createPortalControlHandler = ({ action } = {}) => async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const purpose = portalPurpose(req.body?.purpose);
  if (!purpose) return res.status(400).json({ message: 'Invalid portal link purpose' });
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const enrollmentResult = await client.query('SELECT * FROM enrollments WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!enrollmentResult.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Enrollment not found' }); }
    const enrollment = enrollmentResult.rows[0];
    if (action === 'revoke') {
      await revokePortalTokensInTransaction({ client, enrollmentId: req.params.id, purpose });
      await client.query('COMMIT');
      await logAudit({ userId: req.user.id, userName: req.user.email, userRole: req.user.role, action: 'portal_link_revoke', entityType: 'enrollment', entityId: req.params.id, details: { purpose }, ipAddress: getIp(req) });
      return res.json({ purpose, revoked: true });
    }
    const token = await issuePortalTokenInTransaction({ client, enrollmentId: req.params.id, purpose, issuedBy: req.user.id });
    await client.query('COMMIT');
    let emailResult;
    try { emailResult = await sendPortalEmail({ enrollment, purpose, token }); }
    catch { emailResult = { success: false, error: EMAIL_ERROR_CATEGORIES.UNKNOWN }; }
    await logEmailDelivery(req.params.id, purpose === TOKEN_PURPOSES.UPDATE_APPLICATION ? 'status_more_information_required' : 'status_approved', emailResult);
    await logAudit({ userId: req.user.id, userName: req.user.email, userRole: req.user.role, action: 'portal_link_reissue', entityType: 'enrollment', entityId: req.params.id, details: { purpose }, ipAddress: getIp(req) });
    return res.json({ metadata: safeTokenMetadata(token), emailSent: Boolean(emailResult.success && !emailResult.skipped), linkReissued: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof PortalTokenError
      && ['TOKEN_NOT_ELIGIBLE', 'INVALID_ENROLLMENT'].includes(error.code)) {
      return res.status(error.code === 'INVALID_ENROLLMENT' ? 404 : 409).json({
        message: 'This portal link is not eligible for the current application state.',
      });
    }
    return res.status(500).json({ message: 'Failed to update portal link' });
  } finally { if (client) client.release(); }
};

router.post('/:id/portal-link/reissue', authenticate, createPortalControlHandler({ action: 'reissue' }));
router.post('/:id/portal-link/resend', authenticate, createPortalControlHandler({ action: 'resend' }));
router.post('/:id/portal-link/revoke', authenticate, createPortalControlHandler({ action: 'revoke' }));

const createAdmissionsEmailResendHandler = ({
  database = db,
  sendConfirmation = sendApplicationConfirmation,
  sendAdminNotification = sendEnrollmentNotification,
  sendStatusEmail = sendAdmissionsStatusEmail,
} = {}) => async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const emailType = typeof req.body?.emailType === 'string' ? req.body.emailType : '';
  const enrollmentId = Number(req.params.id);
  if (!Number.isSafeInteger(enrollmentId) || enrollmentId < 1) {
    return res.status(400).json({ message: 'Invalid enrollment ID' });
  }
  const resendableEmailTypes = Object.freeze({
    application_confirmation: { send: sendConfirmation },
    new_application_admin: { send: sendAdminNotification },
    status_under_review: { status: 'UNDER_REVIEW' },
    status_more_information_required: { status: 'MORE_INFORMATION_REQUIRED' },
    status_approved: { status: 'APPROVED' },
    status_registration_pending: { status: 'REGISTRATION_PENDING' },
    status_registered: { status: 'REGISTERED' },
    status_not_accepted: { status: 'NOT_ACCEPTED' },
    status_waitlisted: { status: 'waitlisted' },
    status_rejected: { status: 'rejected' },
  });
  const resendDefinition = resendableEmailTypes[emailType];
  if (!resendDefinition) return res.status(400).json({ message: 'Invalid admissions email type' });
  if (emailType === 'status_more_information_required' || emailType === 'status_approved') {
    return res.status(409).json({
      message: 'Secure status emails must use the portal-link reissue or resend endpoint.',
    });
  }

  let client;
  try {
    client = await database.pool.connect();
    await client.query('BEGIN');
    const lockResult = await client.query(
      'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS acquired',
      [enrollmentId, emailType],
    );
    if (!lockResult.rows[0]?.acquired) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A resend for this email is already in progress' });
    }

    const enrollmentResult = await client.query(
      'SELECT * FROM enrollments WHERE id = $1',
      [enrollmentId],
    );
    if (!enrollmentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Enrollment not found' });
    }
    const enrollment = enrollmentResult.rows[0];
    const latestAttempt = await client.query(`
      SELECT delivery_status
      FROM admissions_email_log
      WHERE enrollment_id = $1 AND email_type = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [enrollment.id, emailType]);
    if (latestAttempt.rows[0]?.delivery_status !== 'failed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This email does not have an unresolved failed delivery' });
    }
    if (resendDefinition.status && enrollment.status !== resendDefinition.status) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Application status has changed since this email failed' });
    }

    let emailResult;
    try {
      emailResult = normalizeEmailResult(resendDefinition.send
        ? await resendDefinition.send(enrollment)
        : await sendStatusEmail(enrollment, resendDefinition.status, enrollment.parent_status_message || null));
    } catch {
      emailResult = { success: false, error: EMAIL_ERROR_CATEGORIES.UNKNOWN };
    }
    await logEmailDelivery(enrollment.id, emailType, emailResult, client, true);
    await client.query('COMMIT');

    if (!emailResult.success) {
      return res.status(502).json({
        message: 'Admissions email could not be delivered',
        error: emailResult.error,
      });
    }
    return res.json({ message: 'Admissions email delivered', emailSent: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Admissions email resend failed: UNKNOWN_EMAIL_FAILURE');
    return res.status(500).json({ message: 'Failed to resend admissions email' });
  } finally {
    if (client) client.release();
  }
};

router.post('/:id/email/resend', authenticate, createAdmissionsEmailResendHandler());

module.exports = router;
module.exports.createAdmissionsEmailResendHandler = createAdmissionsEmailResendHandler;