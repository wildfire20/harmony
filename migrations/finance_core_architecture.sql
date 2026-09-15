-- Harmony finance core architecture (additive, idempotent, not run by startup).
--
-- This migration intentionally does not backfill service history or convert
-- selected_obligations JSON.  Historical invoices and proposals remain
-- readable through the compatibility paths while all new writes can use the
-- normalized records below.

BEGIN;

-- Serialize operators applying this migration.  PostgreSQL DDL is
-- transactional, so the version marker below cannot commit without every
-- table, constraint, index, and trigger in this file.
SELECT pg_advisory_xact_lock(hashtext('harmony_finance_core_architecture'));

CREATE TABLE IF NOT EXISTS finance_schema_versions (
  schema_key VARCHAR(120) PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- These fields are intentionally nullable. Existing invoices remain unknown
-- rather than being assigned a guessed month or legacy/current status.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS billing_period DATE,
  ADD COLUMN IF NOT EXISTS invoice_kind VARCHAR(40),
  ADD COLUMN IF NOT EXISTS invoice_source VARCHAR(80),
  ADD COLUMN IF NOT EXISTS finance_origin VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_billing_period_month_check'
      AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_billing_period_month_check
      CHECK (billing_period IS NULL OR billing_period = date_trunc('month', billing_period)::date);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_finance_origin_check'
      AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_finance_origin_check
      CHECK (finance_origin IS NULL OR finance_origin IN ('canonical', 'legacy', 'unknown'));
  END IF;
END $$;

-- Fail before installing the canonical identity index when an operator has
-- already supplied duplicate canonical rows. Historical/unknown rows are not
-- guessed or included in this check.
DO $$
DECLARE
  duplicate_identity RECORD;
BEGIN
  SELECT student_id, billing_period, invoice_kind,
         array_agg(id ORDER BY id) AS invoice_ids
    INTO duplicate_identity
  FROM invoices
  WHERE finance_origin = 'canonical'
    AND invoice_kind = 'monthly'
    AND billing_period IS NOT NULL
  GROUP BY student_id, billing_period, invoice_kind
  HAVING COUNT(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Finance migration blocked: duplicate canonical monthly invoices for student %, period %, invoice_kind %, invoice_ids %. Run the read-only finance preflight and reconcile duplicates before retrying.',
      duplicate_identity.student_id, duplicate_identity.billing_period,
      duplicate_identity.invoice_kind, duplicate_identity.invoice_ids
      USING ERRCODE = '23505',
            HINT = 'Do not delete or rewrite invoice evidence; reconcile the duplicate identity with an operator-approved correction.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_canonical_monthly_identity_idx
  ON invoices (student_id, billing_period, invoice_kind)
  WHERE billing_period IS NOT NULL
    AND invoice_kind = 'monthly'
    AND finance_origin = 'canonical';

CREATE TABLE IF NOT EXISTS service_enrollments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  service_key VARCHAR(80) NOT NULL
    CHECK (service_key IN ('tuition', 'boarding', 'transport', 'aftercare')),
  effective_start DATE NOT NULL,
  effective_end DATE,
  state VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'ended', 'cancelled')),
  idempotency_key VARCHAR(180),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_end IS NULL OR effective_end >= effective_start),
  CHECK (state = 'active' OR effective_end IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS service_enrollments_idempotency_idx
  ON service_enrollments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_enrollments_identity_idx
  ON service_enrollments (student_id, service_key, effective_start);

CREATE INDEX IF NOT EXISTS service_enrollments_period_idx
  ON service_enrollments (student_id, service_key, effective_start, effective_end)
  WHERE state = 'active';

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The exclusion constraint, rather than an application-side preflight, is
-- the concurrency-safe authority preventing two active periods for the same
-- learner/category from overlapping.  effective_end is inclusive.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_enrollments_no_overlap'
      AND conrelid = 'service_enrollments'::regclass
  ) THEN
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
      WHERE (state = 'active');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_service_enrollment_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state = 'active' AND EXISTS (
    SELECT 1
    FROM service_enrollments existing
    WHERE existing.student_id = NEW.student_id
      AND existing.service_key = NEW.service_key
      AND existing.state = 'active'
      AND existing.id <> COALESCE(NEW.id, 0)
      AND existing.effective_start <= COALESCE(NEW.effective_end, 'infinity'::date)
      AND COALESCE(existing.effective_end, 'infinity'::date) >= NEW.effective_start
  ) THEN
    RAISE EXCEPTION 'Overlapping active service enrollment for learner and category';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_enrollments_no_overlap ON service_enrollments;
