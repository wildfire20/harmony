-- Manual, additive migration. Existing accounts and financial records are untouched.
SELECT pg_advisory_xact_lock(hashtext('harmony:parent-enquiries:v1'));

CREATE TABLE IF NOT EXISTS parent_enquiries (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('portal', 'login_help')),
  contact_name VARCHAR(200) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  subject VARCHAR(160) NOT NULL CHECK (length(trim(subject)) > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'on_hold', 'done')),
  request_key UUID NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source <> 'login_help' OR parent_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_parent_enquiries_parent_updated
  ON parent_enquiries (parent_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_parent_enquiries_status_updated
  ON parent_enquiries (status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS parent_enquiry_messages (
  id SERIAL PRIMARY KEY,
  enquiry_id INTEGER NOT NULL REFERENCES parent_enquiries(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_role VARCHAR(16) NOT NULL CHECK (author_role IN ('parent', 'admin', 'guest')),
  kind VARCHAR(16) NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'status')),
  body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  request_key UUID NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parent_enquiry_messages_thread
  ON parent_enquiry_messages (enquiry_id, id);

-- Read positions are private to each administrator. Existing conversations stay intact.
CREATE TABLE IF NOT EXISTS parent_enquiry_admin_reads (
  enquiry_id INTEGER NOT NULL REFERENCES parent_enquiries(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER NOT NULL REFERENCES parent_enquiry_messages(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (enquiry_id, admin_id)
);
