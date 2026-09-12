-- Compatibility repair for the legacy server.js parent_push_subscriptions
-- table.  This is intentionally separate from Phase 3: it only repairs
-- metadata/constraints on push rows and never removes or reassigns a row.
--
-- SERIAL/integer ids and TIMESTAMP WITHOUT TIME ZONE are accepted by the
-- readiness verifier as semantically compatible with this application.  We
-- therefore do not rewrite either type (which could change timestamp
-- meaning).  Existing NULL metadata is backfilled safely: an
-- inactive flag becomes true and missing timestamps become the repair time.
-- NOW() deliberately follows the existing production session timezone; no
-- existing timestamp value is converted.
UPDATE parent_push_subscriptions
SET is_active = true
WHERE is_active IS NULL;

UPDATE parent_push_subscriptions
SET created_at = NOW()
WHERE created_at IS NULL;

UPDATE parent_push_subscriptions
SET updated_at = NOW()
WHERE updated_at IS NULL;

ALTER TABLE parent_push_subscriptions
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

-- Add the intended relationship/primary key only when an equivalent one is
-- absent.  Constraint names are not part of the Phase 3 semantic contract.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'parent_push_subscriptions'::regclass
      AND c.contype = 'p'
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = c.conrelid AND attname = 'id' AND NOT attisdropped)
      ]::smallint[]
  ) THEN
    ALTER TABLE parent_push_subscriptions
      ADD CONSTRAINT parent_push_subscriptions_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.confrelid
    WHERE c.conrelid = 'parent_push_subscriptions'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = c.conrelid AND attname = 'parent_id' AND NOT attisdropped)
      ]::smallint[]
      AND r.relname = 'users'
      AND c.confdeltype = 'c'
  ) THEN
    ALTER TABLE parent_push_subscriptions
      ADD CONSTRAINT parent_push_subscriptions_parent_fk
      FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Endpoint uniqueness is reconciled by the Phase 3 base migration above.
-- Keeping no second CREATE/DO block here makes the compatibility repair
-- idempotent without ever creating a duplicate equivalent structure.
CREATE INDEX IF NOT EXISTS idx_parent_push_subscriptions_parent_active
  ON parent_push_subscriptions (parent_id, is_active);