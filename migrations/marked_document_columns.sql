-- Migration script: Add marked document columns to submissions table
-- Run this manually in Railway database console

-- Add marked document columns
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_s3_key VARCHAR(500);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_s3_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_file_path TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_original_name VARCHAR(255);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_file_size BIGINT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_uploaded_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS marked_document_uploaded_by INTEGER;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS teacher_comments TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '[]'::jsonb;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_submissions_marked_document_uploaded_by ON submissions(marked_document_uploaded_by);
CREATE INDEX IF NOT EXISTS idx_submissions_marked_document_uploaded_at ON submissions(marked_document_uploaded_at);
CREATE INDEX IF NOT EXISTS idx_submissions_annotations ON submissions USING GIN (annotations);

-- Verify columns were added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'submissions' 
  AND column_name LIKE '%marked_document%' OR column_name IN ('teacher_comments', 'annotations')
ORDER BY column_name;
