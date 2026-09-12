-- Mini Phase 1 additive finance-truth schema.
-- This file is intentionally explicit: server startup does not execute it,
-- and it does not rewrite historical invoices or payment transactions.

CREATE TABLE IF NOT EXISTS learner_discount_assignments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  discount_type VARCHAR(20) NOT NULL
    CHECK (discount_type IN ('staff', 'sibling', 'custom')),
  calculation_method VARCHAR(20) NOT NULL
    CHECK (calculation_method IN ('fixed', 'percentage')),
  amount NUMERIC(12,2),
  percentage NUMERIC(7,4),
  applicable_service_key VARCHAR(80),
  starts_on DATE NOT NULL,
  ends_on DATE,
  reason TEXT NOT NULL,
  approved_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at TIMESTAMP,
  deactivated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (calculation_method = 'fixed' AND amount IS NOT NULL AND amount >= 0 AND percentage IS NULL)
    OR
    (calculation_method = 'percentage' AND percentage IS NOT NULL AND percentage >= 0 AND percentage <= 100 AND amount IS NULL)
  ),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS learner_discount_assignments_student_idx
  ON learner_discount_assignments (student_id, starts_on, ends_on)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  line_type VARCHAR(20) NOT NULL CHECK (line_type IN ('charge', 'discount')),
  service_key VARCHAR(80),
  bundle_key VARCHAR(80),
  label VARCHAR(255) NOT NULL,
  description TEXT,
  quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
  unit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  is_included BOOLEAN NOT NULL DEFAULT FALSE,
  discount_assignment_id INTEGER REFERENCES learner_discount_assignments(id) ON DELETE RESTRICT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx
  ON invoice_line_items (invoice_id, id);

CREATE OR REPLACE FUNCTION prevent_invoice_line_item_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Invoice line-item snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_line_items_immutable ON invoice_line_items;
CREATE TRIGGER invoice_line_items_immutable
  BEFORE UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION prevent_invoice_line_item_mutation();

-- Billing metadata is configuration only. Existing service prices retain their
-- current behavior until an operator configures bundle/billing fields.
ALTER TABLE service_prices
  ADD COLUMN IF NOT EXISTS billing_group VARCHAR(80),
  ADD COLUMN IF NOT EXISTS bundle_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS included_service_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) NOT NULL DEFAULT 'standalone'
    CHECK (billing_mode IN ('standalone', 'bundle_component', 'informational'));

CREATE INDEX IF NOT EXISTS service_prices_bundle_idx
  ON service_prices (bundle_key)
  WHERE bundle_key IS NOT NULL;
