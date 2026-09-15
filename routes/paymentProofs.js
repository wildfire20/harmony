const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const s3Service = require('../services/s3Service');
const { logAudit, getIp } = require('../utils/auditLogger');
const {
  getStudentLedger,
  invoiceAllocationCategories,
  invoiceCategoryBalances,
} = require('../services/financeLedger');
const { getPayableObligations } = require('../services/payableObligations');
const {
  invoiceObligationLockKeys,
  acquireInvoiceObligationLocks,
  normaliseCategory,
} = require('../services/invoiceObligationLocks');
const { resolveLegacyClassification } = require('../services/legacyClassification');
const { detectType } = require('../services/admissionsDocumentService');
const { notifyPayment } = require('../services/parentNotificationService');
const financeCommands = require('../services/financeCommandService');

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
    ['obligation_id', 'invoice_id', 'invoice_line_item_id', 'fee_id', 'assignment_id', 'service_key', 'category', 'amount', 'legacy_invoice_level'].forEach((key) => {
      if (item[key] != null) result[key] = item[key];
    });
    if (!result.invoice_id && !result.fee_id && !result.service_key) {
      throw { status: 400, message: 'Each selected obligation must identify an invoice, fee, or service' };
    }
    if (!Object.prototype.hasOwnProperty.call(item, 'amount') ||
        item.amount == null ||
        !Number.isFinite(Number(item.amount)) ||
        Number(item.amount) <= 0) {
      throw {
        status: 422,
        message: 'Every selected obligation must include a finite positive amount',
      };
    }
    result.amount = Number(item.amount);
    return result;
  });
};

const validateExplicitObligationAmounts = (obligations) => {
  if (obligations == null) return;
  if (!Array.isArray(obligations)) {
    const error = new Error('Stored selected obligations must be an array or null automatic mode');
    error.status = 422;
    error.safeMessage = 'The stored allocation plan is invalid. Reload and review the payment before approving.';
    throw error;
  }
  if (obligations.length === 0) return;
  obligations.forEach((obligation, index) => {
    if (!obligation || !Object.prototype.hasOwnProperty.call(obligation, 'amount') ||
        obligation.amount == null ||
        !Number.isFinite(Number(obligation.amount)) ||
        Number(obligation.amount) <= 0) {
      const error = new Error(`Selected obligation ${index + 1} must have a finite positive amount`);
      error.status = 422;
      error.safeMessage = 'Every selected obligation must include a finite positive amount.';
      throw error;
    }
  });
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const optionalPositiveId = (value, label) => {
  if (value == null || value === '') return null;
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) {
    const error = new Error(`${label} must be a positive integer`);
    error.status = 422;
    error.safeMessage = `The selected payment item has an invalid ${label}. Please reload and try again.`;
    throw error;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    const error = new Error(`${label} is outside the supported integer range`);
    error.status = 422;
    error.safeMessage = `The selected payment item has an invalid ${label}. Please reload and try again.`;
    throw error;
  }
  return parsed;
};

const canonicalObligationLockKeys = (studentId, obligations = []) => [...new Set(
  obligations.flatMap((obligation) => invoiceObligationLockKeys({
    invoiceId: obligation?.invoice_id,
    studentId,
    lineId: obligation?.invoice_line_item_id == null ? 'legacy' : obligation.invoice_line_item_id,
    category: normaliseCategory(obligation?.category || obligation?.service_key),
    feeId: obligation?.fee_id,
  })),
)].sort();

