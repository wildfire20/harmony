BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SEQUENCE IF NOT EXISTS enrollment_application_reference_seq START WITH 1;

LOCK TABLE enrollments IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE admissions_migration_id_snapshot ON COMMIT DROP AS
  SELECT id FROM enrollments;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS application_reference VARCHAR(32),
  ADD COLUMN IF NOT EXISTS parent_status_message TEXT,
  ADD COLUMN IF NOT EXISTS registration_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS registration_token_issued_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS registration_token_expires_at TIMESTAMP;

UPDATE enrollments
SET application_reference = NULL
WHERE application_reference IS NOT NULL
  AND BTRIM(application_reference) = '';

DO $$
DECLARE
  invalid_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM enrollments
  WHERE application_reference IS NOT NULL
    AND application_reference !~ '^HLI-2027-[0-9]+$';

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Admissions migration stopped: % non-empty application references require manual review',
      invalid_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_application_reference
  ON enrollments(application_reference)
  WHERE application_reference IS NOT NULL;

ALTER TABLE enrollments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check CHECK (
  status IN (
    'NEW', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED',
    'REGISTRATION_PENDING', 'REGISTERED', 'NOT_ACCEPTED',
    'pending', 'approved', 'rejected', 'waitlisted'
  )
);

WITH existing_max AS (
  SELECT COALESCE(MAX(
    SUBSTRING(application_reference FROM '^HLI-2027-([0-9]+)$')::BIGINT
  ), 0) AS max_number
  FROM enrollments
  WHERE application_reference ~ '^HLI-2027-[0-9]+$'
),
missing_references AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at NULLS LAST, id) AS reference_offset
  FROM enrollments
  WHERE application_reference IS NULL
)
UPDATE enrollments AS enrollment
SET application_reference =
  'HLI-2027-' ||
  LPAD((existing_max.max_number + missing_references.reference_offset)::TEXT, 4, '0')
FROM existing_max, missing_references
WHERE enrollment.id = missing_references.id;

WITH highest_reference AS (
  SELECT COALESCE(MAX(
    SUBSTRING(application_reference FROM '^HLI-2027-([0-9]+)$')::BIGINT
  ), 0) AS highest_number
  FROM enrollments
  WHERE application_reference ~ '^HLI-2027-[0-9]+$'
),
current_sequence AS (
  SELECT
    CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next_number
  FROM enrollment_application_reference_seq
)
SELECT setval(
  'enrollment_application_reference_seq',
  GREATEST(highest_reference.highest_number + 1, current_sequence.next_number, 1),
  false
)
FROM highest_reference, current_sequence;

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

DO $$
DECLARE
  null_reference_count BIGINT;
  duplicate_reference_count BIGINT;
  changed_id_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO null_reference_count
  FROM enrollments
  WHERE application_reference IS NULL OR BTRIM(application_reference) = '';

  SELECT COUNT(*) INTO duplicate_reference_count
  FROM (
    SELECT application_reference
    FROM enrollments
    GROUP BY application_reference
    HAVING COUNT(*) > 1
  ) duplicates;

  SELECT COUNT(*) INTO changed_id_count
  FROM (
    (SELECT id FROM admissions_migration_id_snapshot
     EXCEPT
     SELECT id FROM enrollments)
    UNION ALL
    (SELECT id FROM enrollments
     EXCEPT
     SELECT id FROM admissions_migration_id_snapshot)
  ) changed_ids;

  IF null_reference_count <> 0
    OR duplicate_reference_count <> 0
    OR changed_id_count <> 0 THEN
    RAISE EXCEPTION
      'Admissions migration verification failed: null references %, duplicate references %, changed IDs %',
      null_reference_count,
      duplicate_reference_count,
      changed_id_count;
  END IF;
END $$;

COMMIT;