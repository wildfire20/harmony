/*
 * Finance command layer.
 *
 * This is the write authority for payment events.  Read routes may continue
 * using financeLedger for backwards compatibility, but new write paths should
 * call this module rather than composing BEGIN/COMMIT, invoice updates and
 * audit writes themselves.
 *
 * The service deliberately does not create schema objects.  It works with the
 * existing invoice/payment model and fails closed when a requested target
 * cannot be proved to belong to the learner.
 */
const db = require('../config/database');
const crypto = require('node:crypto');
const { logAudit } = require('../utils/auditLogger');
const {
  allocatePayment,
  reversePayment: ledgerReversePayment,
  money,
  buildInvoiceSnapshotLines,
} = require('./financeLedger');
const {
  getBillingEnrollmentsForLearners,
} = require('./serviceEnrollmentService');
const {
  acquireInvoiceObligationLocks,
  invoiceObligationLockKeys,
  normaliseCategory,
} = require('./invoiceObligationLocks');

const COMMAND_LOCK_NAMESPACE = 'harmony:finance-command:v1';

class FinanceCommandError extends Error {
  constructor(message, status = 422, safeMessage = message) {
    super(message);
    this.name = 'FinanceCommandError';
    this.status = status;
    this.safeMessage = safeMessage;
  }
}

const asId = (value, label) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new FinanceCommandError(`Invalid ${label}`, 422, `The ${label} is invalid.`);
  }
  return id;
};

const amount = (value) => {
  const result = money(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new FinanceCommandError('Payment amount must be positive', 422, 'Payment amount must be positive.');
  }
  return result;
};

const normaliseObligations = (obligations) => {
  if (obligations == null) return null;
  if (!Array.isArray(obligations)) {
    throw new FinanceCommandError(
      'Obligations must be an array or null',
      422,
      'The allocation plan is invalid. Reload and try again.',
    );
  }
  return obligations.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new FinanceCommandError(`Invalid obligation ${index + 1}`, 422);
    }
    const invoiceId = item.invoice_id ?? item.invoiceId;
    const lineId = item.invoice_line_item_id ?? item.invoiceLineItemId;
    const feeId = item.fee_id ?? item.feeId;
    const assignmentId = item.assignment_id ?? item.assignmentId;
    const category = normaliseCategory(item.category || item.service_key);
    const result = {
      obligation_id: item.obligation_id || item.obligationId || null,
      invoice_id: invoiceId == null ? null : asId(invoiceId, 'invoice ID'),
      invoice_line_item_id: lineId == null ? null : asId(lineId, 'invoice line ID'),
      fee_id: feeId == null ? null : asId(feeId, 'fee ID'),
      assignment_id: assignmentId == null ? null : asId(assignmentId, 'assignment ID'),
      category: category === 'unknown' ? null : category,
      amount: item.amount == null ? null : amount(item.amount),
      legacy_invoice_level: item.legacy_invoice_level === true ||
        item.legacyInvoiceLevel === true,
    };
    if (!result.invoice_id && !result.fee_id && !result.obligation_id) {
      throw new FinanceCommandError(
        `Obligation ${index + 1} has no exact identity`,
        422,
        'Every allocation must identify an exact invoice or obligation.',
      );
    }
    return result;
  });
};

const descriptorsFor = (studentId, obligations = []) => obligations.map((item) => ({
  invoiceId: item.invoice_id,
  studentId,
  lineId: item.invoice_line_item_id == null ? 'legacy' : item.invoice_line_item_id,
  category: item.category,
  feeId: item.fee_id,
}));

const idempotencyDetails = (value) => {
  if (value == null || value === '') return null;
  const key = String(value).trim();
  if (!/^[A-Za-z0-9_.:/-]{8,200}$/.test(key)) {
    throw new FinanceCommandError('Invalid idempotency key', 400, 'Invalid request key.');
  }
  return key;
};

const derivedIdempotencyKey = (prefix, value) =>
  `${prefix}:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)}`;

