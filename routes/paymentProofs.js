const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const s3Service = require('../services/s3Service');

const requireParent = [authenticate, authorize('parent')];
const requireAdmin = [authenticate, authorize('admin', 'super_admin')];

// ─── Multer setup (memory for S3, disk fallback) ─────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) || allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed'));
    }
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const resolveChild = async (parentId, childId) => {
  const q = childId
    ? `SELECT u.* FROM users u JOIN parent_students ps ON ps.student_id=u.id WHERE ps.parent_id=$1 AND u.id=$2 LIMIT 1`
    : `SELECT u.* FROM users u JOIN parent_students ps ON ps.student_id=u.id WHERE ps.parent_id=$1 LIMIT 1`;
  const params = childId ? [parentId, childId] : [parentId];
  const r = await db.query(q, params);
  if (!r.rows.length) throw { status: 404, message: 'Child not found' };
  return r.rows[0];
};

const applyPaymentToInvoices = async (studentId, amount, proofId, adminId) => {
  let remaining = parseFloat(amount);
  const txIds = [];

  // Get oldest unpaid/partial invoices first
  const invoices = await db.query(`
    SELECT id, amount_due, amount_paid, outstanding_balance, reference_number
    FROM invoices
    WHERE student_id = $1 AND status IN ('Unpaid', 'Partial')
    ORDER BY due_date ASC
  `, [studentId]);

  for (const inv of invoices.rows) {
    if (remaining <= 0) break;
    const outstanding = parseFloat(inv.outstanding_balance);
    const toApply = Math.min(remaining, outstanding);
    const newPaid = parseFloat(inv.amount_paid) + toApply;
    const newStatus = newPaid >= parseFloat(inv.amount_due)
      ? (newPaid > parseFloat(inv.amount_due) ? 'Overpaid' : 'Paid')
      : 'Partial';

    await db.query(`
      UPDATE invoices SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [newPaid.toFixed(2), newStatus, inv.id]);

    const tx = await db.query(`
      INSERT INTO payment_transactions
        (invoice_id, student_id, amount, payment_date, payment_method, description, status, recorded_by)
      VALUES ($1, $2, $3, CURRENT_DATE, 'proof_of_payment', $4, 'Matched', $5)
      RETURNING id
    `, [inv.id, studentId, toApply.toFixed(2),
        `Approved proof of payment (Ref #${proofId})`, adminId]);

    txIds.push(tx.rows[0].id);
    remaining -= toApply;
  }

  // If there's still remaining amount (paid more than all outstanding), record as unmatched
  if (remaining > 0.009) {
    const tx = await db.query(`
      INSERT INTO payment_transactions
        (student_id, amount, payment_date, payment_method, description, status, recorded_by)
      VALUES ($1, $2, CURRENT_DATE, 'proof_of_payment', $3, 'Unmatched', $4)
      RETURNING id
    `, [studentId, remaining.toFixed(2), `Overpayment from proof #${proofId}`, adminId]);
    txIds.push(tx.rows[0].id);
  }

  return txIds;
};

// ─── POST /api/payment-proofs  (parent submits proof) ────────────────────────
router.post('/', requireParent, upload.single('receipt'), async (req, res) => {
  try {
    const { amount, payment_method, reference, notes, child_id } = req.body;
    if (!amount || !payment_method) {
      return res.status(400).json({ message: 'Amount and payment method are required' });
    }
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than zero' });
    }

    const child = await resolveChild(req.user.id, child_id);

    let receiptFileName = null, receiptFilePath = null, receiptS3Key = null, receiptS3Url = null, receiptMime = null;

    if (req.file) {
      receiptFileName = req.file.originalname;
      receiptMime = req.file.mimetype;
      if (s3Service.isConfigValid) {
        try {
          const result = await s3Service.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, 'payment-proofs');
          receiptS3Key = result.s3Key;
          receiptS3Url = result.s3Url;
        } catch (s3Err) {
          console.warn('S3 upload failed, falling back to local:', s3Err.message);
        }
      }
      if (!receiptS3Key) {
        const localDir = path.join(__dirname, '../uploads/payment-proofs');
        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
        const safeName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const fullPath = path.join(localDir, safeName);
        fs.writeFileSync(fullPath, req.file.buffer);
        receiptFilePath = `/uploads/payment-proofs/${safeName}`;
      }
    }

    const result = await db.query(`
      INSERT INTO pending_payments
        (parent_id, student_id, amount, payment_method, reference, notes,
         receipt_file_name, receipt_file_path, receipt_s3_key, receipt_s3_url, receipt_mime_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [req.user.id, child.id, parseFloat(amount).toFixed(2), payment_method,
        reference || null, notes || null,
        receiptFileName, receiptFilePath, receiptS3Key, receiptS3Url, receiptMime]);

    res.status(201).json({ message: 'Proof of payment submitted successfully', submission: result.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('Submit proof error:', err);
    res.status(500).json({ message: 'Server error submitting proof of payment' });
  }
});

// ─── GET /api/payment-proofs/my  (parent views their own submissions) ─────────
router.get('/my', requireParent, async (req, res) => {
  try {
    const child = await resolveChild(req.user.id, req.query.child_id);
    const result = await db.query(`
      SELECT pp.*, u.first_name AS student_first_name, u.last_name AS student_last_name,
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

    // Access control
    if (req.user.role === 'parent' && proof.parent_id !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (proof.receipt_s3_key && s3Service.isConfigValid) {
      try {
        const url = await s3Service.getSignedUrl(proof.receipt_s3_key, 300);
        return res.redirect(url);
      } catch (e) { console.warn('S3 signed URL failed:', e.message); }
    }

    if (proof.receipt_s3_url) return res.redirect(proof.receipt_s3_url);

    if (proof.receipt_file_path) {
      const localPath = path.join(__dirname, '..', proof.receipt_file_path);
      if (fs.existsSync(localPath)) {
        res.setHeader('Content-Type', proof.receipt_mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${proof.receipt_file_name || 'receipt'}"`);
        return fs.createReadStream(localPath).pipe(res);
      }
    }

    res.status(404).json({ message: 'Receipt file not found' });
  } catch (err) {
    console.error('Receipt view error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── POST /api/payment-proofs/:id/approve  (admin approves) ──────────────────
router.post('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const proof = (await db.query('SELECT * FROM pending_payments WHERE id=$1', [req.params.id])).rows[0];
    if (!proof) return res.status(404).json({ message: 'Submission not found' });
    if (proof.status !== 'pending') return res.status(400).json({ message: `This submission is already ${proof.status}` });

    const { admin_note } = req.body;
    const txIds = await applyPaymentToInvoices(proof.student_id, proof.amount, proof.id, req.user.id);

    await db.query(`
      UPDATE pending_payments
      SET status='approved', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, admin_note=$2
      WHERE id=$3
    `, [req.user.id, admin_note || null, proof.id]);

    res.json({ message: 'Payment approved and applied to student balance', transaction_ids: txIds });
  } catch (err) {
    console.error('Approve proof error:', err);
    res.status(500).json({ message: 'Server error approving payment' });
  }
});

// ─── POST /api/payment-proofs/:id/reject  (admin rejects) ────────────────────
router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const proof = (await db.query('SELECT * FROM pending_payments WHERE id=$1', [req.params.id])).rows[0];
    if (!proof) return res.status(404).json({ message: 'Submission not found' });
    if (proof.status !== 'pending') return res.status(400).json({ message: `This submission is already ${proof.status}` });

    const { admin_note } = req.body;
    await db.query(`
      UPDATE pending_payments
      SET status='rejected', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, admin_note=$2
      WHERE id=$3
    `, [req.user.id, admin_note || null, proof.id]);

    res.json({ message: 'Submission rejected' });
  } catch (err) {
    console.error('Reject proof error:', err);
    res.status(500).json({ message: 'Server error rejecting payment' });
  }
});

module.exports = router;
