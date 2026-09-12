-- Additive finance reconciliation support.
-- Intentionally run as an explicit migration; this file is not loaded by
-- server startup and does not rewrite existing payment history.

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS reverses_transaction_id INTEGER
    REFERENCES payment_transactions(id) ON DELETE RESTRICT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS carried_forward_to_invoice_id INTEGER
    REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_carried_forward_to_invoice_id_idx
  ON invoices (carried_forward_to_invoice_id)
  WHERE carried_forward_to_invoice_id IS NOT NULL;

-- Backfill only an unambiguous source -> active successor relationship.
-- Multiple source invoices may intentionally point to one aggregate arrears
-- invoice. Ambiguous candidates are left NULL for fail-closed application
-- fallback rather than guessed.
WITH candidates AS (
  SELECT
    source.id AS source_id,
    successor.id AS successor_id,
    COUNT(*) OVER (PARTITION BY source.id) AS candidate_count
  FROM invoices source
  JOIN invoices successor
    ON successor.student_id = source.student_id
   AND successor.id <> source.id
   AND successor.status <> 'Carried Forward'
   AND successor.description = 'Arrears from ' ||
       EXTRACT(YEAR FROM source.due_date)::text
   AND successor.due_date >= source.due_date
   AND EXTRACT(YEAR FROM successor.due_date) >= EXTRACT(YEAR FROM source.due_date)
  WHERE source.status = 'Carried Forward'
    AND source.carried_forward_to_invoice_id IS NULL
)
UPDATE invoices source
SET carried_forward_to_invoice_id = candidates.successor_id,
    updated_at = CURRENT_TIMESTAMP
FROM candidates
WHERE source.id = candidates.source_id
  AND candidates.candidate_count = 1;

-- An original payment may have at most one compensating reversal. A nullable
-- partial unique index leaves ordinary payment rows unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_one_reversal_idx
  ON payment_transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

-- Allocation/reversal locking and reconciliation reads commonly locate rows
-- by invoice. Keep this additive and harmless for existing installations.
CREATE INDEX IF NOT EXISTS payment_transactions_invoice_id_idx
  ON payment_transactions (invoice_id)
  WHERE invoice_id IS NOT NULL;