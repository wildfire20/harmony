-- Parent self-activation (MANUAL migration; never run at application startup).
-- Additive and safe to apply repeatedly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_account_status VARCHAR(32);

CREATE TABLE IF NOT EXISTS parent_activation_challenges (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  delivery_confirmed_at TIMESTAMPTZ,
  completion_token_hash CHAR(64),
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE parent_activation_challenges
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ;
ALTER TABLE parent_activation_challenges
  ADD COLUMN IF NOT EXISTS completion_token_hash CHAR(64);

CREATE INDEX IF NOT EXISTS idx_parent_activation_challenges_user
  ON parent_activation_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_activation_challenges_expiry
  ON parent_activation_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_parent_activation_challenges_created
  ON parent_activation_challenges(user_id, created_at);