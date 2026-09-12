BEGIN;

ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS parent_visible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_school_events_parent_visible_start
  ON school_events(parent_visible, start_date)
  WHERE is_active = TRUE;

COMMIT;