const db = require('../config/database');
const { sendEmail, escapeHtml } = require('./gmailService');

// These are the only destinations that can ever be persisted or delivered.
const DEEP_LINKS = Object.freeze({
  home: '/parent/dashboard',
  dashboard: '/parent/dashboard',
  attendance: '/parent/attendance',
  grades: '/parent/grades',
  academics: '/parent/grades',
  fees: '/parent/invoices',
  invoices: '/parent/invoices',
  payment: '/parent/payment-proof',
  'payment-proof': '/parent/payment-proof',
  documents: '/parent/documents',
  announcements: '/parent/announcements',
  notifications: '/parent/notifications',
});

const EVENT = Object.freeze({
  ABSENT: 'attendance_absent',
  LATE: 'attendance_late',
  RESULT: 'academic_result_published',
  PROOF_SUBMITTED: 'payment_proof_submitted',
  PROOF_APPROVED: 'payment_proof_approved',
  PROOF_REJECTED: 'payment_proof_rejected',
  PAYMENT_APPLIED: 'payment_applied',
  PAYMENT_RECORDED: 'payment_recorded',
  PAYMENT_ADJUSTED: 'payment_adjusted',
  PAYMENT_REVERSED: 'payment_reversed',
  INVOICE: 'invoice_created',
  ANNOUNCEMENT: 'announcement_published',
  DOCUMENT: 'document_published',
});

const clean = (value, max) => String(value == null ? '' : value)
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