const acquireCanonicalObligationLocks = (executor, studentId, obligations) =>
  acquireInvoiceObligationLocks(executor, obligations.map((obligation) => ({
    invoiceId: obligation?.invoice_id,
    studentId,
    lineId: obligation?.invoice_line_item_id == null ? 'legacy' : obligation.invoice_line_item_id,
    category: normaliseCategory(obligation?.category || obligation?.service_key),
    feeId: obligation?.fee_id,
  })));

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
  if (obligations == null) return null;
  if (!Array.isArray(obligations)) {
    validateExplicitObligationAmounts(obligations);
  }
  if (obligations.length === 0) return null;
  validateExplicitObligationAmounts(obligations);
  const proposals = [];
  for (let index = 0; index < obligations.length; index += 1) {
    const obligation = obligations[index];
    const rawCategory = String(obligation.category || obligation.service_key || '').trim();
    const oneOffCategoryMatch = rawCategory.match(/^one_off:(\d+)$/);
    const feeId = obligation.fee_id != null
      ? optionalPositiveId(obligation.fee_id, 'fee ID')
      : oneOffCategoryMatch ? optionalPositiveId(oneOffCategoryMatch[1], 'fee ID') : null;
    const invoiceId = optionalPositiveId(obligation.invoice_id, 'invoice ID');
    const invoiceLineItemId = optionalPositiveId(obligation.invoice_line_item_id, 'invoice line ID');
    const assignmentId = optionalPositiveId(obligation.assignment_id, 'assignment ID');
    const category = feeId != null || rawCategory === 'one_off'
      ? 'one_off'
      : String(obligation.service_key || rawCategory).trim();
    const params = [optionalPositiveId(studentId, 'learner ID')];
    const clauses = ['i.student_id = $1::integer'];
    const hasExactTarget = invoiceId != null || invoiceLineItemId != null;
    if (!hasExactTarget) clauses.push('i.amount_paid < i.amount_due');
    if (invoiceId != null) {
      params.push(invoiceId);
      clauses.push(`i.id = $${params.length}::integer`);
    }
    if (invoiceLineItemId != null) {
      params.push(invoiceLineItemId);
      clauses.push(`li.id = $${params.length}::integer`);
    }
    if (feeId != null) {
      params.push(String(feeId));
      clauses.push(`li.metadata->>'fee_id' = $${params.length}`);
      params.push(Number(feeId));
      clauses.push(`EXISTS (
        SELECT 1 FROM student_fee_assignments fa
        WHERE fa.student_id=i.student_id AND fa.fee_id=$${params.length}::integer
      )`);
      if (assignmentId != null) {
        params.push(assignmentId);
        clauses.push(`li.metadata->>'assignment_id' = $${params.length}::text`);
        clauses.push(`EXISTS (
          SELECT 1 FROM student_fee_assignments fa
          WHERE fa.id=$${params.length}::integer AND fa.student_id=i.student_id AND fa.fee_id=$${params.length - 1}::integer
        )`);
      }
    } else if (category && invoiceLineItemId == null) {
      params.push(category);
      clauses.push(`li.service_key = $${params.length}`);
    }
    let result = await executor.query(`
      SELECT i.id, i.due_date, i.amount_due, i.amount_paid,
             li.id AS invoice_line_item_id, li.label,
             li.service_key, li.amount AS line_amount, li.metadata,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id', all_li.id,
                 'line_type', all_li.line_type,
                 'service_key', all_li.service_key,
                 'label', all_li.label,
                 'description', all_li.description,
                 'amount', all_li.amount,
                 'is_included', all_li.is_included,
                 'metadata', all_li.metadata
               ) ORDER BY all_li.id)
               FROM invoice_line_items all_li
               WHERE all_li.invoice_id=i.id
             ), '[]'::json) AS invoice_lines,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'amount', pt.amount,
                 'allocation_category', to_jsonb(pt)->>'allocation_category',
                 'is_reversed', reversal.id IS NOT NULL
               ) ORDER BY pt.id)
               FROM payment_transactions pt
               LEFT JOIN payment_transactions reversal
                 ON reversal.reverses_transaction_id=pt.id
               WHERE pt.invoice_id=i.id
             ), '[]'::json) AS invoice_transactions
      FROM invoices i
      JOIN invoice_line_items li ON li.invoice_id = i.id
      WHERE ${clauses.join(' AND ')}
        AND li.line_type = 'charge' AND li.is_included = false
      ORDER BY i.due_date ASC, i.id ASC
      LIMIT 1
    `, params);
    // Some old monthly invoices predate line-item snapshots. They may be used
    // as invoice-level Tuition obligations only when their own persisted
    // description explicitly identifies Tuition. Current prices and enrollment
    // flags are deliberately not consulted.
    if (!result.rows.length && category === 'tuition' && invoiceLineItemId == null) {
      const legacyParams = [params[0]];
      const legacyClauses = [
        'i.student_id = $1::integer',
        'i.amount_paid < i.amount_due',
        "COALESCE(i.description, '') ~* '\\m(tuition|school[[:space:]]+fees?)\\M'",
        'NOT EXISTS (SELECT 1 FROM invoice_line_items existing_li WHERE existing_li.invoice_id=i.id)',
      ];
      if (invoiceId != null) {
        legacyParams.push(invoiceId);
        legacyClauses.push(`i.id = $${legacyParams.length}::integer`);
      }
      result = await executor.query(`
        SELECT i.id, i.due_date, i.amount_due, i.amount_paid,
               NULL::integer AS invoice_line_item_id,
               'Legacy Tuition'::text AS label,
               'tuition'::text AS service_key,
               i.amount_due AS line_amount,
               jsonb_build_object('legacy_invoice_level', true) AS metadata,
               json_build_array(json_build_object(
                 'line_type', 'charge', 'service_key', 'tuition',
                 'amount', i.amount_due, 'is_included', false,
                 'metadata', jsonb_build_object('legacy_invoice_level', true)
               )) AS invoice_lines,
               COALESCE((
                 SELECT json_agg(json_build_object(
                   'amount', pt.amount,
                   'allocation_category', to_jsonb(pt)->>'allocation_category',
                   'is_reversed', reversal.id IS NOT NULL
                 ) ORDER BY pt.id)
                 FROM payment_transactions pt
                 LEFT JOIN payment_transactions reversal
                   ON reversal.reverses_transaction_id=pt.id
                 WHERE pt.invoice_id=i.id
               ), '[]'::json) AS invoice_transactions
        FROM invoices i
        WHERE ${legacyClauses.join(' AND ')}
        ORDER BY i.due_date ASC, i.id ASC
        LIMIT 1
      `, legacyParams);
    }
    if (!result.rows.length) {
      let reason = `selector ${index + 1} (${rawCategory || `fee:${feeId}` || 'unknown'}) has no outstanding persisted invoice line`;
      let status = 422;
      const categoryLabel = category
        ? `${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, ' ')}`
        : 'This payment item';
      let safeMessage = `${categoryLabel} has no outstanding charge for this learner. Remove or retarget this allocation before approving.`;
      if (feeId != null) {
        const assignment = await executor.query(`
          SELECT fa.id
          FROM student_fee_assignments fa
           WHERE fa.student_id=$1::integer AND fa.fee_id=$2::integer
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
    const invoiceLines = Array.isArray(line.invoice_lines) ? line.invoice_lines : [{
      id: line.invoice_line_item_id,
      line_type: 'charge',
      service_key: line.service_key,
      amount: line.line_amount,
      is_included: false,
      metadata: line.metadata || {},
    }];
    const effectiveLines = resolveLegacyClassification(invoiceLines).lines;
    const effectiveLine = effectiveLines.find((item) =>
      Number(item.id) === Number(line.invoice_line_item_id)) || line;
    const metadata = effectiveLine.metadata || {};
    const ledgerCategory = metadata.category === 'one_off' || metadata.fee_id != null
      ? 'one_off' : effectiveLine.service_key || 'other';
    if (category && category !== ledgerCategory) {
      const error = new Error(`selector ${index + 1} category ${category} does not match ledger category ${ledgerCategory}`);
      error.status = 422;
      error.safeMessage = 'One of the selected payment items does not match its invoice. Please review the allocation before approving.';
      throw error;
    }
    const invoiceTransactions = Array.isArray(line.invoice_transactions) ? line.invoice_transactions : [];
    const invoiceCategories = invoiceAllocationCategories(invoiceLines);
    const hasCategorisedPayments = invoiceTransactions.some((transaction) =>
      transaction.allocation_category && !transaction.is_reversed && Number(transaction.amount) > 0);
    if (Number(line.amount_paid) > 0 && invoiceCategories.length > 1 && !hasCategorisedPayments) {
      const error = new Error(`selector ${index + 1} belongs to a legacy invoice with unknown category allocation`);
      error.status = 409;
      error.safeMessage = 'This legacy invoice requires category reconciliation before this payment can be approved.';
      error.obligationIndex = index;
      error.obligationCategory = ledgerCategory;
      throw error;
    }
    const categoryAvailable = Number(invoiceCategoryBalances(
      invoiceLines,
      line.amount_due,
      invoiceTransactions,
    ).find((balance) => balance.category === ledgerCategory)?.amount || 0);
    const invoiceOutstanding = Math.max(0, Number(line.amount_due) - Number(line.amount_paid));
    const availableAmount = metadata.legacy_invoice_level === true
      ? Math.max(0, Number(line.amount_due) - Number(line.amount_paid))
      : (invoiceCategories.length === 1
        ? Math.min(categoryAvailable, invoiceOutstanding)
        : categoryAvailable);
    const categoryLabel = `${ledgerCategory.charAt(0).toUpperCase()}${ledgerCategory.slice(1).replace(/_/g, ' ')}`;
    if (availableAmount <= 0 || Number(line.amount_paid) >= Number(line.amount_due)) {
      const error = new Error(`selector ${index + 1} (${ledgerCategory}) is already fully paid`);
      error.status = 409;
      error.safeMessage = `${categoryLabel}${line.due_date ? ` for ${String(line.due_date).slice(0, 10)}` : ''} is already fully paid. Remove or retarget this allocation before approving.`;
      error.obligationIndex = index;
      error.obligationCategory = ledgerCategory;
      throw error;
    }
    if (obligation.amount != null && Number(obligation.amount) > availableAmount) {
      const error = new Error(`selector ${index + 1} (${ledgerCategory}) amount exceeds its outstanding balance`);
      error.status = 422;
      error.safeMessage = `${categoryLabel} has only R ${availableAmount.toFixed(2)} outstanding. Reduce or retarget this allocation before approving.`;
      error.obligationIndex = index;
      error.obligationCategory = ledgerCategory;
      throw error;
    }
    proposals.push({
      invoiceId: Number(line.id),
      invoiceLineItemId: line.invoice_line_item_id == null ? null : Number(line.invoice_line_item_id),
      obligationId: feeId,
      ...(metadata.assignment_id != null ? { assignmentId: Number(metadata.assignment_id) } : {}),
      ...(metadata.legacy_invoice_level === true ? { legacyInvoiceLevel: true } : {}),
      amount: obligation.amount == null ? null : Number(obligation.amount),
      category: ledgerCategory,
      availableAmount,
    });
  }
  return proposals;
};

const applyPaymentToInvoices = async (executor, studentId, amount, proofId, adminId, obligations = null) => {
  let selected = obligations;
  if (typeof selected === 'string') {
    try { selected = JSON.parse(selected); } catch (_) {
      throw new Error('Stored payment obligation proposal is invalid');
    }
  }
  if (Array.isArray(selected) && selected.length === 0) {
    const result = await financeCommands.applyUnallocated({
      executor,
      studentId,
      amount,
      paymentMethod: 'proof_of_payment',
      reference: `PROOF-${proofId}`,
      description: `Approved proof of payment (Ref #${proofId})`,
      recordedBy: adminId,
      actor: { id: adminId, role: 'admin' },
      // This compatibility helper is retained for legacy unit callers; the
      // approval command itself records the required atomic audit event.
      skipAudit: true,
    });
    return (result.allocations || []).map((allocation) => allocation.transactionId);
  }
  const allocationProposals = await resolvePaymentProposals(executor, studentId, selected);
  const result = await financeCommands.recordPayment({
    executor,
    studentId,
    amount,
    paymentMethod: 'proof_of_payment',
    reference: `PROOF-${proofId}`,
    description: `Approved proof of payment (Ref #${proofId})`,
    recordedBy: adminId,
    obligations: allocationProposals,
    skipAudit: true,
  });
  return (result.allocations || []).map((allocation) => allocation.transactionId);
};

const validateResolvedPlan = (resolved, paymentAmount) => {
  validateExplicitObligationAmounts(resolved);
  const total = Number(paymentAmount);
  const specifiedTotal = resolved.reduce((sum, proposal) => (
    proposal.amount == null ? sum : sum + Number(proposal.amount)
  ), 0);
  if (specifiedTotal > total) {
    const error = new Error(`Selected allocation total ${specifiedTotal} exceeds payment amount ${total}`);
    error.status = 422;
    error.safeMessage = 'The selected allocation total exceeds the payment amount. Adjust the allocation before saving.';
    throw error;
  }
  const totalsByTarget = new Map();
  resolved.forEach((proposal) => {
    if (proposal.amount == null) return;
    const key = `${proposal.invoiceId}:${proposal.invoiceLineItemId}:${proposal.category}`;
    totalsByTarget.set(key, (totalsByTarget.get(key) || 0) + Number(proposal.amount));
    if (totalsByTarget.get(key) > proposal.availableAmount) {
      const label = `${proposal.category.charAt(0).toUpperCase()}${proposal.category.slice(1).replace(/_/g, ' ')}`;
      const error = new Error(`Duplicate ${proposal.category} proposals exceed the target balance`);
      error.status = 422;
      error.safeMessage = `${label} allocations exceed the outstanding amount. Reduce or remove the duplicate allocation before saving.`;
      throw error;
    }
  });
};

const normaliseStoredObligations = (resolved) => resolved.map((proposal) => ({
  obligation_id: `invoice:${proposal.invoiceId}:${proposal.invoiceLineItemId == null
    ? 'legacy' : `line:${proposal.invoiceLineItemId}`}`,
  invoice_id: proposal.invoiceId,
  invoice_line_item_id: proposal.invoiceLineItemId,
  ...(proposal.obligationId != null ? { fee_id: proposal.obligationId } : {}),
  ...(proposal.assignmentId != null ? { assignment_id: proposal.assignmentId } : {}),
  category: proposal.category,
  amount: proposal.amount,
}));

/*
 * Resolve the submitted identity against the same read model shown to Parent
 * and Admin. The existing row-lock resolver remains the final race-safe check;
 * this check prevents an otherwise valid-looking stale proposal from being
 * approved after its canonical obligation became settled or reserved.
 */
const validateCanonicalSelections = async (executor, studentId, obligations, options = {}) => {
  if (!Array.isArray(obligations) || obligations.length === 0) return;
  validateExplicitObligationAmounts(obligations);
  const canonical = await getPayableObligations(studentId, executor, options);
  obligations.forEach((selection, index) => {
    const requestedCategory = String(selection.category || selection.service_key || '')
      .replace(/^one_off:\d+$/, 'one_off');
    const requestedInvoice = selection.invoice_id == null ? null : Number(selection.invoice_id);
    const requestedLine = selection.invoice_line_item_id == null ? null : Number(selection.invoice_line_item_id);
    const requestedFee = selection.fee_id == null ? null : Number(selection.fee_id);
    const target = canonical.find((obligation) => (
      (selection.obligation_id && obligation.obligation_id === selection.obligation_id) ||
      (requestedInvoice != null && obligation.invoice_id === requestedInvoice &&
        (requestedLine == null || obligation.invoice_line_item_id === requestedLine) &&
        (requestedFee == null || obligation.one_off_fee_id === requestedFee) &&
        (!requestedCategory || obligation.category === requestedCategory))
    ));
    if (!target) {
      const error = new Error(`selector ${index + 1} does not identify a current payable obligation`);
      error.status = 409;
      error.safeMessage = 'One of the selected payment items is no longer payable. Reload the payment choices and retarget it.';
      throw error;
    }
    if (!target.is_payable) {
      const error = new Error(`selector ${index + 1} is ${target.status}`);
      error.status = 409;
      error.safeMessage = target.status === 'PENDING_REVIEW'
        ? 'One of the selected payment items is already pending admin review.'
        : target.status === 'REQUIRES_RECONCILIATION'
          ? 'One of the selected payment items requires reconciliation before it can be paid.'
          : 'One of the selected payment items is already settled.';
      throw error;
    }
    if (selection.amount != null && Number(selection.amount) > target.amount_outstanding + 0.005) {
      const error = new Error(`selector ${index + 1} exceeds canonical outstanding amount`);
      error.status = 422;
      error.safeMessage = `${target.label} has only R ${Number(target.amount_outstanding).toFixed(2)} outstanding.`;
      throw error;
    }
  });
};

const approvalUnallocatedDisposition = (selectedObligations, paymentAmount, body = {}) => {
  const explicitAllocation = Array.isArray(selectedObligations);
  const selectedAmount = explicitAllocation
    ? selectedObligations.reduce((sum, item) => sum + (item.amount == null ? 0 : Number(item.amount)), 0)
    : Number(paymentAmount);
  const unallocatedAmount = explicitAllocation
    ? Math.max(0, Number(paymentAmount) - selectedAmount)
    : 0;
  const acknowledged = body.unallocated_acknowledged === true ||
    body.unallocated_acknowledged === 'true';
  const reason = boundedText(body.unallocated_reason, 500, 'Unallocated credit reason');
  if (unallocatedAmount > 0.009 && (!acknowledged || !reason)) {
    const error = new Error('Unallocated credit requires explicit acknowledgement and reason');
    error.status = 422;
    error.safeMessage = `R ${unallocatedAmount.toFixed(2)} of this payment is not allocated. Confirm the unallocated credit and provide a reason before approving.`;
    throw error;
  }
  return { explicitAllocation, unallocatedAmount, acknowledged, reason };
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
    await client.query('BEGIN');
    // Reservation locks are required for every selected-obligation submission,
    // including requests carrying an idempotency key. They are deliberately
    // acquired before any pending-payments read so the read and INSERT share
    // one serialized critical section.
    await acquireCanonicalObligationLocks(client, child.id, selectedObligations);
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
    let storedObligations = [];
    if (selectedObligations.length) {
      // Re-read the canonical payable model after the advisory locks. A
      // competing committed pending proof is therefore observed before this
      // transaction can INSERT its own reservation.
      await validateCanonicalSelections(client, child.id, selectedObligations);
      const resolved = await resolvePaymentProposals(client, child.id, selectedObligations);
      validateResolvedPlan(resolved, normalizedAmount);
      storedObligations = normaliseStoredObligations(resolved);
    }

    const commandResult = await financeCommands.createPaymentProof({
      executor: client,
      parentId: req.user.id,
      learnerId: child.id,
      amount: normalizedAmount,
      paymentMethod: normalizedMethod,
      reference: normalizedReference,
      notes: normalizedNotes,
      receiptFileName,
      receiptFilePath,
      receiptS3Key,
      receiptS3Url,
      receiptMime,
      receiptData,
      obligations: storedObligations,
      idempotencyKey,
      actor: {
        id: req.user.id,
        name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        role: req.user.role,
        ipAddress: getIp(req),
      },
    });
    const submission = commandResult.submission;
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
    if (err.status) return res.status(err.status).json({ message: err.safeMessage || err.message });
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
    let normalizedByProof = null;
    const normalizedAuthoritativeIds = new Set();
    try {
      const normalized = await db.query(`
        SELECT proof_id, invoice_id, invoice_line_item_id, fee_assignment_id,
               category, proposed_amount, resolution_state
        FROM payment_proof_allocation_proposals
        WHERE proof_id = ANY($1::integer[])
          AND resolution_state IN ('proposed','accepted')
        ORDER BY id
      `, [result.rows.map((submission) => Number(submission.id))]);
      normalizedByProof = new Map();
      normalized.rows.forEach((row) => {
        if (!normalizedByProof.has(Number(row.proof_id))) normalizedByProof.set(Number(row.proof_id), []);
        normalizedByProof.get(Number(row.proof_id)).push({
          invoice_id: row.invoice_id,
          invoice_line_item_id: row.invoice_line_item_id,
          fee_assignment_id: row.fee_assignment_id,
          category: row.category,
          amount: Number(row.proposed_amount),
        });
      });
      const markers = await db.query(`
        SELECT entity_id, details
        FROM audit_logs
        WHERE entity_type='payment_proof'
          AND action IN ('payment_proof_submit','payment_proof_retarget')
          AND entity_id = ANY($1::integer[])
        ORDER BY id
      `, [result.rows.map((submission) => Number(submission.id))]);
      markers.rows.forEach((row) => {
        let details = row.details;
        if (typeof details === 'string') {
          try { details = JSON.parse(details); } catch (_) { details = null; }
        }
        if (details?.normalized_proposals_available === true) {
          normalizedAuthoritativeIds.add(Number(row.entity_id));
        }
      });
    } catch (error) {
      if (error.code !== '42P01' && error.code !== '42703') throw error;
    }
    const submissions = result.rows.map((submission) => {
      let selected = normalizedByProof && normalizedAuthoritativeIds.has(Number(submission.id))
        ? (normalizedByProof.get(Number(submission.id)) || [])
        : submission.selected_obligations;
      if (typeof selected === 'string') {
        try { selected = JSON.parse(selected); } catch (_) { selected = []; }
      }
      const ambiguous = (Array.isArray(selected) ? selected : []).some((item) => {
        const hasIdentity = item?.obligation_id || item?.invoice_id ||
          item?.invoice_line_item_id || item?.fee_id || item?.assignment_id;
        return !hasIdentity && Boolean(item?.category || item?.service_key);
      });
      return {
        ...submission,
        legacy_allocation_review: ambiguous ? {
          code: 'LEGACY_AMBIGUOUS_ALLOCATION',
          message: 'Legacy ambiguous allocation — Admin retarget required',
        } : null,
      };
    });
    res.json({ submissions });
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
    const obligations = await getPayableObligations(proof.student_id, db, {
      excludePaymentId: proof.id,
    });
    const options = obligations.filter((obligation) => obligation.is_payable).map((obligation) => ({
      obligation_id: obligation.obligation_id,
      invoice_id: obligation.invoice_id,
      invoice_line_item_id: obligation.invoice_line_item_id,
      fee_id: obligation.one_off_fee_id,
      assignment_id: obligation.assignment_id,
      category: obligation.category,
      service_key: obligation.service_key,
      legacy_invoice_level: obligation.obligation_type === 'legacy_invoice',
      amount: obligation.amount_outstanding,
      due_date: obligation.due_date,
      reference_number: obligation.reference_number,
      label: `${obligation.label} — ${obligation.category === 'one_off'
        ? obligation.due_date_label || obligation.due_date
        : obligation.billing_period_label || obligation.billing_period || obligation.due_date
      } — R ${Number(obligation.amount_outstanding).toFixed(2)} outstanding`,
    }));
    res.json({ options, automatic_destination: options[0] || null });
  } catch (error) {
    console.error('Payment allocation options error:', error);
    res.status(500).json({ message: 'Could not load allocation options' });
  }
});

