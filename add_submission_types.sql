-- Add submission_type column to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submission_type VARCHAR(20) DEFAULT 'online';

-- Add submission_type column to submissions table for tracking
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submission_type VARCHAR(20) DEFAULT 'online';

-- Add file_name column to submissions table
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);

-- Update existing tasks to have submission_type 'online' for assignments
UPDATE tasks SET submission_type = 'online' WHERE task_type = 'assignment' AND submission_type IS NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_tasks_submission_type ON tasks(submission_type);
CREATE INDEX IF NOT EXISTS idx_submissions_submission_type ON submissions(submission_type);

-- Add constraints to ensure valid submission types
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_submission_type CHECK (submission_type IN ('online', 'physical'));
ALTER TABLE submissions ADD CONSTRAINT chk_submissions_submission_type CHECK (submission_type IN ('online', 'physical'));

-- Update table to ensure original_filename exists in documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255);

-- Update existing documents to have original_filename if missing
UPDATE documents SET original_filename = filename WHERE original_filename IS NULL;

COMMIT;
