-- Additive invoice cancellation support.
-- Cancelled rows remain immutable financial evidence, but are not payable or
-- included in active learner balances. This migration does not cancel rows.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('harmony_finance_invoice_cancellation'));

DO $$
DECLARE
  unexpected_status TEXT;
BEGIN
  SELECT status INTO unexpected_status
  FROM invoices
  WHERE status NOT IN ('Unpaid', 'Partial', 'Paid', 'Overpaid', 'Carried Forward', 'Cancelled')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Invoice cancellation migration blocked by unsupported status: %', unexpected_status;
  END IF;
END $$;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('Unpaid', 'Partial', 'Paid', 'Overpaid', 'Carried Forward', 'Cancelled'));

COMMIT;