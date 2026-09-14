const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const s3Service = require('../services/s3Service');
const { logAudit, getIp } = require('../utils/auditLogger');
const { allocatePayment, getStudentLedger } = require('../services/financeLedger');
const { detectType } = require('../services/admissionsDocumentService');
const { notifyPayment } = require('../services/parentNotificationService');

const requireParent = [authenticate, authorize('parent')];
const requireAdmin = [authenticate, authorize('admin', 'super_admin')];

// ─── Multer setup (memory for S3 or durable database storage) ────────────────
const storage = multer.memoryStorage();
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
const detectReceiptType = (buffer) => {
  const standard = detectType(buffer);
  if (standard) return standard;
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return null;
  const declaredSize = buffer.readUInt32LE(4) + 8;
  const chunk = buffer.subarray(12, 16).toString('ascii');
  const chunkSize = buffer.readUInt32LE(16);
  const chunkFits = 20 + chunkSize <= buffer.length;
  const validPayload = (
    (chunk === 'VP8X' && chunkSize >= 10 && buffer.length >= 30)
    || (chunk === 'VP8L' && chunkSize >= 5 && buffer.length >= 25 && buffer[20] === 0x2f)
    || (chunk === 'VP8 ' && chunkSize >= 10 && buffer.length >= 30
      && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a])))
  );
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    && declaredSize === buffer.length
    && chunkFits
    && validPayload
  ) return { mime: 'image/webp', extension: '.webp' };
  return null;
};
const isAllowedReceiptName = (file) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeByExtension = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
  };
  return mimeByExtension[extension] === file.mimetype;
};
const upload = multer({
  storage,
  limits: { fileSize: MAX_RECEIPT_SIZE },
  fileFilter: (req, file, cb) => {
    if (isAllowedReceiptName(file)) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed'));
    }
  }
});
const validateReceiptFile = (file) => {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 1 || file.buffer.length > MAX_RECEIPT_SIZE) {
    return { ok: false, message: 'Receipt must be no larger than 10MB' };
  }
  const detected = detectReceiptType(file.buffer);
  if (!detected || detected.mime !== file.mimetype) {
    return { ok: false, message: 'Receipt must be a valid PDF, JPEG, PNG, or WebP matching its MIME type' };
  }
  return { ok: true, detected };
};
// Multer invokes its callback before the async route handler. Keep upload
// failures out of the generic Express error path and validate the bytes here
// as well, before any database or object-storage work begins.
const uploadReceipt = (req, res, next) => {
  upload.single('receipt')(req, res, (err) => {
    if (err) {
      const isSizeError = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      const message = isSizeError
        ? 'Receipt must be no larger than 10MB'
        : 'Receipt must be a PDF, JPEG, PNG, or WebP no larger than 10MB';
      return res.status(400).json({ message });
    }
    if (req.file) {
      const validation = validateReceiptFile(req.file);
      if (!validation.ok) {
        return res.status(400).json({ message: validation.message });
      }
    }
    return next();
  });
};

const MAX_AMOUNT = 100000000;
const PAYMENT_METHODS = new Set(['cash', 'atm', 'eft', 'bank_transfer', 'card', 'debit_order', 'online']);
const parseAmount = (value) => {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text)) throw { status: 400, message: 'Amount must be a finite positive value with at most two decimal places' };
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw { status: 400, message: 'Amount must be a finite positive value within the allowed range' };
  return amount;
};
const boundedText = (value, max, name) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw { status: 400, message: `${name} is too long` };
  return value.trim() || null;
};

