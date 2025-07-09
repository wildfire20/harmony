-- Migration to add S3 support to documents table
-- Run this script on your database to add the necessary columns

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS s3_url TEXT,
ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255);

-- Add index for better performance on S3 key lookups
CREATE INDEX IF NOT EXISTS idx_documents_s3_key ON documents(s3_key);

-- Update existing records to have original_file_name (copy from file_name if null)
UPDATE documents 
SET original_file_name = file_name 
WHERE original_file_name IS NULL;

-- Optional: Add comment to document the new columns
COMMENT ON COLUMN documents.s3_key IS 'S3 object key for cloud storage';
COMMENT ON COLUMN documents.s3_url IS 'S3 URL for the stored file';
COMMENT ON COLUMN documents.original_file_name IS 'Original filename as uploaded by user';