router.put('/:id/allocations', requireAdmin, async (req, res) => {
  try {
    const reason = boundedText(req.body?.reason, 500, 'Adjustment reason');
    if (!reason) return res.status(400).json({ message: 'An allocation adjustment reason is required' });
    const obligations = parseSelectedObligations(req.body?.obligations);
    const unallocatedAcknowledged = req.body?.unallocated_acknowledged === true ||
      req.body?.unallocated_acknowledged === 'true';
    if (!obligations.length) {
      if (!unallocatedAcknowledged) {
        return res.status(422).json({
          message: 'Confirm that the full payment will remain unallocated credit before saving an empty allocation.',
        });
      }
      await financeCommands.retargetProof({
        proofId: req.params.id,
        obligations: [],
        actor: {
          id: req.user.id,
          name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
          role: req.user.role,
          ipAddress: getIp(req),
        },
        reason,
      });
      return res.json({ message: 'Payment will be recorded as unallocated credit', obligations: [] });
    }
    const result = await financeCommands.retargetProof({
      proofId: req.params.id,
      obligations,
      actor: {
        id: req.user.id,
        name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        role: req.user.role,
        ipAddress: getIp(req),
      },
      reason,
    });
    res.json({ message: 'Proposed allocation updated', obligations: result.obligations });
  } catch (error) {
    console.error('Adjust proof allocation error:', error);
    res.status(error.status || 500).json({
      message: error.safeMessage || (error.status ? error.message : 'Could not adjust allocation'),
    });
  }
});