async function withTransaction(work, executor = null) {
  if (executor) {
    await executor.query(
      `SELECT set_config('harmony.finance_command', 'canonical', true)`,
    );
    return work(executor, false);
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('harmony.finance_command', 'canonical', true)`,
    );
    const result = await work(client, true);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function lockIdempotency(executor, key) {
  if (!key) return;
  await executor.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [COMMAND_LOCK_NAMESPACE, key],
  );
}

/*
 * Idempotency is intentionally backed by the existing audit table rather than
 * a migration hidden in a command.  The audit row and payment events are
 * inserted in the same transaction, so a retry observes either all or none
 * of the command.  The advisory lock serializes two first attempts.
 */
async function findCompletedCommand(executor, action, key) {
  if (!key) return null;
  const result = await executor.query(`
    SELECT entity_id, details
    FROM audit_logs
    WHERE action = $1 AND details->>'idempotency_key' = $2
    ORDER BY id DESC
    LIMIT 1
    FOR SHARE
  `, [action, key]);
  if (!result.rows.length) return null;
  let details = result.rows[0].details;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch (_) { details = {}; }
  }
  return {
    idempotent: true,
    entityId: result.rows[0].entity_id == null ? null : Number(result.rows[0].entity_id),
    transactionIds: Array.isArray(details?.transaction_ids)
      ? details.transaction_ids.map(Number) : [],
    details: details || {},
  };
}

async function audit(executor, actor, action, entityType, entityId, details = {}) {
  await logAudit({
    executor,
    required: true,
    userId: actor?.id ?? actor?.userId ?? null,
    userName: actor?.name || actor?.userName || null,
    userRole: actor?.role || null,
    action,
    entityType,
    entityId,
    details,
    ipAddress: actor?.ipAddress || null,
  });
}

/*
 * Validate exact invoice/line/category identity while the canonical
 * obligation locks are held.  No current enrollment or service price is
 * consulted here: persisted invoice snapshots are the authority.
 */
async function validateExactObligations(executor, studentId, obligations) {
  if (!Array.isArray(obligations) || obligations.length === 0) return;
  const invoiceIds = [...new Set(obligations.map((item) => item.invoice_id).filter(Boolean))];
  if (!invoiceIds.length) {
    throw new FinanceCommandError(
      'Allocation has no invoice identity',
      422,
      'Retarget the allocation to an exact payable obligation.',
    );
  }
  const invoices = await executor.query(`
    SELECT id, student_id, amount_due, amount_paid, status
    FROM invoices
    WHERE student_id = $1 AND id = ANY($2::integer[])
    FOR UPDATE
  `, [asId(studentId, 'learner ID'), invoiceIds]);
  const byId = new Map(invoices.rows.map((row) => [Number(row.id), row]));
  const lines = await executor.query(`
    SELECT id, invoice_id, line_type, service_key, amount, is_included, metadata
    FROM invoice_line_items
    WHERE invoice_id = ANY($1::integer[])
    ORDER BY invoice_id, id
  `, [invoiceIds]);
  const linesByInvoice = new Map();
  lines.rows.forEach((line) => {
    const id = Number(line.invoice_id);
    if (!linesByInvoice.has(id)) linesByInvoice.set(id, []);
    linesByInvoice.get(id).push(line);
  });

  for (const [index, obligation] of obligations.entries()) {
    if (obligation.invoice_id == null) {
      throw new FinanceCommandError(
        `Obligation ${index + 1} is not invoice-addressable`,
        409,
        'This legacy allocation must be retargeted to an exact invoice.',
      );
    }
    const invoice = byId.get(obligation.invoice_id);
    if (!invoice || Number(invoice.amount_paid) >= Number(invoice.amount_due)) {
      throw new FinanceCommandError(
        `Invoice ${obligation.invoice_id} is no longer outstanding`,
        409,
        'One of the selected payment items is no longer outstanding.',
      );
    }
    if (obligation.invoice_line_item_id != null) {
      const line = (linesByInvoice.get(obligation.invoice_id) || [])
        .find((row) => Number(row.id) === obligation.invoice_line_item_id);
      if (!line || line.line_type !== 'charge' || line.is_included) {
        throw new FinanceCommandError(
          `Invoice line ${obligation.invoice_line_item_id} is not payable`,
          409,
          'One of the selected payment items is not a payable charge.',
        );
      }
      const metadata = line.metadata || {};
      const actualCategory = metadata.category === 'one_off' || metadata.fee_id != null
        ? 'one_off' : normaliseCategory(line.service_key);
      if (obligation.category && obligation.category !== actualCategory) {
        throw new FinanceCommandError(
          `Allocation category does not match invoice line ${line.id}`,
          422,
          'One of the selected payment items does not match its invoice.',
        );
      }
      if (obligation.fee_id != null &&
          Number(metadata.fee_id) !== obligation.fee_id) {
        throw new FinanceCommandError(
          `Fee ${obligation.fee_id} does not match invoice line ${line.id}`,
          422,
          'One of the selected one-off fees does not match its invoice.',
        );
      }
      if (obligation.assignment_id != null &&
          Number(metadata.assignment_id) !== obligation.assignment_id) {
        throw new FinanceCommandError(
          `Assignment ${obligation.assignment_id} does not match invoice line ${line.id}`,
          422,
          'One of the selected fee assignments does not match its invoice.',
        );
      }
    } else if (obligation.category) {
      const matches = (linesByInvoice.get(obligation.invoice_id) || []).some((line) => {
        if (line.line_type !== 'charge' || line.is_included || Number(line.amount) <= 0) return false;
        const metadata = line.metadata || {};
        const category = metadata.category === 'one_off' || metadata.fee_id != null
          ? 'one_off' : normaliseCategory(line.service_key);
        return category === obligation.category;
      });
      if (!matches && !obligation.legacy_invoice_level) {
        throw new FinanceCommandError(
          `Allocation category does not match invoice ${obligation.invoice_id}`,
          422,
          'One of the selected payment items does not match its invoice.',
        );
      }
    }
  }
}

async function verifyLedger(executor, invoiceIds = []) {
  const ids = [...new Set(invoiceIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return { verified: true, invoices: [] };
  const result = await executor.query(`
    SELECT id, amount_due, amount_paid, status
    FROM invoices
    WHERE id = ANY($1::integer[])
    FOR SHARE
  `, [ids]);
  if (result.rows.length !== ids.length) {
    throw new FinanceCommandError('Ledger verification failed: invoice disappeared', 409);
  }
  result.rows.forEach((invoice) => {
    const due = money(invoice.amount_due);
    const paid = money(invoice.amount_paid);
    if (due < 0 || paid < 0) {
      throw new FinanceCommandError('Ledger verification failed: negative invoice balance', 409);
    }
    if (invoice.status === 'Carried Forward') return;
    const expected = paid > due ? 'Overpaid' : due === 0 || paid >= due ? 'Paid' :
      paid > 0 ? 'Partial' : 'Unpaid';
    if (invoice.status !== expected) {
      throw new FinanceCommandError(
        `Ledger verification failed for invoice ${invoice.id}`,
        409,
        'The payment could not be committed because the ledger changed. Please retry.',
      );
    }
  });
  return { verified: true, invoices: result.rows };
}

async function insertUnallocated(executor, {
  studentId, amount: paymentAmount, paymentDate, paymentMethod, reference,
  description, recordedBy,
}) {
  const student = await executor.query(
    `SELECT student_number FROM users WHERE id=$1 AND role='student' FOR SHARE`,
    [asId(studentId, 'learner ID')],
  );
  if (!student.rows.length) throw new FinanceCommandError('Student not found', 404);
  const total = amount(paymentAmount);
  const date = paymentDate || new Date().toISOString().slice(0, 10);
  const result = await executor.query(`
    INSERT INTO payment_transactions
      (invoice_id, student_id, student_number, reference_number, reference,
       amount, transaction_date, payment_date, description, payment_method, recorded_by)
    VALUES (NULL,$1,$2,$3,$3,$4,$5,$5,$6,$7,$8)
    RETURNING id
  `, [
    asId(studentId, 'learner ID'), student.rows[0].student_number,
    reference, total.toFixed(2), date, description || 'Unallocated payment',
    paymentMethod || 'manual_entry', recordedBy || null,
  ]);
  return {
    total,
    allocations: [{ transactionId: result.rows[0].id, invoiceId: null, amount: total }],
  };
}

async function normalizedProofTablesAvailable(executor) {
  try {
    await executor.query(
      `SELECT id, proof_id, learner_id, category, proposed_amount
       FROM payment_proof_allocation_proposals LIMIT 0`,
    );
    await executor.query(
      `SELECT id, proposal_id, proof_id, allocated_amount
       FROM payment_proof_allocations LIMIT 0`,
    );
    return true;
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') return false;
    throw error;
  }
}

const proofCategory = (value) => {
  const category = normaliseCategory(value);
  return ['tuition', 'boarding', 'transport', 'aftercare', 'one_off',
    'other_recurring', 'credit'].includes(category) ? category : 'other_recurring';
};

async function writeNormalizedProofProposals(executor, {
  proofId, learnerId, obligations, idempotencyKey,
}) {
  if (!(await normalizedProofTablesAvailable(executor))) return { available: false, rows: [] };
  const rows = [];
  const merged = new Map();
  for (const obligation of obligations || []) {
    const category = proofCategory(obligation.category || obligation.service_key);
    const mergeKey = [
      obligation.invoice_id || '', obligation.invoice_line_item_id || '',
      obligation.assignment_id || '', category,
    ].join(':');
    const current = merged.get(mergeKey);
    if (current) current.amount = money(current.amount + amount(obligation.amount));
    else merged.set(mergeKey, { ...obligation, category });
  }
  for (const [index, obligation] of [...merged.values()].entries()) {
    const key = `${idempotencyKey || `proof:${proofId}`}:proposal:${index}`;
    const target = [
      obligation.invoice_id || null, obligation.invoice_line_item_id || null,
      obligation.assignment_id || null, obligation.category,
    ];
    const existing = await executor.query(`
      SELECT id
      FROM payment_proof_allocation_proposals
      WHERE proof_id=$1 AND learner_id=$2
        AND COALESCE(invoice_id,0)=COALESCE($3::integer,0)
        AND COALESCE(invoice_line_item_id,0)=COALESCE($4::integer,0)
        AND COALESCE(fee_assignment_id,0)=COALESCE($5::integer,0)
        AND category=$6
      LIMIT 1
    `, [proofId, learnerId, ...target]);
    const result = existing.rows.length
      ? await executor.query(`
        UPDATE payment_proof_allocation_proposals
        SET proposed_amount=$1, resolution_state='proposed',
            idempotency_key=$2, resolved_at=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=$3
        RETURNING *
      `, [amount(obligation.amount), key, existing.rows[0].id])
      : await executor.query(`
        INSERT INTO payment_proof_allocation_proposals
          (proof_id, learner_id, invoice_id, invoice_line_item_id, fee_assignment_id,
           category, proposed_amount, resolution_state, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'proposed',$8)
        RETURNING *
      `, [
        proofId, learnerId, ...target.slice(0, 3), target[3],
        amount(obligation.amount), key,
      ]);
    if (result.rows[0]) rows.push(result.rows[0]);
  }
  return { available: true, rows };
}

async function readNormalizedProofObligations(executor, proofId) {
  if (!(await normalizedProofTablesAvailable(executor))) return { available: false, obligations: null, rows: [] };
  const result = await executor.query(`
    SELECT id, proof_id, learner_id, invoice_id, invoice_line_item_id,
           fee_assignment_id, category, proposed_amount, resolution_state
    FROM payment_proof_allocation_proposals
    WHERE proof_id=$1 AND resolution_state IN ('proposed','accepted')
    ORDER BY id
  `, [proofId]);
  return {
    available: true,
    rows: result.rows,
    obligations: result.rows.map((row) => ({
      obligation_id: `proposal:${row.id}`,
      invoice_id: row.invoice_id,
      invoice_line_item_id: row.invoice_line_item_id,
      assignment_id: row.fee_assignment_id,
      category: row.category,
      amount: Number(row.proposed_amount),
      proposal_id: row.id,
    })),
  };
}

async function recordNormalizedProofAllocations(executor, {
  proofId, learnerId, proposalRows, allocations, idempotencyKey,
}) {
  if (!proposalRows.length) return;
  for (const proposal of proposalRows) {
    const matching = allocations.filter((item) =>
      Number(item.invoiceId) === Number(proposal.invoice_id));
    const allocatedAmount = money(matching.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    if (allocatedAmount <= 0) continue;
    await executor.query(`
      INSERT INTO payment_proof_allocations
        (proposal_id, proof_id, learner_id, invoice_id, invoice_line_item_id,
         fee_assignment_id, category, proposed_amount, allocated_amount,
         resolution_state, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',$10)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [
      proposal.id, proofId, learnerId, proposal.invoice_id || null,
      proposal.invoice_line_item_id || null, proposal.fee_assignment_id || null,
      proofCategory(proposal.category), Number(proposal.proposed_amount),
      allocatedAmount, `${idempotencyKey || `proof:${proofId}`}:allocation:${proposal.id}`,
    ]);
    await executor.query(`
      UPDATE payment_proof_allocation_proposals
      SET resolution_state='accepted', resolved_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND resolution_state='proposed'
    `, [proposal.id]);
  }
}

