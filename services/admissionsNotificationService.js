const db = require('../config/database');

const safePayload = (payload = {}) => ({
  enrollmentId: Number.isSafeInteger(Number(payload.enrollmentId)) ? Number(payload.enrollmentId) : null,
  event: String(payload.event || '').slice(0, 80),
  documentPublicId: payload.documentPublicId ? String(payload.documentPublicId).slice(0, 80) : null,
  checklistItem: payload.checklistItem ? String(payload.checklistItem).slice(0, 40) : null,
  eventKey: payload.eventKey ? String(payload.eventKey).slice(0, 80) : null,
  documentCount: payload.documentCount != null && Number.isSafeInteger(Number(payload.documentCount))
    ? Number(payload.documentCount)
    : null,
  checklistItems: Array.isArray(payload.checklistItems)
    ? payload.checklistItems.map((item) => String(item).slice(0, 40)).slice(0, 10)
    : [],
});
const ITEM_LABELS = Object.freeze({
  BIRTH_CERTIFICATE: 'Birth Certificate',
  PARENT_GUARDIAN_ID: 'Parent/Guardian ID',
  LATEST_SCHOOL_REPORT: 'Latest School Report',
  TRANSFER_DOCUMENT: 'Transfer Document',
  REGISTRATION_FORM: 'Registration Form',
});

async function notifyAdmissionsAdmins(payload, executor = db) {
  const safe = safePayload(payload);
  if (!safe.enrollmentId || !safe.event) return;
  const enrollmentResult = await executor.query(`
    SELECT student_first_name, student_last_name, application_reference, grade_applying
    FROM enrollments WHERE id = $1
  `, [safe.enrollmentId]);
  const enrollment = enrollmentResult.rows[0] || {};
  const learner = [enrollment.student_first_name, enrollment.student_last_name].filter(Boolean).join(' ') || 'Applicant';
  const reference = enrollment.application_reference || 'Admissions application';
  const item = ITEM_LABELS[safe.checklistItem] || safe.checklistItem || 'document';
  const copy = {
    DOCUMENT_UPLOADED: ['Document uploaded', `${learner} uploaded ${item} — ${reference}`],
    DOCUMENT_REPLACED: ['Replacement document uploaded', `${learner} uploaded a replacement ${item} — ${reference}`],
    DOCUMENTS_SUBMITTED: ['Requested documents submitted', `${learner} submitted ${safe.documentCount || safe.checklistItems.length} requested documents — ${reference}`],
    DOCUMENT_REVIEWED: ['Document received', `${item} was marked received for ${learner} — ${reference}`],
    DOCUMENT_REPLACEMENT_REQUIRED: ['Document replacement required', `${item} requires replacement for ${learner} — ${reference}`],
    NEW_APPLICATION: ['New application received', `New application received — ${learner} (${reference})${enrollment.grade_applying ? `, ${enrollment.grade_applying}` : ''}`],
    INFORMATION_SUBMITTED: ['Requested information submitted', `${learner} submitted requested application information — ${reference}`],
    BRING_IN_PERSON_SELECTED: ['Bring in person', `${learner} will bring ${item} in person — ${reference}`],
    REGISTRATION_SUBMITTED: ['Registration submitted', `Registration submitted — ${learner} (${reference}) is ready for Admin review`],
  };
  const [title, summary] = copy[safe.event] || ['Admissions activity', `${learner}'s admissions application was updated — ${reference}`];
  const dedupeKey = `${safe.event}:${safe.enrollmentId}:${safe.documentPublicId || safe.checklistItem || 'application'}:${safe.eventKey || 'initial'}`.slice(0, 180);
  await executor.query(`
    INSERT INTO admissions_notifications (recipient_id, enrollment_id, event_type, title, summary, dedupe_key, payload)
    SELECT id, $1, $2, $3, $4, $5, $6::jsonb FROM users
    WHERE role IN ('admin', 'super_admin') AND is_active = true
  ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  `, [safe.enrollmentId, safe.event, title, summary, dedupeKey, JSON.stringify(safe)]);
}

module.exports = { safePayload, notifyAdmissionsAdmins };