const parseSelectedObligations = (value) => {
  if (value == null || value === '') return [];
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    throw { status: 400, message: 'Selected payment obligations are invalid JSON' };
  }
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw { status: 400, message: 'Selected payment obligations must be a list of no more than 100 items' };
  }
  return parsed.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw { status: 400, message: 'Each selected obligation must be an object' };
    }
    const result = {};
    ['invoice_id', 'invoice_line_item_id', 'fee_id', 'service_key', 'category', 'amount'].forEach((key) => {
      if (item[key] != null) result[key] = item[key];
    });
    if (!result.invoice_id && !result.fee_id && !result.service_key) {
      throw { status: 400, message: 'Each selected obligation must identify an invoice, fee, or service' };
    }
    if (result.amount != null && (!Number.isFinite(Number(result.amount)) || Number(result.amount) <= 0)) {
      throw { status: 400, message: 'Selected obligation amounts must be positive' };
    }
    return result;
  });
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const resolveChild = async (parentId, childId) => {
  const q = childId
    ? `SELECT u.* FROM users u JOIN parent_students ps ON ps.student_id=u.id WHERE ps.parent_id=$1 AND u.id=$2 LIMIT 1`
    : `SELECT u.* FROM users u JOIN parent_students ps ON ps.student_id=u.id WHERE ps.parent_id=$1 LIMIT 1`;
  const params = childId ? [parentId, childId] : [parentId];
  const r = await db.query(q, params);
  if (!r.rows.length) {
    if (!childId) return null;
    throw { status: 403, message: 'That student is not linked to your account' };
  }
  return r.rows[0];
};

const resolvePaymentProposals = async (executor, studentId, obligations) => {
  if (!Array.isArray(obligations) || obligations.length === 0) return null;
  const proposals = [];
  for (let index = 0; index < obligations.length; index += 1) {
    const obligation = obligations[index];
    const rawCategory = String(obligation.category || obligation.service_key || '').trim();
    const oneOffCategoryMatch = rawCategory.match(/^one_off:(\d+)$/);
    const feeId = obligation.fee_id != null
      ? Number(obligation.fee_id)
      : oneOffCategoryMatch ? Number(oneOffCategoryMatch[1]) : null;
    const category = feeId != null || rawCategory === 'one_off'
      ? 'one_off'
      : String(obligation.service_key || rawCategory).trim();
    const params = [studentId];
    const clauses = ['i.student_id = $1', 'i.amount_paid < i.amount_due'];
    if (obligation.invoice_id != null) {
      params.push(Number(obligation.invoice_id));
      clauses.push(`i.id = $${params.length}`);
    }
    if (obligation.invoice_line_item_id != null) {
      params.push(Number(obligation.invoice_line_item_id));
      clauses.push(`li.id = $${params.length}`);
    }
    if (feeId != null) {
      params.push(String(feeId));
      clauses.push(`li.metadata->>'fee_id' = $${params.length}`);
      params.push(Number(feeId));
      clauses.push(`EXISTS (
        SELECT 1 FROM student_fee_assignments fa
        WHERE fa.student_id=i.student_id AND fa.fee_id=$${params.length}
      )`);
    } else if (category) {
      params.push(category);
      clauses.push(`li.service_key = $${params.length}`);
    }
    const result = await executor.query(`
      SELECT i.id, i.due_date, li.id AS invoice_line_item_id,
             li.service_key, li.amount AS line_amount, li.metadata
      FROM invoices i
      JOIN invoice_line_items li ON li.invoice_id = i.id
      WHERE ${clauses.join(' AND ')}
        AND li.line_type = 'charge' AND li.is_included = false
      ORDER BY i.due_date ASC, i.id ASC
      LIMIT 1
    `, params);
    if (!result.rows.length) {
      let reason = `selector ${index + 1} (${rawCategory || `fee:${feeId}` || 'unknown'}) has no outstanding persisted invoice line`;
      let status = 422;
      let safeMessage = 'One of the selected payment items is no longer available for allocation. Please review the payment allocation before approving.';
      if (feeId != null) {
        const assignment = await executor.query(`
          SELECT fa.id
          FROM student_fee_assignments fa
          WHERE fa.student_id=$1 AND fa.fee_id=$2
          LIMIT 1
        `, [studentId, feeId]);
        if (assignment.rows.length) {
          status = 409;
          reason = `one-off fee ${feeId} is assigned to the learner but has no outstanding authoritative invoice line`;
          safeMessage = 'This one-off fee requires reconciliation before it can be allocated.';
        }
      }
      const error = new Error(reason);
      error.status = status;
      error.safeMessage = safeMessage;
      error.obligationIndex = index;
      error.obligationCategory = category || null;
      throw error;
    }
    const line = result.rows[0];
    const metadata = line.metadata || {};
    const ledgerCategory = metadata.category === 'one_off' || metadata.fee_id != null
      ? 'one_off' : line.service_key || 'other';
    if (category && category !== ledgerCategory) {
      const error = new Error(`selector ${index + 1} category ${category} does not match ledger category ${ledgerCategory}`);
      error.status = 422;
      error.safeMessage = 'One of the selected payment items does not match its invoice. Please review the allocation before approving.';
      throw error;
    }
    proposals.push({
      invoiceId: Number(line.id),
      invoiceLineItemId: Number(line.invoice_line_item_id),
      obligationId: feeId,
      amount: obligation.amount == null ? null : Number(obligation.amount),
      category: ledgerCategory,
    });
  }
  return proposals;
};

