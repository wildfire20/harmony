-- Additive only. No existing learner, parent, admissions or Finance data is changed.
CREATE TABLE IF NOT EXISTS parent_reregistrations (
  id SERIAL PRIMARY KEY,
  school_year INTEGER NOT NULL CHECK (school_year BETWEEN 2027 AND 2100),
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('portal','paper')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','changes_needed','approved')),
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(form_data)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  review_note TEXT NOT NULL DEFAULT '',
  office_note TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id,school_year)
);
CREATE INDEX IF NOT EXISTS parent_reregistrations_review ON parent_reregistrations(school_year,status,updated_at);
CREATE TABLE IF NOT EXISTS parent_reregistration_actions (
  request_key UUID PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES parent_reregistrations(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS parent_reregistration_emails (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES parent_reregistrations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('received','approved')),
  recipient_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  recipient_email TEXT,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sending','accepted','skipped','failed','check_required')),
  error_category TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(registration_id,kind)
);
CREATE INDEX IF NOT EXISTS parent_reregistration_emails_pending ON parent_reregistration_emails(next_attempt_at) WHERE status IN ('queued','sending');
CREATE TABLE IF NOT EXISTS parent_reregistration_email_budget (
  budget_day DATE PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

ALTER TABLE parent_reregistrations
  ADD COLUMN IF NOT EXISTS definition_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deposit_invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS received_date DATE,
  ADD COLUMN IF NOT EXISTS receipt_number TEXT;
ALTER TABLE parent_reregistrations DROP CONSTRAINT IF EXISTS parent_reregistrations_status_check;
ALTER TABLE parent_reregistrations ADD CONSTRAINT parent_reregistrations_status_check
  CHECK(status IN ('draft','submitted','changes_needed','approved','recorded','waiting_list'));
CREATE UNIQUE INDEX IF NOT EXISTS invoices_parent_reregistration_year
  ON invoices(student_id,billing_period)
  WHERE invoice_source='parent_reregistration' AND invoice_kind='one_off';
CREATE TABLE IF NOT EXISTS parent_reregistration_versions (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES parent_reregistrations(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  definition_version INTEGER NOT NULL,
  form_data JSONB NOT NULL,
  source TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(registration_id,version)
);
CREATE TABLE IF NOT EXISTS parent_reregistration_proofs (
  proof_id INTEGER PRIMARY KEY REFERENCES pending_payments(id) ON DELETE RESTRICT,
  registration_id INTEGER NOT NULL REFERENCES parent_reregistrations(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  request_key UUID UNIQUE NOT NULL,
  payload_hash TEXT NOT NULL
);
