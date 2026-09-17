-- Harmony finance billing policy readiness schema v4.
--
-- Operator-applied compatibility follow-up to finance operations readiness v3.
-- This migration changes only the service price billing-mode constraint and
-- finance schema version markers. It does not rewrite business data.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('harmony_finance_billing_policy_readiness_v4'));

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'service_prices')) IS NULL THEN
    RAISE EXCEPTION
      'Finance billing policy readiness v4 requires the service_prices table'
      USING ERRCODE = '42P01';
  END IF;

  IF to_regclass(format('%I.%I', current_schema(), 'finance_schema_versions')) IS NULL THEN
    RAISE EXCEPTION
      'Finance billing policy readiness v4 requires the finance_schema_versions table'
      USING ERRCODE = '42P01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM finance_schema_versions
    WHERE schema_key = 'finance_core_architecture'
      AND version >= 3
  ) THEN
    RAISE EXCEPTION
      'Finance billing policy readiness v4 requires finance_core_architecture version >= 3';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM finance_schema_versions
    WHERE schema_key = 'finance_operations_readiness'
      AND version >= 3
  ) THEN
    RAISE EXCEPTION
      'Finance billing policy readiness v4 requires finance_operations_readiness version >= 3';
  END IF;
END $$;

ALTER TABLE service_prices
  DROP CONSTRAINT IF EXISTS service_prices_billing_mode_check;

ALTER TABLE service_prices
  ADD CONSTRAINT service_prices_billing_mode_check
  CHECK (billing_mode IN (
    'standalone',
    'bundle',
    'bundle_component',
    'informational'
  ));

INSERT INTO finance_schema_versions (schema_key, version)
VALUES ('finance_operations_readiness', 4)
ON CONFLICT (schema_key) DO UPDATE
  SET version = GREATEST(finance_schema_versions.version, EXCLUDED.version);

INSERT INTO finance_schema_versions (schema_key, version)
VALUES ('finance_core_architecture', 4)
ON CONFLICT (schema_key) DO UPDATE
  SET version = GREATEST(finance_schema_versions.version, EXCLUDED.version);

COMMIT;