async function executePayment(executor, options) {
  const studentId = asId(options.studentId, 'learner ID');
  const total = amount(options.amount);
  const obligations = normaliseObligations(options.obligations ?? options.allocationProposals);
  const matchedTarget = options.matchedInvoiceId ?? options.invoiceId;
  const matchedInvoiceId = matchedTarget == null
    ? null : asId(matchedTarget, 'matched invoice ID');
  const lockObligations = obligations || (matchedInvoiceId ? [{
    invoice_id: matchedInvoiceId,
    invoice_line_item_id: null,
    category: options.category || null,
    fee_id: null,
  }] : []);
  // Automatic/arrears-first allocation has no submitted target from which to
  // derive a lock.  Lock every currently payable invoice for the learner
  // before the allocator reads them.  This keeps an automatic proof from
  // racing an explicitly targeted proof.
  if (!obligations && !matchedInvoiceId) {
    const openInvoices = await executor.query(`
      SELECT id
      FROM invoices
      WHERE student_id=$1 AND amount_paid < amount_due
      ORDER BY due_date, id
      FOR SHARE
    `, [studentId]);
    openInvoices.rows.forEach((row) => lockObligations.push({
      invoice_id: Number(row.id),
      invoice_line_item_id: null,
      category: null,
      fee_id: null,
    }));
  }
  await acquireInvoiceObligationLocks(executor, descriptorsFor(studentId, lockObligations));
  if (obligations && obligations.length) await validateExactObligations(executor, studentId, obligations);
  if (matchedInvoiceId) {
    await validateExactObligations(executor, studentId, [{
      invoice_id: matchedInvoiceId,
      category: options.category || null,
    }]);
  }

  let allocation;
  if (Array.isArray(obligations) && obligations.length === 0) {
    allocation = await insertUnallocated(executor, {
      studentId, amount: total, paymentDate: options.paymentDate,
      paymentMethod: options.paymentMethod, reference: options.reference,
      description: options.description, recordedBy: options.recordedBy,
    });
  } else {
    allocation = await allocatePayment(executor, {
      studentId,
      amount: total,
      paymentDate: options.paymentDate,
      paymentMethod: options.paymentMethod || 'manual_entry',
      reference: options.reference,
      description: options.description,
      recordedBy: options.recordedBy,
      invoiceId: matchedInvoiceId,
      transactionMonth: options.transactionMonth,
      transactionYear: options.transactionYear,
      allocationProposals: obligations && obligations.length
        ? obligations.map((item) => ({
          invoice_id: item.invoice_id,
          invoice_line_item_id: item.invoice_line_item_id,
          fee_id: item.fee_id,
          assignment_id: item.assignment_id,
          amount: item.amount,
          category: item.category,
          legacy_invoice_level: item.legacy_invoice_level,
        })) : null,
    });
  }
  const invoiceIds = allocation.allocations
    .map((item) => item.invoiceId).filter((id) => id != null);
  await verifyLedger(executor, invoiceIds);
  return allocation;
}

async function recordPayment(options = {}) {
  const key = idempotencyDetails(options.idempotencyKey);
  const action = options.action || 'finance_payment_record';
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, key);
    const previous = await findCompletedCommand(executor, action, key);
    if (previous) return previous;
    const allocation = await executePayment(executor, options);
    const transactionIds = allocation.allocations.map((item) => item.transactionId);
    if (options.skipAudit !== true) {
      await audit(executor, options.actor || {
        id: options.recordedBy,
      }, action, 'payment', transactionIds[0] || null, {
        amount: allocation.total,
        student_id: Number(options.studentId),
        transaction_ids: transactionIds,
        allocation_count: allocation.allocations.length,
        idempotency_key: key,
        matched_invoice_id: options.matchedInvoiceId || null,
      });
    }
    return { ...allocation, transactionIds, idempotent: false };
  }, options.executor);
}

async function createPaymentProof(options = {}) {
  const key = idempotencyDetails(options.idempotencyKey);
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, key);
    if (key) {
      const prior = await findCompletedCommand(executor, 'payment_proof_submit', key);
      if (prior) {
        const existing = (await executor.query(
          `SELECT * FROM pending_payments WHERE id=$1`,
          [prior.entityId],
        )).rows[0];
        return { submission: existing, idempotent: true, normalized: true };
      }
    }
    const selected = options.obligations == null ? [] : options.obligations;
    const normalizedAvailable = await normalizedProofTablesAvailable(executor);
    let pending;
    if (normalizedAvailable) {
      pending = (await executor.query(`
        INSERT INTO pending_payments
          (parent_id, student_id, amount, payment_method, reference, notes,
           receipt_file_name, receipt_file_path, receipt_s3_key, receipt_s3_url,
           receipt_mime_type, receipt_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [
        options.parentId, options.learnerId, amount(options.amount).toFixed(2),
        options.paymentMethod, options.reference || null, options.notes || null,
        options.receiptFileName || null, options.receiptFilePath || null,
        options.receiptS3Key || null, options.receiptS3Url || null,
        options.receiptMime || null, options.receiptData || null,
      ])).rows[0];
    } else {
      try {
      pending = (await executor.query(`
        INSERT INTO pending_payments
          (parent_id, student_id, amount, payment_method, reference, notes,
           receipt_file_name, receipt_file_path, receipt_s3_key, receipt_s3_url,
           receipt_mime_type, receipt_data, selected_obligations)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
        RETURNING *
      `, [
        options.parentId, options.learnerId, amount(options.amount).toFixed(2),
        options.paymentMethod, options.reference || null, options.notes || null,
        options.receiptFileName || null, options.receiptFilePath || null,
        options.receiptS3Key || null, options.receiptS3Url || null,
        options.receiptMime || null, options.receiptData || null,
        JSON.stringify(selected),
      ])).rows[0];
      } catch (error) {
        if (error.code !== '42703') throw error;
        pending = (await executor.query(`
        INSERT INTO pending_payments
          (parent_id, student_id, amount, payment_method, reference, notes,
           receipt_file_name, receipt_file_path, receipt_s3_key, receipt_s3_url,
           receipt_mime_type, receipt_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [
        options.parentId, options.learnerId, amount(options.amount).toFixed(2),
        options.paymentMethod, options.reference || null, options.notes || null,
        options.receiptFileName || null, options.receiptFilePath || null,
        options.receiptS3Key || null, options.receiptS3Url || null,
        options.receiptMime || null, options.receiptData || null,
        ])).rows[0];
      }
    }
    const normalized = normalizedAvailable
      ? await writeNormalizedProofProposals(executor, {
        proofId: pending.id,
        learnerId: options.learnerId,
        obligations: selected,
        idempotencyKey: key,
      })
      : { available: false, rows: [] };
    await audit(executor, options.actor, 'payment_proof_submit', 'payment_proof', pending.id, {
      idempotency_key: key,
      student_id: Number(options.learnerId),
      amount: Number(pending.amount),
      normalized_proposals_available: normalized.available,
      normalized_proposal_ids: normalized.rows.map((row) => row.id),
      selected_obligations: selected,
    });
    return { submission: pending, idempotent: false, normalized: normalized.available };
  }, options.executor);
}

