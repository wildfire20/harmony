BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS registration_records (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
  form_status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (form_status IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'CORRECTIONS_REQUESTED')),
  residential_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  postal_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  emergency_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_selections JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_application_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  application_update_submitted_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  started_at TIMESTAMP,
  submitted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE registration_records
  ADD COLUMN IF NOT EXISTS requested_application_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS application_update_submitted_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS admissions_portal_tokens (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL
    CHECK (purpose IN ('UPDATE_APPLICATION', 'COMPLETE_REGISTRATION')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  replaced_by_token_id BIGINT REFERENCES admissions_portal_tokens(id) ON DELETE SET NULL,
  first_used_at TIMESTAMP,
  last_used_at TIMESTAMP,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_admissions_portal_tokens_enrollment
  ON admissions_portal_tokens(enrollment_id, purpose, issued_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admissions_portal_tokens_one_active
  ON admissions_portal_tokens(enrollment_id, purpose)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS registration_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  item_type VARCHAR(40) NOT NULL
    CHECK (item_type IN (
      'BIRTH_CERTIFICATE',
      'PARENT_GUARDIAN_ID',
      'LATEST_SCHOOL_REPORT',
      'TRANSFER_DOCUMENT',
      'REGISTRATION_FORM'
    )),
  status VARCHAR(24) NOT NULL DEFAULT 'MISSING'
    CHECK (status IN ('MISSING', 'RECEIVED', 'BRING_IN_PERSON', 'NOT_APPLICABLE')),
  parent_submission_choice VARCHAR(20)
    CHECK (parent_submission_choice IN ('UPLOAD_LATER', 'BRING_IN_PERSON')),
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMP,
  received_at TIMESTAMP,
  admin_note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enrollment_id, item_type)
);

ALTER TABLE registration_checklist_items
  ADD COLUMN IF NOT EXISTS parent_submission_choice VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'registration_checklist_items'::regclass
      AND conname = 'registration_checklist_items_parent_submission_choice_check'
  ) THEN
    ALTER TABLE registration_checklist_items
      ADD CONSTRAINT registration_checklist_items_parent_submission_choice_check
      CHECK (parent_submission_choice IN ('UPLOAD_LATER', 'BRING_IN_PERSON'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_registration_checklist_enrollment
  ON registration_checklist_items(enrollment_id);

CREATE TABLE IF NOT EXISTS admissions_portal_documents (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  checklist_item_id BIGINT REFERENCES registration_checklist_items(id) ON DELETE SET NULL,
  storage_key VARCHAR(500) NOT NULL UNIQUE,
  original_filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING', 'RECEIVED', 'REJECTED', 'REPLACEMENT_REQUIRED')),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admissions_portal_documents_enrollment
  ON admissions_portal_documents(enrollment_id, uploaded_at DESC);

DO $$
DECLARE
  missing_table_count INTEGER;
  missing_column_count INTEGER;
  missing_index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_table_count
  FROM (VALUES
    ('admissions_portal_tokens'),
    ('registration_records'),
    ('registration_checklist_items'),
    ('admissions_portal_documents')
  ) AS required(table_name)
  WHERE to_regclass('public.' || required.table_name) IS NULL;

  IF missing_table_count <> 0 THEN
    RAISE EXCEPTION 'Secure registration portal migration verification failed: % tables missing',
      missing_table_count;
  END IF;

  SELECT COUNT(*) INTO missing_column_count
  FROM (VALUES
    ('admissions_portal_tokens', 'enrollment_id'),
    ('admissions_portal_tokens', 'purpose'),
    ('admissions_portal_tokens', 'token_hash'),
    ('admissions_portal_tokens', 'expires_at'),
    ('admissions_portal_tokens', 'revoked_at'),
    ('admissions_portal_tokens', 'last_used_at'),
    ('registration_records', 'enrollment_id'),
    ('registration_records', 'form_status'),
    ('registration_records', 'requested_application_fields'),
    ('registration_records', 'application_update_submitted_at'),
    ('registration_checklist_items', 'enrollment_id'),
    ('registration_checklist_items', 'item_type'),
    ('registration_checklist_items', 'parent_submission_choice'),
    ('admissions_portal_documents', 'enrollment_id'),
    ('admissions_portal_documents', 'public_id')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = required.table_name
      AND columns.column_name = required.column_name
  );

  SELECT COUNT(*) INTO missing_index_count
  FROM (VALUES
    ('idx_admissions_portal_tokens_enrollment'),
    ('idx_admissions_portal_tokens_one_active'),
    ('idx_registration_checklist_enrollment'),
    ('idx_admissions_portal_documents_enrollment')
  ) AS required(index_name)
  WHERE to_regclass('public.' || required.index_name) IS NULL;

  IF missing_column_count <> 0 OR missing_index_count <> 0 THEN
    RAISE EXCEPTION
      'Secure registration portal migration verification failed: % columns missing, % indexes missing',
      missing_column_count,
      missing_index_count;
  END IF;
END $$;

COMMIT;