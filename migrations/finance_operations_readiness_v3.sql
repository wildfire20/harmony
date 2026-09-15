-- Harmony finance operations readiness schema v3.
--
-- Additive follow-up to finance_core_architecture.sql (v2). This migration
-- is operator-applied only; it is intentionally not loaded by application
-- startup. It broadens database enforcement from active rows to every
-- historically effective row except explicitly cancelled rows.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('harmony_finance_operations_readiness_v3'));

-- Never discard evidence while changing the enforcement predicate. Abort
-- before dropping the old constraint if any existing non-cancelled rows
-- already overlap, including ended/ended history.
DO $$
DECLARE
  conflict RECORD;
BEGIN
  SELECT current_row.id AS current_id, existing_row.id AS existing_id,
         current_row.student_id, current_row.service_key
    INTO conflict
  FROM service_enrollments current_row
  JOIN service_enrollments existing_row
    ON existing_row.id < current_row.id
   AND existing_row.student_id = current_row.student_id
   AND existing_row.service_key = current_row.service_key
   AND existing_row.state <> 'cancelled'
   AND daterange(
         existing_row.effective_start,
         COALESCE(existing_row.effective_end + 1, 'infinity'::date),
         '[)'
       ) &&
       daterange(
         current_row.effective_start,
         COALESCE(current_row.effective_end + 1, 'infinity'::date),
         '[)'
       )
  WHERE current_row.state <> 'cancelled'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Finance readiness migration blocked: non-cancelled service enrollments % and % overlap for learner % and service %',
      conflict.existing_id, conflict.current_id,
      conflict.student_id, conflict.service_key
      USING ERRCODE = '23P01',
            HINT = 'Reconcile the effective dates without deleting historical enrollment evidence, then retry.';
  END IF;
END $$;

DROP INDEX IF EXISTS service_enrollments_period_idx;
CREATE INDEX service_enrollments_period_idx
  ON service_enrollments (student_id, service_key, effective_start, effective_end)
  WHERE state <> 'cancelled';

ALTER TABLE service_enrollments
  DROP CONSTRAINT IF EXISTS service_enrollments_no_overlap;

ALTER TABLE service_enrollments
  ADD CONSTRAINT service_enrollments_no_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    service_key WITH =,
    daterange(
      effective_start,
      COALESCE(effective_end + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  )
  WHERE (state <> 'cancelled');

CREATE OR REPLACE FUNCTION prevent_service_enrollment_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state <> 'cancelled' AND EXISTS (
    SELECT 1
    FROM service_enrollments existing
    WHERE existing.student_id = NEW.student_id
      AND existing.service_key = NEW.service_key
      AND existing.state <> 'cancelled'
      AND existing.id <> COALESCE(NEW.id, 0)
      AND existing.effective_start <= COALESCE(NEW.effective_end, 'infinity'::date)
      AND COALESCE(existing.effective_end, 'infinity'::date) >= NEW.effective_start
  ) THEN
    RAISE EXCEPTION 'Overlapping non-cancelled service enrollment for learner and category'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_enrollments_no_overlap ON service_enrollments;
CREATE TRIGGER service_enrollments_no_overlap
  BEFORE INSERT OR UPDATE ON service_enrollments
  FOR EACH ROW EXECUTE FUNCTION prevent_service_enrollment_overlap();

INSERT INTO finance_schema_versions (schema_key, version)
VALUES ('finance_operations_readiness', 3)
ON CONFLICT (schema_key) DO UPDATE
  SET version = GREATEST(finance_schema_versions.version, EXCLUDED.version);

-- Keep the original architecture marker monotonic for operators that track
-- the additive finance schema under its v2 key.
INSERT INTO finance_schema_versions (schema_key, version)
VALUES ('finance_core_architecture', 3)
ON CONFLICT (schema_key) DO UPDATE
  SET version = GREATEST(finance_schema_versions.version, EXCLUDED.version);

COMMIT;