const applyPaymentToInvoices = async (executor, studentId, amount, proofId, adminId, obligations = []) => {
  let selected = obligations;
  if (typeof selected === 'string') {
    try { selected = JSON.parse(selected); } catch (_) {
      throw new Error('Stored payment obligation proposal is invalid');
    }
  }
  const allocationProposals = await resolvePaymentProposals(executor, studentId, selected);
  const result = await allocatePayment(executor, {
    studentId,
    amount,
    paymentMethod: 'proof_of_payment',
    reference: `PROOF-${proofId}`,
    description: `Approved proof of payment (Ref #${proofId})`,
    recordedBy: adminId,
    allocationProposals,
  });
  return result.allocations.map((allocation) => allocation.transactionId);
};

// ─── POST /api/payment-proofs  (parent submits proof) ────────────────────────
router.post('/', requireParent, uploadReceipt, async (req, res) => {
  let client;
  try {
    const { amount, payment_method, reference, notes, child_id } = req.body;
    if (!amount || !payment_method) {
      return res.status(400).json({ message: 'Amount and payment method are required' });
    }
    const normalizedAmount = parseAmount(amount);
    if (typeof payment_method !== 'string' || !PAYMENT_METHODS.has(payment_method.trim().toLowerCase())) {
      return res.status(400).json({ message: 'Unsupported payment method' });
    }
    const normalizedMethod = payment_method.trim().toLowerCase();
    const normalizedReference = boundedText(reference, 255, 'Reference');
    const normalizedNotes = boundedText(notes, 2000, 'Notes');
    const selectedObligations = parseSelectedObligations(req.body.obligations || req.body.allocations);

    const child = await resolveChild(req.user.id, child_id);
    if (!child) return res.status(404).json({ message: 'No child linked to this account' });

    let receiptFileName = null, receiptFilePath = null, receiptS3Key = null, receiptS3Url = null, receiptMime = null, receiptData = null;

    if (req.file) {
      const detected = detectReceiptType(req.file.buffer);
      if (!detected || detected.mime !== req.file.mimetype) {
        return res.status(400).json({ message: 'Receipt must be a valid PDF, JPEG, PNG, or WebP matching its MIME type' });
      }
      receiptFileName = req.file.originalname;
      receiptMime = detected.mime;
      // Always store the raw buffer in the database for reliable retrieval across deployments
      receiptData = req.file.buffer;

    }

    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (idempotencyKey && !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) {
      return res.status(400).json({ message: 'Invalid request key' });
    }
    client = await db.pool.connect();
    let supportsSelectedObligations = true;
    try {
      await client.query('SELECT selected_obligations FROM pending_payments LIMIT 0');
      await client.query('SELECT allocation_category FROM payment_transactions LIMIT 0');
    } catch (schemaError) {
      if (schemaError.code !== '42P01' && schemaError.code !== '42703') throw schemaError;
      supportsSelectedObligations = false;
      if (selectedObligations.length) {
        return res.status(503).json({
          message: 'Multi-obligation payment selection is unavailable until migrations/finance_multi_allocation.sql is applied',
        });
      }
    }
    await client.query('BEGIN');
    if (idempotencyKey) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('parent-payment-proof'), hashtext($1))`,
        [`${req.user.id}:${idempotencyKey}`],
      );
      const existing = await client.query(`
        SELECT pp.id, pp.amount, pp.payment_method, pp.reference, pp.status, pp.submitted_at
        FROM audit_logs a
        JOIN pending_payments pp ON pp.id=a.entity_id
        WHERE a.action='payment_proof_submit' AND a.entity_type='payment_proof'
          AND a.user_id=$1 AND a.details->>'idempotency_key'=$2
        ORDER BY a.id DESC LIMIT 1
      `, [req.user.id, idempotencyKey]);
      if (existing.rows.length) {
        await client.query('COMMIT');
        return res.status(200).json({
          message: 'Proof of payment was already submitted',
          submission: existing.rows[0],
          duplicate: true,
        });
      }
    }

    const result = supportsSelectedObligations
      ? await client.query(`
        INSERT INTO pending_payments
          (parent_id, student_id, amount, payment_method, reference, notes,
           receipt_file_name, receipt_file_path, receipt_s3_key, receipt_s3_url,
           receipt_mime_type, receipt_data, selected_obligations)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
        RETURNING *
      `, [req.user.id, child.id, normalizedAmount.toFixed(2), normalizedMethod,
          normalizedReference, normalizedNotes,
          receiptFileName, receiptFilePath, receiptS3Key, receiptS3Url, receiptMime, receiptData,
          JSON.stringify(selectedObligations)])
      : await client.query(`
        INSERT INTO pending_payments
          (parent_id, student_id, amount, payment_method, reference, notes,
           receipt_file_name, receipt_file_path, receipt_s3_key, receipt_s3_url,
           receipt_mime_type, receipt_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [req.user.id, child.id, normalizedAmount.toFixed(2), normalizedMethod,
          normalizedReference, normalizedNotes,
          receiptFileName, receiptFilePath, receiptS3Key, receiptS3Url, receiptMime, receiptData]);

    const submission = result.rows[0];
    await logAudit({
      executor: client,
      required: true,
      userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'payment_proof_submit',
      entityType: 'payment_proof',
      entityId: submission.id,
      details: {
        idempotency_key: idempotencyKey || null,
        student_id: child.id,
        amount: submission.amount,
        selected_obligations: selectedObligations,
      },
      ipAddress: getIp(req),
    });
    await client.query('COMMIT');

    res.status(201).json({
      message: 'Proof of payment submitted successfully',
      submission: { id: submission.id, amount: submission.amount, payment_method: submission.payment_method,
        reference: submission.reference, status: submission.status, submitted_at: submission.submitted_at }
    });

    // Database receipt storage is authoritative. Optional S3 mirroring and
    // notifications must never keep the Parent's browser waiting after commit.
    setImmediate(async () => {
      if (req.file && s3Service.isConfigValid) {
        try {
          const s3Result = await s3Service.uploadFile(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            'payment-proofs',
          );
          await db.query(`
            UPDATE pending_payments
            SET receipt_s3_key=$1, receipt_s3_url=$2
            WHERE id=$3 AND receipt_s3_key IS NULL
          `, [s3Result.s3Key, s3Result.s3Url, submission.id]);
        } catch (s3Err) {
          console.warn('Post-commit S3 receipt mirror failed:', s3Err.message);
        }
      }
      await notifyPayment({
        kind: 'submitted',
        paymentId: submission.id,
        learnerId: child.id,
        amount: submission.amount,
      }).catch((error) => console.warn('Post-commit proof notification failed:', error.message));
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err instanceof multer.MulterError || err.message?.includes('Only valid') ||
        err.message?.includes('Only images') || err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: err.message });
    }
    console.error('Submit proof error:', err);
    res.status(500).json({ message: 'Server error submitting proof of payment' });
  } finally {
    if (client) client.release();
  }
});

