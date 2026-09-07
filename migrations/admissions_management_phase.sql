BEGIN;

CREATE SEQUENCE IF NOT EXISTS enrollment_application_reference_seq START WITH 1;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS application_reference VARCHAR(32),
  ADD COLUMN IF NOT EXISTS parent_status_message TEXT,
  ADD COLUMN IF NOT EXISTS registration_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS registration_token_issued_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS registration_token_expires_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_application_reference
  ON enrollments(application_reference)
  WHERE application_reference IS NOT NULL;

ALTER TABLE enrollments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments ALTER COLUMN status SET DEFAULT 'NEW';
ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check CHECK (
  status IN (
    'NEW', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED',
    'REGISTRATION_PENDING', 'REGISTERED', 'NOT_ACCEPTED',
    'pending', 'approved', 'rejected', 'waitlisted'
  )
);

CREATE TABLE IF NOT EXISTS enrollment_status_history (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  previous_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrollment_status_history_enrollment
  ON enrollment_status_history(enrollment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admissions_email_log (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  email_type VARCHAR(40) NOT NULL,
  delivery_status VARCHAR(20) NOT NULL CHECK (delivery_status IN ('sent', 'failed', 'skipped')),
  message_id VARCHAR(255),
  error_message VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admissions_email_log_enrollment
  ON admissions_email_log(enrollment_id, created_at DESC);

COMMIT;