// Admin notes are internal free text.  Only a short, presentation-safe
// reason is allowed into a parent preview; contact details, URLs, and long
// numeric references are deliberately redacted.
const safeRejectionReason = (value) => clean(value, 180)
  .replace(/https?:\/\/\S+/gi, '[details omitted]')
  .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[contact omitted]')
  .replace(/\b\d{6,}\b/g, '[reference omitted]')
  .replace(/[^\p{L}\p{N}\s.,:'()_\/-]/gu, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 160);

const learnerDisplay = (learner) => clean(
  learner?.first_name && learner?.last_name
    ? `${learner.first_name} ${learner.last_name}`
    : learner?.first_name || learner?.last_name || 'your learner',
  100,
);

function destinationFor(value) {
  const key = String(value || '').trim().toLowerCase();
  const destination = DEEP_LINKS[key] || DEEP_LINKS[key.replace(/^\/parent\/?/, '')];
  if (!destination) throw new Error('Unsupported parent portal destination');
  return destination;
}

function portalUrl(destination) {
  const base = String(process.env.FRONTEND_URL || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  try {
    const parsed = new URL(base);
    // Production links must never be sent to an arbitrary external host.
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${destination}`;
  } catch (_) {
    return null;
  }
}

async function parentRecipients({ learnerId, parentIds, gradeId, classId, audience = 'linked' }) {
  const params = [];
  const predicates = [`p.role = 'parent'`, `p.is_active = true`];
  // An explicitly empty selection means nobody, not everybody.  This is
  // important for "specific parents" controls and also prevents a malformed
  // client payload from broadening a notification to the whole school.
  if (Array.isArray(parentIds)) {
    const safeParentIds = parentIds.map(Number).filter(Number.isSafeInteger);
    if (!safeParentIds.length) return [];
    params.push(safeParentIds);
    predicates.push(`p.id = ANY($${params.length}::int[])`);
  }
  if (learnerId != null) {
    params.push(Number(learnerId));
    predicates.push(`ps.student_id = $${params.length}`);
  }
  if (gradeId != null) {
    params.push(Number(gradeId));
    predicates.push(`s.grade_id = $${params.length}`);
  }
  if (classId != null) {
    params.push(Number(classId));
    predicates.push(`s.class_id = $${params.length}`);
  }
  // `audience=all` is reserved for callers that have already applied their
  // source-record eligibility checks. It still requires a current link.
  if (audience !== 'all') predicates.push('ps.student_id = s.id');
  const result = await db.query(`
    SELECT DISTINCT p.id AS parent_id, p.email, p.first_name AS parent_first_name,
           s.id AS learner_id, s.first_name, s.last_name
    FROM users p
    JOIN parent_students ps ON ps.parent_id = p.id
    JOIN users s ON s.id = ps.student_id AND s.role = 'student' AND s.is_active = true
    WHERE ${predicates.join(' AND ')}
  `, params);
  return result.rows;
}

async function deliverOptional({ parent, title, summary, destination, important }) {
  if (!important) return;
  const url = portalUrl(destination);
  if (!url || !parent?.email) return;
  try {
    // Important events only.  The body deliberately contains no marks,
    // comments, storage locators, raw rejection free text, or secure tokens.
    await sendEmail(
      parent.email,
      `Harmony Parent Portal — ${title}`,
      `<p>Dear ${escapeHtml(parent.parent_first_name || 'Parent')},</p>` +
      `<p>${escapeHtml(summary)}</p>` +
      `<p><a href="${escapeHtml(url)}">View in Parent Portal</a></p>` +
      '<hr><p>Harmony Learning Institute</p><p>Powered by AutoM8</p>',
      { fromName: 'Harmony Learning Institute — powered by AutoM8', replyTo: 'harmonylearninginstitute@gmail.com' },
    );
  } catch (error) {
    console.warn('Parent notification email delivery failed:', error.message);
  }
}

async function deliverPush({ parentId, title, summary, destination, eventType, learnerId }) {
  try {
    const { sendToParents } = require('./pushNotification');
    await sendToParents([parentId], {
      type: eventType,
      title,
      body: summary,
      url: destination,
      learner_id: learnerId || undefined,
      icon: '/icons/icon-192x192.png',
    });
  } catch (error) {
    console.warn('Parent notification push delivery failed:', error.message);
  }
}

/**
 * Creates one durable inbox row per currently linked parent/learner.
 * `dedupeKey` must identify the source event, never an attempt to deliver it.
 */
async function createParentNotifications({
  eventType,
  title,
  summary,
  destination,
  dedupeKey,
  learnerId = null,
  parentIds,
  gradeId,
  classId,
  audience = 'linked',
  important = false,
  email = important,
  recipients,
}) {
  try {
    const safeDestination = destinationFor(destination);
    const safeEvent = clean(eventType, 64);
    const safeTitle = clean(title, 180);
    const safeSummary = clean(summary, 500);
    const safeDedupe = clean(dedupeKey, 240);
    if (!safeEvent || !safeTitle || !safeSummary || !safeDedupe) return { created: 0 };
    const rows = recipients || await parentRecipients({ learnerId, parentIds, gradeId, classId, audience });
    let created = 0;
    for (const recipient of rows) {
      // A recipient row is always linked at insertion time.  This also makes
      // a stale queued event harmless if a parent/learner was unlinked.
      const inserted = await db.query(`
        INSERT INTO parent_notifications
          (event_type, parent_id, learner_id, title, summary, deep_link, dedupe_key, important)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8
        WHERE EXISTS (
          SELECT 1 FROM parent_students
          WHERE parent_id = $2 AND ($3::int IS NULL OR student_id = $3)
        )
        ON CONFLICT (parent_id, dedupe_key) DO NOTHING
        RETURNING id
      `, [
        safeEvent, recipient.parent_id, recipient.learner_id || learnerId || null,
        safeTitle, safeSummary, safeDestination, safeDedupe, Boolean(important),
      ]);
      if (inserted.rows.length) {
        created++;
        // Delivery is intentionally after the durable insert and can never
        // reject/rollback the source transaction.
        await Promise.allSettled([
          deliverOptional({
            parent: recipient, title: safeTitle, summary: safeSummary,
            destination: safeDestination, important: Boolean(important && email),
          }),
          deliverPush({
            parentId: recipient.parent_id,
            title: safeTitle,
            summary: safeSummary,
            destination: safeDestination,
            eventType: safeEvent,
            learnerId: recipient.learner_id || learnerId,
          }),
        ]);
      }
    }
    return { created };
  } catch (error) {
    // Notification infrastructure is optional.  Source records have already
    // committed and must remain successful if this system is unavailable.
    console.warn('Parent notification creation skipped:', error.message);
    return { created: 0, skipped: true };
  }
}

async function learner(learnerId) {
  try {
    const result = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id=$1 AND role='student'`,
      [learnerId],
    );
    return result.rows[0] || { id: learnerId, first_name: 'Your', last_name: 'learner' };
  } catch (_) {
    return { id: learnerId, first_name: 'Your', last_name: 'learner' };
  }
}

async function notifyAttendance({ learnerId, status, date }) {
  if (!['absent', 'late'].includes(String(status).toLowerCase())) return { created: 0 };
  const student = await learner(learnerId);
  const name = learnerDisplay(student);
  const normalized = String(status).toLowerCase();
  return createParentNotifications({
    eventType: normalized === 'absent' ? EVENT.ABSENT : EVENT.LATE,
    title: normalized === 'absent' ? `${name} was marked absent` : `${name} was marked late`,
    summary: normalized === 'absent'
      ? `${name} was marked absent on ${clean(date, 30)}.`
      : `${name} was marked late on ${clean(date, 30)}.`,
    destination: 'attendance',
    dedupeKey: `attendance:${learnerId}:${clean(date, 30)}:${normalized}`,
    learnerId,
    important: normalized === 'absent',
  });
}

async function notifyAcademicResult({ submissionId, learnerId, subject, publicationKey }) {
  const student = await learner(learnerId);
  const name = learnerDisplay(student);
  const safeSubject = clean(subject || 'academic', 80);
  return createParentNotifications({
    eventType: EVENT.RESULT,
    title: `New ${safeSubject} result available`,
    summary: `A new ${safeSubject} result is available for ${name}.`,
    destination: 'grades',
    dedupeKey: `result:${publicationKey || submissionId}`,
    learnerId,
  });
}

async function notifyPayment({ kind, paymentId, learnerId, amount, reason }) {
  const student = await learner(learnerId);
  const name = learnerDisplay(student);
  const labels = {
    submitted: ['Payment proof submitted', `${name}'s payment proof was received.`, false],
    approved: ['Payment proof approved', `${name}'s payment proof was approved.`, true],
    rejected: ['Payment proof needs attention', `${name}'s payment proof was not approved. Please review the Payment Proof section.`, true],
    applied: ['Payment applied', `A payment was applied to ${name}'s school account.`, true],
    recorded: ['Payment recorded', `A payment was recorded on ${name}'s school account.`, true],
    adjusted: ['Payment adjusted', `A payment on ${name}'s school account was adjusted.`, true],
    reversed: ['Payment reversed', `A payment on ${name}'s school account was reversed.`, true],
  };
  const [title, baseSummary, important] = labels[kind] || labels.submitted;
  const summary = kind === 'rejected'
    ? `${baseSummary}${safeRejectionReason(reason) ? ` Reason: ${safeRejectionReason(reason)}` : ''}`
    : baseSummary;
  const amountText = Number.isFinite(Number(amount)) ? ` Amount recorded: R ${Number(amount).toFixed(2)}.` : '';
  return createParentNotifications({
    eventType: {
      recorded: EVENT.PAYMENT_RECORDED,
      adjusted: EVENT.PAYMENT_ADJUSTED,
      reversed: EVENT.PAYMENT_REVERSED,
    }[kind] || EVENT[`PROOF_${String(kind).toUpperCase()}`] || EVENT.PAYMENT_APPLIED,
    title,
    summary: `${summary}${['approved', 'applied', 'recorded', 'adjusted', 'reversed'].includes(kind) ? amountText : ''}`,
    destination: 'payment-proof',
    dedupeKey: `payment:${kind}:${paymentId}`,
    learnerId,
    important,
  });
}

async function notifyInvoice({ invoiceId, learnerId, amount }) {
  const student = await learner(learnerId);
  const name = learnerDisplay(student);
  const amountText = Number.isFinite(Number(amount))
    ? ` Amount due: R ${Number(amount).toFixed(2)}.` : '';
  return createParentNotifications({
    eventType: EVENT.INVOICE,
    title: 'New invoice available',
    summary: `A new invoice is available for ${name}.${amountText}`,
    destination: 'fees',
    dedupeKey: `invoice:${invoiceId}`,
    learnerId,
    important: true,
  });
}

async function notifyAnnouncement(announcement) {
  const audience = String(announcement.target_audience || '').toLowerCase();
  const parentAudiences = new Set([
    'everyone', 'parents', 'all_parents', 'grade', 'class',
    'specific_parents',
  ]);
  if (!parentAudiences.has(audience)) {
    return { created: 0 };
  }
  try {
    const selectedParents = audience === 'specific_parents'
      ? (announcement.target_parent_ids ?? announcement.parent_ids)
      : undefined;
    const targeted = announcement.grade_id != null || announcement.class_id != null ||
      Array.isArray(selectedParents);
    const rows = await parentRecipients({
      parentIds: Array.isArray(selectedParents) ? selectedParents : undefined,
      gradeId: announcement.grade_id,
      classId: announcement.class_id,
      audience: 'all',
    });
    // Targeted notices carry a learner ID.  Global notices are one inbox item
    // per parent (and do not imply that a particular learner was targeted).
    const recipients = targeted ? rows : rows
      .filter((row, i, all) => all.findIndex((other) => other.parent_id === row.parent_id) === i)
      .map((row) => ({ ...row, learner_id: null }));
    return createParentNotifications({
      eventType: EVENT.ANNOUNCEMENT,
      title: clean(announcement.title, 180),
      summary: announcement.priority === 'high' || announcement.priority === 'urgent'
        ? `Important announcement: ${clean(announcement.content, 430)}`
        : `New school announcement: ${clean(announcement.content, 430)}`,
      destination: 'announcements',
      dedupeKey: `announcement:${announcement.id}:${announcement.updated_at || announcement.created_at || 'published'}`,
      important: ['high', 'urgent'].includes(announcement.priority),
      email: true,
      recipients,
    });
  } catch (error) {
    console.warn('Parent announcement notification skipped:', error.message);
    return { created: 0, skipped: true };
  }
}

async function notifyDocument(document) {
  const audience = String(document.target_audience || '').toLowerCase();
  if (!['parents', 'everyone', 'all_parents', 'grade', 'class', 'specific_parents'].includes(audience)) {
    return { created: 0 };
  }
  try {
    const selectedParents = audience === 'specific_parents'
      ? (document.target_parent_ids ?? document.parent_ids)
      : undefined;
    const rows = await parentRecipients({
      parentIds: Array.isArray(selectedParents) ? selectedParents : undefined,
      gradeId: document.grade_id,
      classId: document.class_id,
      audience: 'all',
    });
    const targeted = document.grade_id != null || document.class_id != null;
    const recipients = targeted ? rows : rows
      .filter((row, i, all) => all.findIndex((other) => other.parent_id === row.parent_id) === i)
      .map((row) => ({ ...row, learner_id: null }));
    return createParentNotifications({
      eventType: EVENT.DOCUMENT,
      title: clean(document.title || 'New document available', 180),
      summary: `A document authorised for your Parent Portal is available: ${clean(document.title || 'school document', 220)}.`,
      destination: 'documents',
      dedupeKey: `document:${document.id}`,
      recipients,
      // Durable inbox creation is always performed for parent documents;
      // email is opt-in for routine documents and automatic for important
      // documents.
      important: Boolean(document.important || document.priority === 'high' || document.priority === 'urgent'),
      email: Boolean(document.notify_email),
    });
  } catch (error) {
    console.warn('Parent document notification skipped:', error.message);
    return { created: 0, skipped: true };
  }
}

module.exports = {
  DEEP_LINKS,
  EVENT,
  destinationFor,
  portalUrl,
  createParentNotifications,
  notifyAttendance,
  notifyAcademicResult,
  notifyPayment,
  notifyInvoice,
  notifyAnnouncement,
  notifyDocument,
  safeRejectionReason,
};