// ─── GET /api/payment-proofs/my  (parent views their own submissions) ─────────
router.get('/my', requireParent, async (req, res) => {
  try {
    const child = await resolveChild(req.user.id, req.query.child_id);
    if (!child) return res.json({ submissions: [] });
    const result = await db.query(`
      SELECT pp.id, pp.student_id, pp.amount, pp.payment_method, pp.reference, pp.notes,
             pp.receipt_file_name, pp.receipt_mime_type, pp.status, pp.submitted_at,
             pp.reviewed_at, pp.admin_note,
             u.first_name AS student_first_name, u.last_name AS student_last_name,
             rb.first_name AS reviewed_by_first_name, rb.last_name AS reviewed_by_last_name
      FROM pending_payments pp
      JOIN users u ON u.id = pp.student_id
      LEFT JOIN users rb ON rb.id = pp.reviewed_by
      WHERE pp.parent_id = $1 AND pp.student_id = $2
      ORDER BY pp.submitted_at DESC
    `, [req.user.id, child.id]);
    res.json({ submissions: result.rows });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/payment-proofs/count  (admin – count pending) ──────────────────
router.get('/count', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) AS count FROM pending_payments WHERE status = 'pending'`
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('Pending proofs count error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/payment-proofs  (admin sees all pending) ───────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status = 'pending', search = '' } = req.query;
    let where = status !== 'all' ? `WHERE pp.status = $1` : `WHERE 1=1`;
    const params = status !== 'all' ? [status] : [];
    let paramIdx = params.length + 1;

    if (search) {
      where += ` AND (LOWER(s.first_name||' '||s.last_name) LIKE $${paramIdx} OR LOWER(p.first_name||' '||p.last_name) LIKE $${paramIdx})`;
      params.push(`%${search.toLowerCase()}%`);
    }

    const result = await db.query(`
      SELECT pp.*,
             s.first_name AS student_first_name, s.last_name AS student_last_name, s.student_number,
             p.first_name AS parent_first_name, p.last_name AS parent_last_name, p.phone_number,
             rb.first_name AS reviewed_by_first_name, rb.last_name AS reviewed_by_last_name
      FROM pending_payments pp
      JOIN users s ON s.id = pp.student_id
      JOIN users p ON p.id = pp.parent_id
      LEFT JOIN users rb ON rb.id = pp.reviewed_by
      ${where}
      ORDER BY pp.submitted_at DESC
    `, params);
    res.json({ submissions: result.rows });
  } catch (err) {
    console.error('Admin list proofs error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/payment-proofs/:id/receipt  (admin/parent views receipt) ────────
router.get('/:id/receipt', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM pending_payments WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Not found' });
    const proof = result.rows[0];

    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isOwningParent = req.user.role === 'parent' && proof.parent_id === req.user.id;
    if (!isAdmin && !isOwningParent) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const mime = proof.receipt_mime_type;
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      return res.status(404).json({ message: 'Receipt file not found' });
    }
    const fileName = String(proof.receipt_file_name || 'receipt').replace(/[\r\n"]/g, '_');
    const sendValidated = (content) => {
      const detected = detectReceiptType(content);
      if (!detected || detected.mime !== mime) return false;
      res.setHeader('Content-Type', detected.mime);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(content);
      return true;
    };

    // 1. Serve from database (most reliable — survives Railway redeploys)
    if (proof.receipt_data) {
      if (sendValidated(proof.receipt_data)) return;
      return res.status(404).json({ message: 'Receipt file not found' });
    }

    // 2. Proxy S3 content through this authenticated route.
    if (proof.receipt_s3_key && s3Service.isConfigValid) {
      try {
        const fileContent = await s3Service.getFileContent(proof.receipt_s3_key);
        if (sendValidated(fileContent)) return;
        return res.status(404).json({ message: 'Receipt file not found' });
      } catch (e) { console.warn('S3 receipt retrieval failed:', e.message); }
    }

    // 3. Strictly bounded legacy local-disk fallback.
    const legacyMatch = /^\/uploads\/payment-proofs\/([A-Za-z0-9._-]+)$/.exec(proof.receipt_file_path || '');
    if (legacyMatch) {
      const legacyRoot = path.resolve(__dirname, '../uploads/payment-proofs');
      const localPath = path.resolve(legacyRoot, legacyMatch[1]);
      if (!localPath.startsWith(`${legacyRoot}${path.sep}`)) {
        return res.status(404).json({ message: 'Receipt file not found' });
      }
      if (fs.existsSync(localPath)) {
        const content = fs.readFileSync(localPath);
        if (sendValidated(content)) return;
        return res.status(404).json({ message: 'Receipt file not found' });
      }
    }

    res.status(404).json({ message: 'Receipt file not found. It may have been lost during a server update. Please ask the parent to re-submit.' });
  } catch (err) {
    console.error('Receipt view error:', err);
    res.status(500).json({ message: 'Server error retrieving receipt' });
  }
});

// ─── DELETE /api/payment-proofs/:id  (admin deletes a submission) ────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM pending_payments WHERE id=$1 AND status <> 'approved' RETURNING *`,
      [req.params.id],
    );
    if (!result.rows.length) {
      const existing = await db.query('SELECT status FROM pending_payments WHERE id=$1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ message: 'Submission not found' });
      return res.status(409).json({ message: 'Approved payment evidence cannot be deleted; use an audited payment reversal instead' });
    }
    const proof = result.rows[0];
    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'payment_proof_delete',
      entityType: 'payment_proof', entityId: proof.id,
      details: { summary: `Deleted payment proof submission #${proof.id}`, amount: proof.amount, student_id: proof.student_id },
      ipAddress: getIp(req)
    });
    res.json({ message: 'Submission deleted' });
  } catch (err) {
    console.error('Delete proof error:', err);
    res.status(500).json({ message: 'Server error deleting submission' });
  }
});

