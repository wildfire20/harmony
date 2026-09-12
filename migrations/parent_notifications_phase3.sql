-- Phase 3 Parent Notification Centre.  This migration is deliberately manual,
-- additive, and safe to run repeatedly.  It does not change source records.
CREATE TABLE IF NOT EXISTS parent_notifications (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  deep_link VARCHAR(80) NOT NULL,
  dedupe_key VARCHAR(240) NOT NULL,
  important BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parent_notifications_deep_link_check CHECK (
    deep_link IN (
      '/parent', '/parent/dashboard', '/parent/attendance', '/parent/grades',
      '/parent/invoices', '/parent/payment-proof', '/parent/documents',
      '/parent/announcements', '/parent/notifications'
    )
  ),
  CONSTRAINT parent_notifications_dedupe_unique UNIQUE (parent_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_parent_notifications_parent_created
  ON parent_notifications (parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parent_notifications_learner
  ON parent_notifications (learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS parent_notification_reads (
  notification_id BIGINT NOT NULL REFERENCES parent_notifications(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ,
  PRIMARY KEY (notification_id, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_notification_reads_parent
  ON parent_notification_reads (parent_id, read_at);

-- Keep this migration independent of server startup order.  Existing Phase 4
-- deployments already have this table; fresh/manual migration runs create it.
CREATE TABLE IF NOT EXISTS parent_push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  subscription JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE parent_push_subscriptions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE parent_push_subscriptions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE parent_push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Existing deployments used endpoint as the subscription identity.  Keep that
-- invariant: application code rejects an ownership change rather than taking
-- ownership of an existing endpoint.
-- Reconcile by semantics rather than by index name.  In particular, the
-- legacy server-created UNIQUE(endpoint) is commonly backed by an
-- implementation-generated constraint/index name.  Reuse that exact
-- structure when possible so repeated runs never create an equivalent
-- duplicate index.
DO $$
DECLARE
  existing_index text;
  existing_constraint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_index x ON x.indexrelid = i.oid
    WHERE i.relname = 'uq_parent_push_subscriptions_endpoint'
      AND i.relnamespace = 'public'::regnamespace
      AND x.indrelid = 'parent_push_subscriptions'::regclass
      AND x.indisunique
      AND x.indnkeyatts = 1
      AND x.indnatts = 1
      AND x.indpred IS NULL
      AND (SELECT a.attname
           FROM pg_attribute a
           WHERE a.attrelid = x.indrelid
             AND a.attnum = x.indkey[0]
             AND NOT a.attisdropped) = 'endpoint'
  ) THEN
    SELECT i.relname
    INTO existing_index
    FROM pg_class i
    JOIN pg_index x ON x.indexrelid = i.oid
    WHERE i.relnamespace = 'public'::regnamespace
      AND x.indrelid = 'parent_push_subscriptions'::regclass
      AND x.indisunique
      AND x.indnkeyatts = 1
      AND x.indnatts = 1
      AND x.indpred IS NULL
      AND (SELECT a.attname
           FROM pg_attribute a
           WHERE a.attrelid = x.indrelid
             AND a.attnum = x.indkey[0]
             AND NOT a.attisdropped) = 'endpoint'
    LIMIT 1;

    IF existing_index IS NOT NULL THEN
      SELECT c.conname
      INTO existing_constraint
      FROM pg_constraint c
      JOIN pg_class i ON i.oid = c.conindid
      WHERE i.relname = existing_index
        AND c.contype = 'u'
        AND c.conrelid = 'parent_push_subscriptions'::regclass
      LIMIT 1;

      IF existing_constraint IS NOT NULL THEN
        EXECUTE format(
          'ALTER TABLE parent_push_subscriptions RENAME CONSTRAINT %I TO uq_parent_push_subscriptions_endpoint',
          existing_constraint
        );
      ELSE
        EXECUTE format(
          'ALTER INDEX %I RENAME TO uq_parent_push_subscriptions_endpoint',
          existing_index
        );
      END IF;
    ELSE
      CREATE UNIQUE INDEX uq_parent_push_subscriptions_endpoint
        ON parent_push_subscriptions (endpoint);
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_parent_push_subscriptions_parent_active
  ON parent_push_subscriptions (parent_id, is_active);