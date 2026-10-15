-- New demerits only: durable portal alerts and a transactional email outbox.
-- No historical backfill and no changes to learner or financial records.
SELECT pg_advisory_xact_lock(hashtext('harmony:behaviour-parent-alerts:v1'));
CREATE TABLE IF NOT EXISTS parent_notifications (
 id BIGSERIAL PRIMARY KEY,event_type VARCHAR(64) NOT NULL,
 parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 learner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(180) NOT NULL,summary VARCHAR(500) NOT NULL,deep_link VARCHAR(80) NOT NULL,
 dedupe_key VARCHAR(240) NOT NULL,important BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT parent_notifications_dedupe_unique UNIQUE(parent_id,dedupe_key)
);
ALTER TABLE parent_notifications DROP CONSTRAINT IF EXISTS parent_notifications_deep_link_check;
ALTER TABLE parent_notifications ADD CONSTRAINT parent_notifications_deep_link_check CHECK(deep_link IN (
 '/parent','/parent/dashboard','/parent/attendance','/parent/grades','/parent/invoices',
 '/parent/payment-proof','/parent/documents','/parent/announcements','/parent/notifications','/parent/behaviour'
));
CREATE INDEX IF NOT EXISTS idx_parent_notifications_parent_created ON parent_notifications(parent_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parent_notifications_learner ON parent_notifications(learner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS parent_notification_reads (
 notification_id BIGINT NOT NULL REFERENCES parent_notifications(id) ON DELETE CASCADE,
 parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),dismissed_at TIMESTAMPTZ,
 PRIMARY KEY(notification_id,parent_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_notification_reads_parent ON parent_notification_reads(parent_id,read_at);
CREATE TABLE IF NOT EXISTS behaviour_parent_emails (
 id BIGSERIAL PRIMARY KEY,
 record_id INTEGER NOT NULL REFERENCES behaviour_records(id) ON DELETE RESTRICT,
 parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_id BIGINT NOT NULL REFERENCES parent_notifications(id) ON DELETE CASCADE,
 recipient_email TEXT,subject TEXT NOT NULL,html TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','skipped','failed','check_required')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),first_attempt_at TIMESTAMPTZ,
 accepted_at TIMESTAMPTZ,error_category VARCHAR(64),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(record_id,parent_id)
);
CREATE INDEX IF NOT EXISTS behaviour_parent_emails_pending ON behaviour_parent_emails(next_attempt_at,id)
 WHERE status IN ('queued','sending');