router.get('/:id/allocation-options', requireAdmin, async (req, res) => {
  try {
    const proof = (await db.query(
      `SELECT id, student_id, status FROM pending_payments WHERE id=$1`,
      [req.params.id],
    )).rows[0];
    if (!proof) return res.status(404).json({ message: 'Submission not found' });
    const ledger = await getStudentLedger(proof.student_id);
    const options = (ledger?.invoices || []).flatMap((invoice) =>
      (invoice.category_balances || []).filter((item) => Number(item.amount) > 0).map((item) => {
        const line = (invoice.line_items || []).find((candidate) => (
          item.category === 'one_off'
            ? candidate.metadata?.category === 'one_off' || candidate.metadata?.fee_id != null
            : candidate.line_type === 'charge' && candidate.service_key === item.category
        ));
        return {
          invoice_id: invoice.id,
          invoice_line_item_id: line?.id || null,
          fee_id: item.category === 'one_off' ? Number(line?.metadata?.fee_id) || null : null,
          category: item.category,
          amount: item.amount,
          due_date: invoice.due_date,
          reference_number: invoice.reference_number,
          label: `${line?.label || item.category} — ${String(invoice.due_date || '').slice(0, 10)} — R ${Number(item.amount).toFixed(2)}`,
        };
      }));
    res.json({ options });
  } catch (error) {
    console.error('Payment allocation options error:', error);
    res.status(500).json({ message: 'Could not load allocation options' });
  }
});