// ─── POST /api/payment-proofs/:id/approve  (admin approves) ──────────────────
router.post('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const admin_note = boundedText(req.body?.admin_note, 2000, 'Admin note');
    const result = await financeCommands.approveProof({
      proofId: req.params.id,
      adminNote: admin_note,
      unallocatedAcknowledged: req.body?.unallocated_acknowledged,
      unallocatedReason: boundedText(req.body?.unallocated_reason, 500, 'Unallocated credit reason'),
      actor: {
        id: req.user.id,
        name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        role: req.user.role,
        ipAddress: getIp(req),
      },
    });
    res.json({
      message: result.idempotent
        ? 'Payment proof was already approved'
        : 'Payment approved and applied to student balance',
      status: 'approved',
      transaction_ids: result.transactionIds,
    });
    setImmediate(async () => {
      await Promise.allSettled([
        notifyPayment({
          kind: 'approved',
          paymentId: result.proof.id,
          learnerId: result.proof.student_id,
          amount: result.proof.amount,
        }),
        notifyPayment({
          kind: 'applied',
          paymentId: result.proof.id,
          learnerId: result.proof.student_id,
          amount: result.proof.amount,
        }),
      ]);
    });
  } catch (err) {
    console.error('Approve proof error:', {
      message: err.message,
      code: err.code,
      stage: err.financeStage || 'approval',
      obligationIndex: err.obligationIndex,
      obligationCategory: err.obligationCategory,
    });
    if (err.status) return res.status(err.status).json({
      success: false,
      message: err.safeMessage || err.message,
    });
    res.status(500).json({ message: 'Server error approving payment' });
  } finally {
  }
});

