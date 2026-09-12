-- Phase 2 parent authentication (additive and safe to run repeatedly).
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_revoked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS parent_auth_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_type VARCHAR(16) NOT NULL CHECK (token_type IN ('activation','reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_parent_auth_tokens_user ON parent_auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_auth_tokens_expiry ON parent_auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS parent_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  family_expires_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  replaced_by_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip_address VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_parent_sessions_user ON parent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_sessions_family ON parent_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_parent_sessions_expiry ON parent_sessions(expires_at);
ALTER TABLE parent_sessions ADD COLUMN IF NOT EXISTS family_expires_at TIMESTAMPTZ;
UPDATE parent_sessions SET family_expires_at=expires_at WHERE family_expires_at IS NULL;
ALTER TABLE parent_sessions ALTER COLUMN family_expires_at SET NOT NULL;