router.put('/:id/allocations', requireAdmin, async (req, res) => {
  let client;
  try {
    const reason = boundedText(req.body?.reason, 500, 'Adjustment reason');
    if (!reason) return res.status(400).json({ message: 'An allocation adjustment reason is required' });
    const obligations = parseSelectedObligations(req.body?.obligations);
    if (!obligations.length) return res.status(400).json({ message: 'At least one allocation is required' });
    client = await db.pool.connect();
    await client.query('BEGIN');
    const proof = (await client.query(
      `SELECT * FROM pending_payments WHERE id=$1 FOR UPDATE`,
      [req.params.id],
    )).rows[0];
    if (!proof) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Submission not found' });
    }
    if (proof.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only pending submissions can be adjusted' });
    }
    await resolvePaymentProposals(client, proof.student_id, obligations);
    await client.query(
      `UPDATE pending_payments SET selected_obligations=$1::jsonb WHERE id=$2`,
      [JSON.stringify(obligations), proof.id],
    );
    await logAudit({
      executor: client, required: true,
      userId: req.user.id,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'payment_allocation_adjust',
      entityType: 'payment_proof',
      entityId: proof.id,
      details: { reason, previous: proof.selected_obligations || [], proposed: obligations },
      ipAddress: getIp(req),
    });
    await client.query('COMMIT');
    res.json({ message: 'Proposed allocation updated', obligations });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Adjust proof allocation error:', error);
    res.status(error.status || 500).json({
      message: error.safeMessage || (error.status ? error.message : 'Could not adjust allocation'),
    });
  } finally {
    if (client) client.release();
  }
});

