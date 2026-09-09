BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS admissions_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL DEFAULT 'Admissions update',
  summary VARCHAR(500) NOT NULL DEFAULT '',
  dedupe_key VARCHAR(180),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE admissions_notifications
  ADD COLUMN IF NOT EXISTS title VARCHAR(160) NOT NULL DEFAULT 'Admissions update',
  ADD COLUMN IF NOT EXISTS summary VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(180);
ALTER TABLE admissions_portal_documents
  ADD COLUMN IF NOT EXISTS sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS detected_content_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS upload_source VARCHAR(30) NOT NULL DEFAULT 'PARENT_ONLINE',
  ADD COLUMN IF NOT EXISTS scan_status VARCHAR(24) NOT NULL DEFAULT 'NOT_SCANNED',
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS replacement_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS superseded_by_document_id BIGINT;

UPDATE admissions_portal_documents
SET upload_source = 'PARENT_ONLINE'
WHERE upload_source IS NULL;

UPDATE registration_checklist_items
SET parent_submission_choice = NULL
WHERE parent_submission_choice = 'UPLOAD_LATER';

ALTER TABLE admissions_portal_documents
  DROP CONSTRAINT IF EXISTS admissions_portal_documents_upload_source_check,
  DROP CONSTRAINT IF EXISTS admissions_portal_documents_scan_status_check,
  DROP CONSTRAINT IF EXISTS admissions_portal_documents_superseded_fk;
ALTER TABLE admissions_portal_documents
  ADD CONSTRAINT admissions_portal_documents_upload_source_check
    CHECK (upload_source IN ('PARENT_ONLINE', 'ADMIN', 'IN_PERSON')),
  ADD CONSTRAINT admissions_portal_documents_scan_status_check
    CHECK (scan_status IN ('PENDING', 'PASSED', 'FAILED', 'NOT_SCANNED'));

ALTER TABLE registration_checklist_items
  DROP CONSTRAINT IF EXISTS registration_checklist_items_parent_submission_choice_check;
ALTER TABLE registration_checklist_items
  ADD CONSTRAINT registration_checklist_items_parent_submission_choice_check
    CHECK (parent_submission_choice IN ('UPLOAD_ONLINE', 'BRING_IN_PERSON'));

ALTER TABLE admissions_portal_documents
  ADD CONSTRAINT admissions_portal_documents_superseded_fk
    FOREIGN KEY (superseded_by_document_id)
    REFERENCES admissions_portal_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admissions_notifications_recipient
  ON admissions_notifications(recipient_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admissions_notifications_enrollment
  ON admissions_notifications(enrollment_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admissions_notifications_dedupe
  ON admissions_notifications(recipient_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admissions_documents_active_item
  ON admissions_portal_documents(enrollment_id, checklist_item_id, uploaded_at DESC)
  WHERE deleted_at IS NULL AND superseded_by_document_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_admissions_documents_scan_status
  ON admissions_portal_documents(scan_status, review_status, uploaded_at DESC);
DROP INDEX IF EXISTS idx_admissions_documents_sha256_active;
CREATE UNIQUE INDEX idx_admissions_documents_sha256_active
  ON admissions_portal_documents(enrollment_id, sha256)
  WHERE deleted_at IS NULL AND replaced_at IS NULL
    AND superseded_by_document_id IS NULL AND sha256 IS NOT NULL;
COMMIT;