async function approveProof(options = {}) {
  const proofId = asId(options.proofId, 'payment proof ID');
  const key = idempotencyDetails(options.idempotencyKey || `proof-approval:${proofId}`);
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, key);
    const proofResult = await executor.query(
      `SELECT * FROM pending_payments WHERE id=$1 FOR UPDATE`, [proofId],
    );
    const proof = proofResult.rows[0];
    if (!proof) throw new FinanceCommandError('Submission not found', 404);
    if (proof.status === 'approved') {
      const prior = await executor.query(
        `SELECT id FROM payment_transactions WHERE reference_number=$1 ORDER BY id`,
        [`PROOF-${proofId}`],
      );
      return {
        proof,
        transactionIds: prior.rows.map((row) => Number(row.id)),
        idempotent: true,
      };
    }
    if (proof.status !== 'pending') {
      throw new FinanceCommandError(`This submission is already ${proof.status}`, 409);
    }
    const normalized = await readNormalizedProofObligations(executor, proofId);
    let normalizedAuthoritative = normalized.available;
    if (normalized.available) {
      const submissionAudit = await executor.query(`
        SELECT details FROM audit_logs
        WHERE action IN ('payment_proof_submit','payment_proof_retarget')
          AND entity_type='payment_proof' AND entity_id=$1
        ORDER BY id DESC LIMIT 1
      `, [proofId]);
      let details = submissionAudit.rows[0]?.details;
      if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch (_) { details = null; }
      }
      // A proof submitted before the additive tables existed has no
      // normalized source of truth; retain JSON compatibility for that case.
      if (!details || details.normalized_proposals_available === false) {
        normalizedAuthoritative = false;
      }
    }
    let stored = normalizedAuthoritative ? normalized.obligations : proof.selected_obligations;
    if (typeof stored === 'string') {
      try { stored = JSON.parse(stored); } catch (_) { stored = null; }
    }
    const obligations = normaliseObligations(stored);
    if (Array.isArray(obligations) && obligations.every((item) => item.amount != null)) {
      const selectedTotal = money(obligations.reduce((sum, item) => sum + item.amount, 0));
      const unallocated = money(Number(proof.amount) - selectedTotal);
      if (unallocated > 0.009 &&
          options.unallocatedAcknowledged !== true &&
          options.unallocatedAcknowledged !== 'true') {
        throw new FinanceCommandError(
          'Unallocated credit requires acknowledgement',
          422,
          `R ${unallocated.toFixed(2)} of this payment is unallocated. Confirm the credit before approving.`,
        );
      }
      if (unallocated > 0.009 && !String(options.unallocatedReason || '').trim()) {
        throw new FinanceCommandError(
          'Unallocated credit requires a reason',
          422,
          'Provide a reason for the unallocated credit before approving.',
        );
      }
    }
    const allocation = await executePayment(executor, {
      studentId: proof.student_id,
      amount: proof.amount,
      paymentDate: proof.payment_date || proof.submitted_at,
      paymentMethod: 'proof_of_payment',
      reference: `PROOF-${proofId}`,
      description: `Approved proof of payment (Ref #${proofId})`,
      recordedBy: options.actor?.id,
      obligations,
      actor: options.actor,
    });
    const transactionIds = allocation.allocations.map((item) => item.transactionId);
    if (normalizedAuthoritative) {
      await recordNormalizedProofAllocations(executor, {
        proofId,
        learnerId: proof.student_id,
        proposalRows: normalized.rows,
        allocations: allocation.allocations,
        idempotencyKey: key,
      });
    }
    await executor.query(`
      UPDATE pending_payments
      SET status='approved', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, admin_note=$2
      WHERE id=$3 AND status='pending'
    `, [options.actor?.id || null, options.adminNote || null, proofId]);
    await audit(executor, options.actor, 'payment_proof_approve', 'payment_proof', proofId, {
      amount: Number(proof.amount),
      student_id: Number(proof.student_id),
      transaction_ids: transactionIds,
      idempotency_key: key,
      admin_note: options.adminNote || null,
    });
    return { proof, allocation, transactionIds, idempotent: false };
  }, options.executor);
}

async function retargetProof(options = {}) {
  const proofId = asId(options.proofId, 'payment proof ID');
  const obligations = normaliseObligations(options.obligations);
  const key = idempotencyDetails(options.idempotencyKey);
  const operationKey = key || derivedIdempotencyKey(`proof-retarget:${proofId}`, obligations || []);
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'payment_proof_retarget', operationKey);
    if (prior) return { proofId, obligations, idempotent: true };
    const proof = (await executor.query(
      `SELECT id, student_id, status FROM pending_payments WHERE id=$1 FOR UPDATE`,
      [proofId],
    )).rows[0];
    if (!proof) throw new FinanceCommandError('Submission not found', 404);
    if (proof.status !== 'pending') {
      throw new FinanceCommandError('Only pending proofs may be retargeted', 409);
    }
    const locks = obligations || [];
    await acquireInvoiceObligationLocks(executor, proof.student_id, descriptorsFor(proof.student_id, locks));
    if (obligations?.length) await validateExactObligations(executor, proof.student_id, obligations);
    const normalized = await normalizedProofTablesAvailable(executor);
    let normalizedRows = [];
    if (normalized) {
      await executor.query(`
        UPDATE payment_proof_allocation_proposals
        SET resolution_state='superseded', resolved_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE proof_id=$1 AND resolution_state='proposed'
      `, [proofId]);
      const written = await writeNormalizedProofProposals(executor, {
        proofId,
        learnerId: proof.student_id,
        obligations: obligations || [],
        idempotencyKey: operationKey,
      });
      normalizedRows = written.rows;
    }
    // JSON is retained only for legacy rows. New retargets never update it
    // when normalized proposal storage is available.
    if (!normalized) {
      try {
        await executor.query(
          `UPDATE pending_payments SET selected_obligations=$1::jsonb WHERE id=$2`,
          [JSON.stringify(obligations), proofId],
        );
      } catch (error) {
        if (error.code !== '42703') throw error;
      }
    }
    await audit(executor, options.actor, 'payment_proof_retarget', 'payment_proof', proofId, {
      student_id: Number(proof.student_id),
      normalized_proposals_available: normalized,
      normalized_proposal_ids: normalizedRows.map((row) => row.id),
      selected_obligations: obligations,
      idempotency_key: operationKey,
    });
    return { proofId, obligations, normalized: normalized, idempotent: false };
  }, options.executor);
}

async function rejectProof(options = {}) {
  const proofId = asId(options.proofId, 'payment proof ID');
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    `proof-reject:${proofId}`;
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'payment_proof_reject', operationKey);
    if (prior) return { idempotent: true, proofId };
    const proof = (await executor.query(
      `SELECT * FROM pending_payments WHERE id=$1 FOR UPDATE`, [proofId],
    )).rows[0];
    if (!proof) throw new FinanceCommandError('Submission not found', 404);
    if (proof.status !== 'pending') {
      throw new FinanceCommandError(`This submission is already ${proof.status}`, 400);
    }
    await executor.query(`
      UPDATE pending_payments
      SET status='rejected', reviewed_by=$1, reviewed_at=CURRENT_TIMESTAMP, admin_note=$2
      WHERE id=$3 AND status='pending'
    `, [options.actor?.id || null, options.adminNote || null, proofId]);
    await audit(executor, options.actor, 'payment_proof_reject', 'payment_proof', proofId, {
      amount: proof.amount,
      student_id: proof.student_id,
      reason: options.adminNote || null,
      idempotency_key: operationKey,
    });
    return { proof, idempotent: false };
  }, options.executor);
}

async function reversePayment(options = {}) {
  const transactionId = asId(options.transactionId, 'payment transaction ID');
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    `finance-reverse:${transactionId}`;
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'finance_payment_reverse', operationKey);
    if (prior) {
      return {
        alreadyReversed: true,
        reversalId: prior.details?.reversal_id || null,
        effectiveInvoiceId: prior.details?.effective_invoice_id || null,
      };
    }
    const payment = (await executor.query(`
      SELECT invoice_id, student_id
      FROM payment_transactions
      WHERE id=$1
      FOR SHARE
    `, [transactionId])).rows[0];
    if (!payment) throw new FinanceCommandError('Payment not found', 404);
    if (payment.invoice_id != null) {
      await acquireInvoiceObligationLocks(executor, payment.student_id, [{
        invoiceId: payment.invoice_id,
        studentId: payment.student_id,
        lineId: 'legacy',
        category: null,
      }]);
    }
    const result = await ledgerReversePayment(executor, {
      transactionId,
      recordedBy: options.actor?.id || options.recordedBy,
      description: options.description,
    });
    if (result.effectiveInvoiceId) await verifyLedger(executor, [result.effectiveInvoiceId]);
    await audit(executor, options.actor, 'finance_payment_reverse', 'payment', transactionId, {
      transaction_id: transactionId,
      reversal_id: result.reversalId,
      effective_invoice_id: result.effectiveInvoiceId || null,
      idempotent: result.alreadyReversed === true,
      idempotency_key: operationKey,
    });
    return result;
  }, options.executor);
}