// ─── POST /api/payment-proofs/:id/approve  (admin approves) ──────────────────
router.post('/:id/approve', requireAdmin, async (req, res) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const proof = (await client.query('SELECT * FROM pending_payments WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!proof) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Submission not found' });
    }
    if (proof.status === 'approved') {
      await client.query('COMMIT');
      return res.json({ message: 'Payment proof was already approved', status: 'approved' });
    }
    if (proof.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `This submission is already ${proof.status}` });
    }

    const admin_note = boundedText(req.body?.admin_note, 2000, 'Admin note');
    const txIds = await applyPaymentToInvoices(
      client,
      proof.student_id,
      proof.amount,
      proof.id,
      req.user.id,
      proof.selected_obligations || [],
    );

    await client.query(`
      UPDATE pending_payments
      SET status='approved', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, admin_note=$2
      WHERE id=$3 AND status='pending'
    `, [req.user.id, admin_note || null, proof.id]);

    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'payment_proof_approve',
      entityType: 'payment_proof', entityId: proof.id,
      details: { summary: `Approved payment proof of R${proof.amount}`, amount: proof.amount, student_id: proof.student_id, admin_note: admin_note || null },
      ipAddress: getIp(req), executor: client, required: true
    });
    await client.query('COMMIT');
    res.json({ message: 'Payment approved and applied to student balance', status: 'approved', transaction_ids: txIds });
    setImmediate(async () => {
      await Promise.allSettled([
        notifyPayment({
          kind: 'approved',
          paymentId: proof.id,
          learnerId: proof.student_id,
          amount: proof.amount,
        }),
        notifyPayment({
          kind: 'applied',
          paymentId: proof.id,
          learnerId: proof.student_id,
          amount: proof.amount,
        }),
      ]);
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('Approval rollback failed:', rollbackError.message); }
    }
    console.error('Approve proof error:', {
      message: err.message,
      obligationIndex: err.obligationIndex,
      obligationCategory: err.obligationCategory,
    });
    if (err.status) return res.status(err.status).json({
      success: false,
      message: err.safeMessage || err.message,
    });
    res.status(500).json({ message: 'Server error approving payment' });
  } finally {
    if (client) client.release();
  }
});

// ─── POST /api/payment-proofs/:id/reject  (admin rejects) ────────────────────
router.post('/:id/reject', requireAdmin, async (req, res) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const proof = (await client.query('SELECT * FROM pending_payments WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!proof) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Submission not found' });
    }
    if (proof.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `This submission is already ${proof.status}` });
    }

    const admin_note = boundedText(req.body?.admin_note, 2000, 'Admin note');
    await client.query(`
      UPDATE pending_payments
      SET status='rejected', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, admin_note=$2
      WHERE id=$3 AND status='pending'
    `, [req.user.id, admin_note || null, proof.id]);

    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'payment_proof_reject',
      entityType: 'payment_proof', entityId: proof.id,
      details: { summary: `Rejected payment proof of R${proof.amount}`, amount: proof.amount, student_id: proof.student_id, reason: admin_note || null },
      ipAddress: getIp(req), executor: client, required: true
    });
    await client.query('COMMIT');
    res.json({ message: 'Submission rejected' });
    setImmediate(() => notifyPayment({
      kind: 'rejected',
      paymentId: proof.id,
      learnerId: proof.student_id,
      reason: admin_note,
    }).catch((error) => console.warn('Post-commit rejection notification failed:', error.message)));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Reject proof error:', err);
    res.status(500).json({ message: 'Server error rejecting payment' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
module.exports.validateReceiptFile = validateReceiptFile;
module.exports.resolvePaymentProposals = resolvePaymentProposals;
module.exports.detectReceiptType = detectReceiptType;
module.exports.MAX_RECEIPT_SIZE = MAX_RECEIPT_SIZE;
module.exports.isAllowedReceiptName = isAllowedReceiptName;
