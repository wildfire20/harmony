const db = require('../config/database');

const safePayload = (payload = {}) => ({
  enrollmentId: Number.isSafeInteger(Number(payload.enrollmentId)) ? Number(payload.enrollmentId) : null,
  event: String(payload.event || '').slice(0, 80),
  documentPublicId: payload.documentPublicId ? String(payload.documentPublicId).slice(0, 80) : null,
  checklistItem: payload.checklistItem ? String(payload.checklistItem).slice(0, 40) : null,
  eventKey: payload.eventKey ? String(payload.eventKey).slice(0, 80) : null,
});
const EVENT_COPY = Object.freeze({
  DOCUMENT_UPLOADED: ['New document uploaded', 'A parent uploaded an admissions document for review.'],
  DOCUMENT_REPLACED: ['Document replaced', 'A parent uploaded a replacement admissions document.'],
  DOCUMENT_REVIEWED: ['Document reviewed', 'An admissions document was marked as received.'],
  DOCUMENT_REPLACEMENT_REQUIRED: ['Document replacement required', 'An admissions document requires replacement.'],
  NEW_APPLICATION: ['New admissions application', 'A new admissions application requires attention.'],
  INFORMATION_SUBMITTED: ['Information submitted', 'A parent submitted requested admissions information.'],
  BRING_IN_PERSON_SELECTED: ['In-person document delivery selected', 'A parent will bring a requested document in person.'],
  REGISTRATION_SUBMITTED: ['Registration submitted', 'A parent submitted registration for review.'],
});

async function notifyAdmissionsAdmins(payload, executor = db) {
  const safe = safePayload(payload);
  if (!safe.enrollmentId || !safe.event) return;
  const [title, summary] = EVENT_COPY[safe.event] || ['Admissions activity', 'An admissions application was updated.'];
  const dedupeKey = `${safe.event}:${safe.enrollmentId}:${safe.documentPublicId || safe.checklistItem || 'application'}:${safe.eventKey || 'initial'}`.slice(0, 180);
  await executor.query(`
    INSERT INTO admissions_notifications (recipient_id, enrollment_id, event_type, title, summary, dedupe_key, payload)
    SELECT id, $1, $2, $3, $4, $5, $6::jsonb FROM users
    WHERE role IN ('admin', 'super_admin') AND is_active = true
  ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  `, [safe.enrollmentId, safe.event, title, summary, dedupeKey, JSON.stringify(safe)]);
}

module.exports = { safePayload, notifyAdmissionsAdmins };