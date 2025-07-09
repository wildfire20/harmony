-- Add S3 support to submissions table and task attachments
-- Run this in your Railway PostgreSQL database

-- Add S3-related columns to submissions table
ALTER TABLE submissions 
ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS s3_url TEXT,
ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS file_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS file_path TEXT;

-- Add submission_type column to tasks table
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS submission_type VARCHAR(50) DEFAULT 'online' CHECK (submission_type IN ('online', 'physical'));

-- Add task attachment columns to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS attachment_s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS attachment_s3_url TEXT,
ADD COLUMN IF NOT EXISTS attachment_original_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS attachment_file_size BIGINT,
ADD COLUMN IF NOT EXISTS attachment_file_type VARCHAR(100);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_submissions_s3_key ON submissions(s3_key);
CREATE INDEX IF NOT EXISTS idx_tasks_attachment_s3_key ON tasks(attachment_s3_key);

-- Update existing records to set submission_type for tasks
UPDATE tasks 
SET submission_type = 'online' 
WHERE submission_type IS NULL;

-- Update existing submissions to set original_file_name from file_path
UPDATE submissions 
SET original_file_name = SUBSTRING(file_path FROM '[^/]*$')
WHERE original_file_name IS NULL AND file_path IS NOT NULL;

-- Display migration completion message
SELECT 'S3 support added to submissions table and task attachments successfully!' as migration_status;