CREATE TRIGGER service_enrollments_no_overlap
  BEFORE INSERT OR UPDATE ON service_enrollments
  FOR EACH ROW EXECUTE FUNCTION prevent_service_enrollment_overlap();

CREATE OR REPLACE FUNCTION prevent_payment_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Payment transactions are immutable; append a reversal or correction event';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_transactions_immutable ON payment_transactions;
CREATE TRIGGER payment_transactions_immutable
  BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_transaction_mutation();

CREATE OR REPLACE FUNCTION require_canonical_invoice_projection_context()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('harmony.finance_command', true) IS DISTINCT FROM 'canonical' THEN
    RAISE EXCEPTION
      'Invoice amount/status projection is protected; use an explicit canonical finance command transaction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_projection_context ON invoices;
CREATE TRIGGER invoices_projection_context
  BEFORE UPDATE OF amount_due, amount_paid, status ON invoices
  FOR EACH ROW EXECUTE FUNCTION require_canonical_invoice_projection_context();

-- Invoice line snapshots are append-only evidence. Updates/deletes are never
-- permitted; legacy classification corrections are separate, zero-value,
-- append-only rows that point at an existing initial classification.
CREATE OR REPLACE FUNCTION prevent_invoice_line_item_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Invoice line-item snapshots are immutable; append a correction row';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_line_items_immutable ON invoice_line_items;
CREATE TRIGGER invoice_line_items_immutable
  BEFORE UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION prevent_invoice_line_item_mutation();

CREATE OR REPLACE FUNCTION validate_invoice_line_item_append()
RETURNS TRIGGER AS $$
DECLARE
  target RECORD;
BEGIN
  IF COALESCE(NEW.metadata->>'source', '') <> 'legacy_classification_correction' THEN
    RETURN NEW;
  END IF;
  IF NEW.line_type <> 'charge'
     OR NEW.amount <> 0
     OR NEW.is_included IS DISTINCT FROM TRUE
     OR NULLIF(NEW.metadata->>'target_line_id', '') IS NULL
     OR NULLIF(NEW.metadata->>'previous_category', '') IS NULL
     OR NULLIF(NEW.metadata->>'new_category', '') IS NULL
     OR NEW.service_key IS NULL
     OR NEW.service_key <> NEW.metadata->>'new_category' THEN
    RAISE EXCEPTION 'Invalid append-only legacy classification correction';
  END IF;
  SELECT id, invoice_id, metadata INTO target
  FROM invoice_line_items
  WHERE id = (NEW.metadata->>'target_line_id')::integer
  FOR SHARE;
  IF target.id IS NULL
     OR target.invoice_id IS DISTINCT FROM NEW.invoice_id
     OR target.metadata->>'source' <> 'legacy_invoice_reconciliation'
     OR target.metadata->>'category' <> NEW.metadata->>'previous_category' THEN
    RAISE EXCEPTION 'Classification correction target is not an initial legacy line';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_line_items_classification_append ON invoice_line_items;
CREATE TRIGGER invoice_line_items_classification_append
  BEFORE INSERT ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION validate_invoice_line_item_append();