async function applyCredit(options = {}) {
  const sourceTransactionId = asId(options.sourceTransactionId, 'credit transaction ID');
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    derivedIdempotencyKey(`credit-apply:${sourceTransactionId}`, options.obligations || options.invoiceId || null);
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'finance_credit_apply', operationKey);
    if (prior) {
      const rows = prior.transactionIds.length
        ? (await executor.query(
          `SELECT * FROM payment_transactions WHERE id=ANY($1::integer[]) ORDER BY id`,
          [prior.transactionIds],
        )).rows
        : [];
      return {
        idempotent: true,
        reversal: { reversalId: prior.details?.reversal_id || null, alreadyReversed: true },
        allocation: {
          allocations: rows.map((row) => ({
            transactionId: row.id, invoiceId: row.invoice_id, amount: Number(row.amount),
          })),
        },
      };
    }
    const source = (await executor.query(`
      SELECT id, student_id, amount, invoice_id, reverses_transaction_id
      FROM payment_transactions WHERE id=$1 FOR UPDATE
    `, [sourceTransactionId])).rows[0];
    if (!source || source.invoice_id != null || Number(source.amount) <= 0) {
      throw new FinanceCommandError('Payment is not an active unallocated credit', 409);
    }
    const reversal = await ledgerReversePayment(executor, {
      transactionId: sourceTransactionId,
      recordedBy: options.actor?.id || options.recordedBy,
      description: options.description || `Apply credit ${sourceTransactionId}`,
    });
    const requestedAmount = options.amount == null ? Number(source.amount) : amount(options.amount);
    if (requestedAmount > Number(source.amount) + 0.005) {
      throw new FinanceCommandError(
        'Credit application exceeds available credit',
        422,
        'The selected credit is smaller than the requested application.',
      );
    }
    let obligations = options.obligations == null
      ? options.obligations
      : normaliseObligations(options.obligations);
    if (obligations?.length) {
      await acquireInvoiceObligationLocks(
        executor,
        source.student_id,
        descriptorsFor(source.student_id, obligations),
      );
      const targetIds = [...new Set(obligations.map((item) => item.invoice_id).filter(Boolean))];
      const targets = (await executor.query(`
        SELECT id, amount_due, amount_paid
        FROM invoices
        WHERE student_id=$1 AND id=ANY($2::integer[])
        FOR SHARE
      `, [source.student_id, targetIds])).rows;
      const byId = new Map(targets.map((row) => [Number(row.id), row]));
      obligations = obligations.map((item) => {
        const target = byId.get(Number(item.invoice_id));
        if (!target) return item;
        const available = money(Number(target.amount_due) - Number(target.amount_paid));
        return {
          ...item,
          amount: Math.min(item.amount == null ? requestedAmount : item.amount, available),
        };
      }).filter((item) => item.amount > 0);
    }
    const allocation = await executePayment(executor, {
      ...options,
      studentId: source.student_id,
      // Consume the whole source event.  When only part of it is retargeted,
      // executePayment records the remainder as a new unallocated event,
      // preserving the immutable event history and remaining credit.
      amount: source.amount,
      paymentMethod: options.paymentMethod || 'credit_application',
      reference: options.reference || `CREDIT-${sourceTransactionId}`,
      obligations: obligations && options.amount != null
        ? obligations.map((item) => ({
          ...item,
          amount: item.amount == null ? requestedAmount : item.amount,
        }))
        : obligations,
    });
    await audit(executor, options.actor, 'finance_credit_apply', 'payment', sourceTransactionId, {
      source_transaction_id: sourceTransactionId,
      reversal_id: reversal.reversalId,
      transaction_ids: allocation.allocations.map((item) => item.transactionId),
      idempotency_key: operationKey,
    });
    return { reversal, allocation };
  }, options.executor);
}

async function correctPayment(options = {}) {
  const transactionId = asId(options.transactionId, 'payment transaction ID');
  const key = idempotencyDetails(options.idempotencyKey);
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, key);
    const previous = await findCompletedCommand(executor, 'finance_payment_correction', key);
    if (previous) {
      const ids = previous.details?.transaction_ids || [];
      const rows = ids.length
        ? (await executor.query(
          `SELECT * FROM payment_transactions WHERE id=ANY($1::integer[]) ORDER BY id`,
          [ids],
        )).rows
        : [];
      return {
        idempotent: true,
        reversal: {
          reversalId: previous.details?.reversal_id || null,
          alreadyReversed: true,
          effectiveInvoiceId: null,
        },
        allocation: {
          allocations: rows.map((row) => ({
            transactionId: row.id,
            invoiceId: row.invoice_id,
            amount: Number(row.amount),
          })),
        },
      };
    }
    const payment = (await executor.query(`
      SELECT invoice_id, student_id
      FROM payment_transactions
      WHERE id=$1
      FOR SHARE
    `, [transactionId])).rows[0];
    if (!payment) throw new FinanceCommandError('Payment not found', 404);
    if (payment.invoice_id != null) {
      await acquireInvoiceObligationLocks(executor, payment.student_id, [{
        invoiceId: payment.invoice_id, studentId: payment.student_id,
        lineId: 'legacy', category: null,
      }]);
    }
    const reversal = await ledgerReversePayment(executor, {
      transactionId,
      recordedBy: options.actor?.id || options.recordedBy,
      description: options.description || `Correction of payment ${transactionId}`,
    });
    const allocation = await executePayment(executor, {
      ...options,
      studentId: options.studentId || payment.student_id,
      matchedInvoiceId: options.matchedInvoiceId || reversal.effectiveInvoiceId,
      reference: options.reference || `CORRECTED-${transactionId}`,
      obligations: options.obligations,
    });
    await audit(executor, options.actor, 'finance_payment_correction', 'payment', transactionId, {
      transaction_id: transactionId,
      reversal_id: reversal.reversalId,
      transaction_ids: allocation.allocations.map((item) => item.transactionId),
      idempotency_key: key,
    });
    return { reversal, allocation };
  }, options.executor);
}

async function applyUnallocated(options = {}) {
  return recordPayment({
    ...options,
    obligations: [],
    paymentMethod: options.paymentMethod || 'unallocated_credit',
    action: options.action || 'finance_unallocated_payment',
  });
}

/*
 * Arrears are ordinary immutable invoice obligations.  This command keeps the
 * legacy route shape available while ensuring the learner row and duplicate
 * reference are serialized and the invoice creation is audited atomically.
 */
