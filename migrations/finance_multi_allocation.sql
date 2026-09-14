-- Finance integrity: selected multi-obligation proposals and one-off ledger
-- reconciliation. This migration is additive and is intentionally not executed
-- by application startup. It does not infer or backfill historical charges.

ALTER TABLE pending_payments
  ADD COLUMN IF NOT EXISTS selected_obligations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS allocation_category VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_payments_selected_obligations_array'
      AND conrelid = 'public.pending_payments'::regclass
  ) THEN
    ALTER TABLE pending_payments
      ADD CONSTRAINT pending_payments_selected_obligations_array
      CHECK (jsonb_typeof(selected_obligations) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pending_payments_selected_obligations_gin_idx
  ON pending_payments USING GIN (selected_obligations);

-- A newly created one-off assignment gets one immutable invoice snapshot.
-- The expression index prevents a retry or an operational re-run from making
-- a second authoritative obligation for the same assignment.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_line_items_one_off_assignment_idx
  ON invoice_line_items ((metadata->>'assignment_id'))
  WHERE metadata->>'category' = 'one_off'
    AND metadata->>'assignment_id' IS NOT NULL;

-- Payment allocations are events. Corrections are represented by reversal and
-- replacement rows; no caller may mutate or delete the original event.
CREATE OR REPLACE FUNCTION prevent_payment_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Payment transaction events are immutable; record a reversal or correction';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_transactions_immutable ON payment_transactions;
CREATE TRIGGER payment_transactions_immutable
  BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_transaction_mutation();

-- Audit command (read-only, run explicitly after applying this migration):
-- SELECT id, student_id, status, amount, selected_obligations
-- FROM pending_payments WHERE selected_obligations <> '[]'::jsonb;
-- SELECT id, invoice_id, amount, allocation_category
-- FROM payment_transactions WHERE allocation_category IS NOT NULL;