-- A proposal is the normalized, reviewable replacement for new JSON
-- selected_obligations entries.  Nullable target columns permit a proposal
-- for a legacy invoice-level obligation, but at least one target is required.
CREATE TABLE IF NOT EXISTS payment_proof_allocation_proposals (
  id SERIAL PRIMARY KEY,
  proof_id INTEGER NOT NULL REFERENCES pending_payments(id) ON DELETE RESTRICT,
  learner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_line_item_id INTEGER REFERENCES invoice_line_items(id) ON DELETE RESTRICT,
  fee_assignment_id INTEGER REFERENCES student_fee_assignments(id) ON DELETE RESTRICT,
  category VARCHAR(40) NOT NULL
    CHECK (category IN ('tuition', 'boarding', 'transport', 'aftercare',
                        'one_off', 'other_recurring', 'credit')),
  proposed_amount NUMERIC(12,2) NOT NULL CHECK (proposed_amount > 0),
  resolution_state VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CHECK (resolution_state IN ('proposed', 'accepted', 'rejected', 'superseded', 'void')),
  idempotency_key VARCHAR(180),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (invoice_id IS NOT NULL OR invoice_line_item_id IS NOT NULL OR fee_assignment_id IS NOT NULL),
  CHECK (invoice_line_item_id IS NULL OR invoice_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_proof_proposals_idempotency_idx
  ON payment_proof_allocation_proposals (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_proof_proposals_target_idx
  ON payment_proof_allocation_proposals (
    proof_id, learner_id, (COALESCE(invoice_id, 0)),
    (COALESCE(invoice_line_item_id, 0)), (COALESCE(fee_assignment_id, 0)), category
  );

CREATE INDEX IF NOT EXISTS payment_proof_proposals_proof_state_idx
  ON payment_proof_allocation_proposals (proof_id, resolution_state, created_at);

-- Accepted allocations are immutable accounting evidence.  Keeping the
-- proposal id preserves the review trail without making JSON authoritative.
CREATE TABLE IF NOT EXISTS payment_proof_allocations (
  id SERIAL PRIMARY KEY,
  proposal_id INTEGER REFERENCES payment_proof_allocation_proposals(id) ON DELETE RESTRICT,
  proof_id INTEGER NOT NULL REFERENCES pending_payments(id) ON DELETE RESTRICT,
  learner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_line_item_id INTEGER REFERENCES invoice_line_items(id) ON DELETE RESTRICT,
  fee_assignment_id INTEGER REFERENCES student_fee_assignments(id) ON DELETE RESTRICT,
  category VARCHAR(40) NOT NULL
    CHECK (category IN ('tuition', 'boarding', 'transport', 'aftercare',
                        'one_off', 'other_recurring', 'credit')),
  proposed_amount NUMERIC(12,2) NOT NULL CHECK (proposed_amount > 0),
  allocated_amount NUMERIC(12,2) NOT NULL CHECK (allocated_amount > 0),
  resolution_state VARCHAR(20) NOT NULL DEFAULT 'accepted'
    CHECK (resolution_state IN ('accepted', 'reversed', 'corrected')),
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (invoice_id IS NOT NULL OR invoice_line_item_id IS NOT NULL OR fee_assignment_id IS NOT NULL),
  CHECK (invoice_line_item_id IS NULL OR invoice_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_proof_allocations_idempotency_idx
  ON payment_proof_allocations (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS payment_proof_allocations_proposal_idx
  ON payment_proof_allocations (proposal_id)
  WHERE proposal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_proof_allocations_learner_idx
  ON payment_proof_allocations (learner_id, created_at);

-- Cross-table identity is deliberately checked by deferred constraint
-- triggers.  This lets a single transaction insert a proof and its proposal
-- in either order while still rejecting mismatched learner/target identities
-- before COMMIT.
CREATE OR REPLACE FUNCTION validate_proof_allocation_consistency()
RETURNS TRIGGER AS $$
DECLARE
  proof_learner INTEGER;
  target_learner INTEGER;
  target_invoice INTEGER;
  target_proof INTEGER;
  target_line_invoice INTEGER;
  target_fee_learner INTEGER;
  proposal_record RECORD;
BEGIN
  SELECT student_id INTO proof_learner
  FROM pending_payments
  WHERE id = NEW.proof_id;
  IF proof_learner IS DISTINCT FROM NEW.learner_id THEN
    RAISE EXCEPTION 'Proof % learner does not match allocation learner', NEW.proof_id;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT student_id INTO target_learner
    FROM invoices
    WHERE id = NEW.invoice_id;
    IF target_learner IS DISTINCT FROM NEW.learner_id THEN
      RAISE EXCEPTION 'Invoice % learner does not match proof allocation learner', NEW.invoice_id;
    END IF;
  END IF;

  IF NEW.invoice_line_item_id IS NOT NULL THEN
    SELECT invoice_id INTO target_line_invoice
    FROM invoice_line_items
    WHERE id = NEW.invoice_line_item_id;
    IF target_line_invoice IS NULL OR target_line_invoice IS DISTINCT FROM NEW.invoice_id THEN
      RAISE EXCEPTION 'Invoice line % does not belong to invoice %',
        NEW.invoice_line_item_id, NEW.invoice_id;
    END IF;
  END IF;

  IF NEW.fee_assignment_id IS NOT NULL THEN
    SELECT student_id INTO target_fee_learner
    FROM student_fee_assignments
    WHERE id = NEW.fee_assignment_id;
    IF target_fee_learner IS DISTINCT FROM NEW.learner_id THEN
      RAISE EXCEPTION 'Fee assignment % learner does not match proof allocation learner',
        NEW.fee_assignment_id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'payment_proof_allocations' AND NEW.proposal_id IS NOT NULL THEN
    SELECT proof_id, learner_id, invoice_id, invoice_line_item_id,
           fee_assignment_id, category
      INTO proposal_record
    FROM payment_proof_allocation_proposals
    WHERE id = NEW.proposal_id;
    IF proposal_record.proof_id IS DISTINCT FROM NEW.proof_id
       OR proposal_record.learner_id IS DISTINCT FROM NEW.learner_id
       OR proposal_record.invoice_id IS DISTINCT FROM NEW.invoice_id
       OR proposal_record.invoice_line_item_id IS DISTINCT FROM NEW.invoice_line_item_id
       OR proposal_record.fee_assignment_id IS DISTINCT FROM NEW.fee_assignment_id
       OR proposal_record.category IS DISTINCT FROM NEW.category THEN
      RAISE EXCEPTION 'Proof allocation % does not match proposal %',
        NEW.id, NEW.proposal_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_proof_proposals_consistency ON payment_proof_allocation_proposals;
CREATE CONSTRAINT TRIGGER payment_proof_proposals_consistency
  AFTER INSERT OR UPDATE ON payment_proof_allocation_proposals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_proof_allocation_consistency();

DROP TRIGGER IF EXISTS payment_proof_allocations_consistency ON payment_proof_allocations;
CREATE CONSTRAINT TRIGGER payment_proof_allocations_consistency
  AFTER INSERT OR UPDATE ON payment_proof_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_proof_allocation_consistency();

CREATE OR REPLACE FUNCTION prevent_payment_proof_allocation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Normalized proof allocations are immutable; record a reversal or correction';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_proof_allocations_immutable ON payment_proof_allocations;
CREATE TRIGGER payment_proof_allocations_immutable
  BEFORE UPDATE OR DELETE ON payment_proof_allocations
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_proof_allocation_mutation();

-- New finance-core clients may record the applied version explicitly.  This
-- is metadata only and does not alter any invoice, payment, or proposal.
INSERT INTO finance_schema_versions (schema_key, version)
VALUES ('finance_core_architecture', 2)
ON CONFLICT (schema_key) DO UPDATE
  SET version = GREATEST(finance_schema_versions.version, EXCLUDED.version);

COMMIT;