// ─── POST /api/payment-proofs/:id/reject  (admin rejects) ────────────────────
router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const admin_note = boundedText(req.body?.admin_note, 2000, 'Admin note');
    const result = await financeCommands.rejectProof({
      proofId: req.params.id,
      adminNote: admin_note,
      idempotencyKey: req.get('Idempotency-Key'),
      actor: {
        id: req.user.id,
        name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        role: req.user.role,
        ipAddress: getIp(req),
      },
    });
    const proof = result.proof || {};
    res.json({ message: result.idempotent ? 'Submission was already rejected' : 'Submission rejected' });
    if (!result.idempotent && proof.id) {
      setImmediate(() => notifyPayment({
        kind: 'rejected',
        paymentId: proof.id,
        learnerId: proof.student_id,
        reason: admin_note,
      }).catch((error) => console.warn('Post-commit rejection notification failed:', error.message)));
    }
  } catch (err) {
    console.error('Reject proof error:', err);
    res.status(err.status || 500).json({ message: err.safeMessage || err.message || 'Server error rejecting payment' });
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
module.exports.validateResolvedPlan = validateResolvedPlan;
module.exports.applyPaymentToInvoices = applyPaymentToInvoices;
module.exports.approvalUnallocatedDisposition = approvalUnallocatedDisposition;
module.exports.parseSelectedObligations = parseSelectedObligations;
module.exports.validateExplicitObligationAmounts = validateExplicitObligationAmounts;
module.exports.canonicalObligationLockKeys = canonicalObligationLockKeys;
module.exports.acquireCanonicalObligationLocks = acquireCanonicalObligationLocks;
module.exports.validateCanonicalSelections = validateCanonicalSelections;