async function createArrears(options = {}) {
  const studentId = asId(options.studentId, 'learner ID');
  const total = amount(options.amount);
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    derivedIdempotencyKey(`arrears:${studentId}`, {
      amount: total, dueDate: options.dueDate || null, reference: options.reference || null,
    });
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'manual_arrears_created', operationKey);
    if (prior) {
      const existing = (await executor.query(
        `SELECT * FROM invoices WHERE id=$1`, [prior.entityId],
      )).rows[0];
      return { invoice: existing, idempotent: true };
    }
    const learner = (await executor.query(`
      SELECT id, student_number
      FROM users
      WHERE id=$1 AND role='student'
      FOR SHARE
    `, [studentId])).rows[0];
    if (!learner) throw new FinanceCommandError('Active learner not found', 404);
    const reference = options.reference || `ARREARS-${learner.student_number}-${options.dueDate || 'open'}`;
    const duplicate = await executor.query(
      `SELECT * FROM invoices WHERE reference_number=$1 AND student_id=$2 FOR SHARE`,
      [reference, studentId],
    );
    if (duplicate.rows.length) return { invoice: duplicate.rows[0], idempotent: true };
    const invoice = (await executor.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, due_date, status,
         invoice_kind, invoice_source, finance_origin,
         reference_number, description, created_by, created_at)
      VALUES ($1,$2,$3,$4,'Unpaid','arrears','finance_command','canonical',$5,$6,$7,NOW())
      RETURNING *
    `, [
      studentId, learner.student_number, total.toFixed(2),
      options.dueDate || new Date().toISOString().slice(0, 10),
      reference, options.description || 'Manual arrears entry',
      options.actor?.id || options.recordedBy || null,
    ])).rows[0];
    await verifyLedger(executor, [invoice.id]);
    await audit(executor, options.actor, 'manual_arrears_created', 'invoice', invoice.id, {
      student_id: studentId, amount: total, reference, idempotency_key: operationKey,
    });
    return { invoice, idempotent: false };
  }, options.executor);
}

async function editArrears(options = {}) {
  const invoiceId = asId(options.invoiceId, 'invoice ID');
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    derivedIdempotencyKey(`arrears-edit:${invoiceId}`, {
      dueDate: options.dueDate || null, amountDue: options.amountDue || null,
      description: options.description || null,
    });
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'invoice_arrears_edit', operationKey);
    if (prior) {
      const existing = (await executor.query(
        `SELECT * FROM invoices WHERE id=$1`, [invoiceId],
      )).rows[0];
      return { invoice: existing, idempotent: true };
    }
    const current = (await executor.query(`
      SELECT *
      FROM invoices
      WHERE id=$1
      FOR UPDATE
    `, [invoiceId])).rows[0];
    if (!current) throw new FinanceCommandError('Invoice not found', 404);
    if (!String(current.description || '').toLowerCase().includes('arrears') &&
        current.status !== 'Carried Forward') {
      throw new FinanceCommandError(
        'Only arrears invoices can be edited',
        403,
        'Only arrears invoices can be edited here.',
      );
    }
    const dueDate = options.dueDate || current.due_date;
    const nextAmount = options.amountDue == null ? current.amount_due : amount(options.amountDue);
    const updated = (await executor.query(`
      UPDATE invoices
      SET due_date=$1, amount_due=$2,
          status=CASE
            WHEN COALESCE(amount_paid,0) > $2 THEN 'Overpaid'
            WHEN COALESCE(amount_paid,0) >= $2 THEN 'Paid'
            WHEN COALESCE(amount_paid,0) > 0 THEN 'Partial'
            ELSE 'Unpaid'
          END,
          description=COALESCE($3, description), updated_at=CURRENT_TIMESTAMP
      WHERE id=$4
      RETURNING *
    `, [dueDate, nextAmount.toFixed(2), options.description ?? null, invoiceId])).rows[0];
    await verifyLedger(executor, [invoiceId]);
    await audit(executor, options.actor, 'invoice_arrears_edit', 'invoice', invoiceId, {
      invoice_id: invoiceId,
      student_id: current.student_id,
      old_due_date: current.due_date,
      new_due_date: dueDate,
      old_amount: current.amount_due,
      new_amount: nextAmount,
      idempotency_key: operationKey,
    });
    return { invoice: updated };
  }, options.executor);
}

async function recalculateInvoiceStatuses(options = {}) {
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    `invoice-status-recalculate:${new Date().toISOString().slice(0, 10)}`;
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'invoice_status_recalculate', operationKey);
    if (prior) return { rows: [], rowCount: 0, idempotent: true };
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [COMMAND_LOCK_NAMESPACE, 'invoice-status-recalculation'],
    );
    const result = await executor.query(`
      UPDATE invoices SET
        status = CASE
          WHEN amount_paid > amount_due THEN 'Overpaid'
          WHEN amount_due = 0 OR amount_paid >= amount_due THEN 'Paid'
          WHEN amount_paid > 0 THEN 'Partial'
          ELSE 'Unpaid'
        END,
        updated_at = NOW()
      WHERE status <> 'Carried Forward'
        AND status IS DISTINCT FROM (
        CASE
          WHEN amount_paid > amount_due THEN 'Overpaid'
          WHEN amount_due = 0 OR amount_paid >= amount_due THEN 'Paid'
          WHEN amount_paid > 0 THEN 'Partial'
          ELSE 'Unpaid'
        END
      )
      RETURNING id, status, student_number, amount_due, amount_paid, due_date
    `);
    await audit(executor, options.actor, 'invoice_status_recalculate', 'invoice', null, {
      corrected_count: result.rowCount || result.rows.length,
      idempotency_key: operationKey,
    });
    return { rows: result.rows, rowCount: result.rowCount || result.rows.length };
  }, options.executor);
}

async function carryForward(options = {}) {
  const studentId = asId(options.studentId, 'learner ID');
  const sourceIds = (options.sourceInvoiceIds || []).map((id) => asId(id, 'source invoice ID'));
  if (!sourceIds.length) throw new FinanceCommandError('At least one source invoice is required');
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    derivedIdempotencyKey(`carry-forward:${studentId}`, {
      sourceIds: [...sourceIds].sort((a, b) => a - b), dueDate: options.dueDate || null,
    });
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'arrears_carry_forward', operationKey);
    if (prior) {
      const existing = (await executor.query(
        `SELECT * FROM invoices WHERE id=$1`, [prior.entityId],
      )).rows[0];
      return { invoice: existing, sourceInvoiceIds: sourceIds, idempotent: true };
    }
    // Lock in deterministic order so two carry-forward requests cannot
    // manufacture competing successors.
    await acquireInvoiceObligationLocks(executor, studentId,
      sourceIds.map((invoiceId) => ({ invoiceId, studentId, lineId: 'legacy' })));
    const sources = (await executor.query(`
      SELECT id, student_id, student_number, amount_due, amount_paid, status
      FROM invoices
      WHERE student_id=$1 AND id=ANY($2::integer[])
      ORDER BY id
      FOR UPDATE
    `, [studentId, sourceIds])).rows;
    if (sources.length !== sourceIds.length) {
      throw new FinanceCommandError('One or more carry-forward invoices was not found', 409);
    }
    const outstanding = money(sources.reduce((sum, row) =>
      sum + Math.max(0, Number(row.amount_due) - Number(row.amount_paid)), 0));
    if (outstanding <= 0) throw new FinanceCommandError('No outstanding arrears to carry forward', 409);
    const first = sources[0];
    const reference = options.reference ||
      `CARRY-FORWARD-${first.student_number}-${options.dueDate || 'open'}`;
    const successor = (await executor.query(`
      INSERT INTO invoices
        (student_id, student_number, amount_due, status, due_date,
         invoice_kind, invoice_source, finance_origin,
         reference_number, description, created_by, created_at)
      VALUES ($1,$2,$3,'Unpaid',$4,'carry_forward','finance_command','canonical',$5,$6,$7,NOW())
      RETURNING *
    `, [
      studentId, first.student_number, outstanding.toFixed(2),
      options.dueDate || new Date().toISOString().slice(0, 10), reference,
      options.description || 'Carried-forward arrears', options.actor?.id || null,
    ])).rows[0];
    await executor.query(`
      UPDATE invoices
      SET status='Carried Forward', carried_forward_to_invoice_id=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=ANY($2::integer[])
    `, [successor.id, sourceIds]);
    await audit(executor, options.actor, 'arrears_carry_forward', 'invoice', successor.id, {
      student_id: studentId, source_invoice_ids: sourceIds,
      amount: outstanding, reference, idempotency_key: operationKey,
    });
    return { invoice: successor, sourceInvoiceIds: sourceIds, amount: outstanding };
  }, options.executor);
}

async function carryForwardBatch(options = {}) {
  const students = Array.isArray(options.students) ? options.students : [];
  if (!students.length) throw new FinanceCommandError('At least one student is required');
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    derivedIdempotencyKey(`carry-forward-batch:${options.fromYear}`, students);
  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    const prior = await findCompletedCommand(executor, 'invoice_carry_forward', operationKey);
    if (prior) {
      const ids = prior.details?.invoice_ids || [];
      const existing = ids.length
        ? (await executor.query(`SELECT * FROM invoices WHERE id=ANY($1::integer[])`, [ids])).rows
        : [];
      return { created: existing, idempotent: true };
    }
    const created = [];
    for (const item of students) {
      const studentId = asId(item.student_id ?? item.studentId, 'learner ID');
      const learner = (await executor.query(`
        SELECT id, student_number
        FROM users
        WHERE id=$1 AND role='student'
        FOR SHARE
      `, [studentId])).rows[0];
      if (!learner) throw new FinanceCommandError('Active learner not found', 404);
      // Lock the exact source set before creating its successor.  The source
      // query is intentionally repeated under the transaction so a stale
      // preview cannot mark a newly-created invoice as carried forward.
      const candidateSources = (await executor.query(`
        SELECT id, amount_due, amount_paid
        FROM invoices
        WHERE student_id=$1
          AND EXTRACT(YEAR FROM due_date)=$2
          AND status NOT IN ('Paid','Overpaid','Carried Forward')
          AND amount_paid < amount_due
        ORDER BY id
        FOR SHARE
      `, [studentId, Number(options.fromYear)])).rows;
      if (!candidateSources.length) continue;
      const total = money(candidateSources.reduce((sum, source) =>
        sum + Math.max(0, Number(source.amount_due) - Number(source.amount_paid)), 0));
      if (!Number.isFinite(total) || total <= 0) continue;
      if (item.amount != null && Math.abs(Number(item.amount) - total) > 0.005) {
        throw new FinanceCommandError(
          `Carry-forward amount for learner ${studentId} is stale`,
          409,
          'The arrears preview is stale. Reload it before carrying forward.',
        );
      }
      await acquireInvoiceObligationLocks(executor, studentId,
        candidateSources.map((source) => ({ invoiceId: source.id, studentId })));
      const sources = (await executor.query(`
        SELECT id
        FROM invoices
        WHERE id=ANY($1::integer[]) AND student_id=$2
          AND status NOT IN ('Paid','Overpaid','Carried Forward')
          AND amount_paid < amount_due
        ORDER BY id
        FOR UPDATE
      `, [candidateSources.map((source) => Number(source.id)), studentId])).rows;
      if (!sources.length) continue;
      const reference = `CARRY-FORWARD-${learner.student_number}-${options.fromYear}`;
      const existing = await executor.query(
        `SELECT * FROM invoices WHERE student_id=$1 AND reference_number=$2 FOR SHARE`,
        [studentId, reference],
      );
      if (existing.rows.length) {
        created.push(existing.rows[0]);
        continue;
      }
      const invoice = (await executor.query(`
        INSERT INTO invoices
          (student_id, student_number, amount_due, due_date, status,
           invoice_kind, invoice_source, finance_origin,
           reference_number, description, created_by, created_at)
        VALUES ($1,$2,$3,$4,'Unpaid','carry_forward','finance_command','canonical',$5,$6,$7,NOW())
        RETURNING *
      `, [
        studentId, learner.student_number, total.toFixed(2),
        options.dueDate || new Date(Number(options.fromYear), 11, 31),
        reference, `Arrears from ${options.fromYear}`, options.actor?.id || null,
      ])).rows[0];
      await executor.query(`
        UPDATE invoices
        SET status='Carried Forward', carried_forward_to_invoice_id=$1,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=ANY($2::integer[])
      `, [invoice.id, sources.map((source) => Number(source.id))]);
      await verifyLedger(executor, [invoice.id]);
      created.push(invoice);
    }
    await audit(executor, options.actor, 'invoice_carry_forward', 'invoice', null, {
      from_year: Number(options.fromYear),
      students_count: created.length,
      invoice_ids: created.map((invoice) => invoice.id),
      idempotency_key: operationKey,
    });
    return { created };
  }, options.executor);
}

async function verifyExistingCanonicalMonthlyInvoice(executor, invoice, periodStart) {
  const period = String(invoice.billing_period || '').slice(0, 10);
  if (period !== periodStart || invoice.invoice_kind !== 'monthly' ||
      invoice.invoice_source !== 'monthly_generation' ||
      invoice.finance_origin !== 'canonical') {
    throw new FinanceCommandError(
      `Monthly invoice ${invoice.id} requires reconciliation`,
      409,
      'An existing monthly invoice does not match the canonical billing contract and requires reconciliation.',
    );
  }
  const lines = (await executor.query(`
    SELECT id, line_type, amount, is_included, metadata
    FROM invoice_line_items
    WHERE invoice_id=$1
    ORDER BY id
    FOR SHARE
  `, [invoice.id])).rows;
  if (!lines.length || lines.some((line) => {
    let metadata = line.metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch (_) { metadata = null; }
    }
    return !metadata ||
      metadata.snapshot_source !== 'monthly_billing_command' ||
      metadata.billing_period !== periodStart.slice(0, 7);
  })) {
    throw new FinanceCommandError(
      `Monthly invoice ${invoice.id} requires reconciliation`,
      409,
      'The existing monthly invoice has no complete immutable snapshot and requires reconciliation.',
    );
  }
  const net = money(lines.reduce((total, line) => {
    const value = Number(line.amount || 0);
    if (line.line_type === 'discount') return total - value;
    if (line.line_type === 'charge' && !line.is_included) return total + value;
    return total;
  }, 0));
  if (net !== money(invoice.amount_due)) {
    throw new FinanceCommandError(
      `Monthly invoice ${invoice.id} requires reconciliation`,
      409,
      'The existing monthly invoice total does not match its immutable lines and requires reconciliation.',
    );
  }
  return invoice;
}

/*
 * Canonical monthly billing command.
 *
 * Monthly generation deliberately lives here rather than in the HTTP route:
 * the period lock, enrollment/discount snapshots, invoice uniqueness handling,
 * line-item evidence, audit event, and final balance verification must all
 * commit or roll back together.
 */
async function generateMonthlyInvoices(options = {}) {
  const month = Number(options.month);
  const year = Number(options.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new FinanceCommandError('Invalid billing period', 400, 'A valid billing month and year are required.');
  }
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const periodStart = `${period}-01`;
  const dueDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const operationKey = idempotencyDetails(options.idempotencyKey) ||
    `monthly-billing:${period}`;

  return withTransaction(async (executor) => {
    await lockIdempotency(executor, operationKey);
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtext('harmony-monthly-invoices'), $1::integer)`,
      [year * 100 + month],
    );
    const prior = await findCompletedCommand(executor, 'invoice_generate', operationKey);
    if (prior) {
      const invoiceIds = (prior.details?.invoice_ids || []).map(Number).filter(Number.isInteger);
      const existing = invoiceIds.length
        ? (await executor.query(`SELECT * FROM invoices WHERE id=ANY($1::integer[]) ORDER BY id`, [invoiceIds])).rows
        : [];
      return {
        invoices: existing,
        totalStudents: existing.length,
        invoicesCreated: 0,
        skipped: existing.length,
        siblingDiscountsApplied: Number(prior.details?.sibling_discounts || 0),
        teacherDiscountsApplied: Number(prior.details?.teacher_discounts || 0),
        month, year, dueDate,
        idempotent: true,
      };
    }

    // Canonical billing requires every additive finance table and persisted
    // effective enrollment rows. There is no historical flag fallback.
    try {
      await executor.query('SELECT 1 FROM learner_discount_assignments LIMIT 1');
      await executor.query('SELECT 1 FROM invoice_line_items LIMIT 1');
      await executor.query(
        'SELECT billing_mode, bundle_key, included_service_keys FROM service_prices LIMIT 1',
      );
      await executor.query('SELECT 1 FROM service_enrollments LIMIT 1');
    } catch (schemaError) {
      const missing = schemaError?.code === '42P01' || schemaError?.code === '42703';
      if (!missing) {
        throw new FinanceCommandError(
          'Monthly finance-truth generation is unavailable until the finance core architecture migration is applied',
          503,
        );
      }
      throw new FinanceCommandError(
        'Monthly billing requires the finance core architecture and persisted effective service enrollments',
        503,
      );
    }

    const students = (await executor.query(`
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.grade_id, u.class_id
      FROM users u
      WHERE u.role='student' AND u.is_active=true
      ORDER BY u.id
    `)).rows;
    if (!students.length) {
      throw new FinanceCommandError('No active students found', 400);
    }

    const existingRows = (await executor.query(`
      SELECT * FROM invoices
      WHERE billing_period=$1::date AND invoice_kind='monthly'
      ORDER BY id
      FOR UPDATE
    `, [periodStart])).rows;
    for (const existing of existingRows) {
      await verifyExistingCanonicalMonthlyInvoice(executor, existing, periodStart);
    }
    const existingByStudent = new Map(existingRows.map((row) => [Number(row.student_id), row]));
    const pendingStudents = students.filter((student) => !existingByStudent.has(Number(student.id)));
    if (!pendingStudents.length) {
      // This is a valid idempotent replay, but still records a command audit
      // so callers get the same atomic contract as a first attempt.
      await audit(executor, options.actor, 'invoice_generate', 'invoice', null, {
        summary: `Monthly billing already existed for ${period}`,
        month, year, invoice_ids: existingRows.map((row) => Number(row.id)),
        invoices_created: 0, skipped: existingRows.length,
        sibling_discounts: 0, teacher_discounts: 0,
        idempotency_key: operationKey,
      });
      return {
        invoices: existingRows, totalStudents: students.length,
        invoicesCreated: 0, skipped: existingRows.length,
        siblingDiscountsApplied: 0, teacherDiscountsApplied: 0,
        month, year, dueDate, idempotent: true,
      };
    }

    const prices = (await executor.query(`
      SELECT service_key, label, description, amount, billing_mode,
             bundle_key, included_service_keys
      FROM service_prices
      ORDER BY display_order, service_key
    `)).rows;
    const enrollmentRows = await getBillingEnrollmentsForLearners(
      pendingStudents.map((student) => Number(student.id)), period, executor,
    );
    const enrollmentsByStudent = new Map();
    for (const enrollment of enrollmentRows) {
      const studentId = Number(enrollment.student_id);
      if (!enrollmentsByStudent.has(studentId)) enrollmentsByStudent.set(studentId, []);
      enrollmentsByStudent.get(studentId).push(enrollment);
    }

    const created = [];
    let siblingDiscountCount = 0;
    let teacherDiscountCount = 0;
    for (const student of pendingStudents) {
      const enrollments = enrollmentsByStudent.get(Number(student.id)) || [];
      const seenServices = new Set();
      for (const enrollment of enrollments) {
        const serviceKey = String(enrollment.service_key || '').toLowerCase();
        if (!['tuition', 'boarding', 'transport', 'aftercare'].includes(serviceKey) ||
            seenServices.has(serviceKey)) {
          throw new FinanceCommandError(
            `Overlapping or invalid service enrollment for ${student.student_number}`,
            409,
            'A learner has conflicting service enrollments for this billing period.',
          );
        }
        seenServices.add(serviceKey);
      }
      if (!enrollments.length) {
        throw new FinanceCommandError(
          `No canonical service enrollment exists for ${student.student_number} in ${period}`,
          409,
        );
      }
      const assignments = (await executor.query(`
        SELECT id, discount_type, calculation_method, amount, percentage,
               applicable_service_key, reason
        FROM learner_discount_assignments
        WHERE student_id=$1 AND is_active=TRUE
          AND starts_on <= $2::date
          AND (ends_on IS NULL OR ends_on >= $2::date)
        ORDER BY id
      `, [student.id, periodStart])).rows;
      const lines = buildInvoiceSnapshotLines(
        student, prices, assignments,
        enrollments,
      );
      const chargeTotal = lines
        .filter((line) => line.line_type === 'charge' && !line.is_included)
        .reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const discountTotal = lines
        .filter((line) => line.line_type === 'discount')
        .reduce((sum, line) => sum + Number(line.amount || 0), 0);
      const amountDue = money(Math.max(0, chargeTotal - discountTotal));
      const inserted = await executor.query(`
        INSERT INTO invoices
          (student_id, student_number, amount_due, due_date, status,
           billing_period, invoice_kind, invoice_source, finance_origin,
           reference_number, description, created_by, created_at)
        VALUES ($1,$2,$3,$4,'Unpaid',$5::date,'monthly',$6,$7,$8,$9,$10,NOW())
        ON CONFLICT DO NOTHING
        RETURNING *
      `, [
        student.id, student.student_number, amountDue.toFixed(2), dueDate, periodStart,
        'monthly_generation',
        'canonical',
        student.student_number,
        `Monthly billing ${period}`,
        options.actor?.id || null,
      ]);
      let invoice = inserted.rows[0];
      if (!invoice) {
        invoice = (await executor.query(`
          SELECT * FROM invoices
          WHERE student_id=$1 AND billing_period=$2::date AND invoice_kind='monthly'
          FOR UPDATE
        `, [student.id, periodStart])).rows[0];
        if (!invoice) throw new FinanceCommandError('Monthly invoice uniqueness conflict', 409);
        await verifyExistingCanonicalMonthlyInvoice(executor, invoice, periodStart);
        created.push(invoice);
        continue;
      }
      for (const line of lines) {
        const metadata = {
          ...(line.metadata || {}),
          billing_period: period,
          snapshot_source: 'monthly_billing_command',
          enrollment_ids: enrollments.map((enrollment) => Number(enrollment.id)),
        };
        await executor.query(`
          INSERT INTO invoice_line_items
            (invoice_id, line_type, service_key, bundle_key, label, description,
             quantity, unit_amount, amount, is_included, discount_assignment_id, metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [
          invoice.id, line.line_type, line.service_key, line.bundle_key,
          line.label, line.description, line.quantity, line.unit_amount,
          line.amount, line.is_included, line.discount_assignment_id || null,
          JSON.stringify(metadata),
        ]);
      }
      created.push(invoice);
      siblingDiscountCount += lines.filter((line) =>
        line.metadata?.discount_type === 'sibling').length;
      teacherDiscountCount += lines.filter((line) =>
        line.metadata?.discount_type === 'staff').length;
    }

    const invoiceIds = created.map((invoice) => Number(invoice.id));
    const headers = (await executor.query(`
      SELECT id, amount_due, amount_paid, status
      FROM invoices WHERE id=ANY($1::integer[]) FOR SHARE
    `, [invoiceIds])).rows;
    const lineTotals = (await executor.query(`
      SELECT invoice_id,
             COALESCE(SUM(CASE WHEN line_type='charge' AND NOT is_included
                              THEN amount ELSE 0 END),0)
             - COALESCE(SUM(CASE WHEN line_type='discount' THEN amount ELSE 0 END),0)
             AS amount_due
      FROM invoice_line_items
      WHERE invoice_id=ANY($1::integer[])
      GROUP BY invoice_id
    `, [invoiceIds])).rows;
    const totalsById = new Map(lineTotals.map((row) => [Number(row.invoice_id), money(row.amount_due)]));
    for (const header of headers) {
      if (money(header.amount_due) !== (totalsById.get(Number(header.id)) || 0)) {
        throw new FinanceCommandError(`Monthly invoice ${header.id} failed snapshot verification`, 409);
      }
    }
    await verifyLedger(executor, invoiceIds);
    await audit(executor, options.actor, 'invoice_generate', 'invoice', null, {
      summary: `Generated ${created.length} invoices for ${period}`,
      month, year, invoice_ids: invoiceIds, invoices_created: created.length,
      skipped: existingRows.length, sibling_discounts: siblingDiscountCount,
      teacher_discounts: teacherDiscountCount, idempotency_key: operationKey,
    });
    return {
      invoices: [...existingRows, ...created],
      totalStudents: students.length,
      invoicesCreated: created.length,
      skipped: existingRows.length,
      siblingDiscountsApplied: siblingDiscountCount,
      teacherDiscountsApplied: teacherDiscountCount,
      month, year, dueDate,
    };
  }, options.executor);
}

module.exports = {
  FinanceCommandError,
  withTransaction,
  acquireInvoiceObligationLocks,
  invoiceObligationLockKeys,
  validateExactObligations,
  verifyLedger,
  recordPayment,
  createPaymentProof,
  approveProof,
  retargetProof,
  rejectProof,
  reversePayment,
  applyCredit,
  applyUnallocated,
  correctPayment,
  createArrears,
  editArrears,
  recalculateInvoiceStatuses,
  carryForward,
  carryForwardBatch,
  generateMonthlyInvoices,
  verifyExistingCanonicalMonthlyInvoice,
  // Kept explicit so routes can migrate incrementally without reimplementing
  // the empty-proof/unallocated semantics.
  insertUnallocated,
};