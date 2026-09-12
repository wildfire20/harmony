-- Parent-safe targeting for announcements and general documents.
-- Manual, additive migration. Do not run automatically during application boot.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_parent_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS target_parent_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS important BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_target_audience_check;
ALTER TABLE announcements
  ADD CONSTRAINT announcements_target_audience_check CHECK (
    target_audience IN (
      'everyone', 'staff', 'students', 'parents', 'all_parents',
      'grade', 'class', 'specific_parents'
    )
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS check_target_audience;
ALTER TABLE documents
  ADD CONSTRAINT check_target_audience CHECK (
    target_audience IS NULL OR target_audience IN (
      'everyone', 'student', 'staff', 'parents', 'all_parents',
      'grade', 'class', 'specific_parents'
    )
  );

CREATE INDEX IF NOT EXISTS idx_announcements_target_parent_ids
  ON announcements USING GIN (target_parent_ids);
CREATE INDEX IF NOT EXISTS idx_documents_target_parent_ids
  ON documents USING GIN (target_parent_ids);