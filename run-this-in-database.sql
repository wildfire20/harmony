-- Run this in your Railway PostgreSQL database
-- You can access it via Railway dashboard → Database → Connect

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS s3_url TEXT,
ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_documents_s3_key ON documents(s3_key);

-- Update existing records
UPDATE documents 
SET original_file_name = file_name 
WHERE original_file_name IS NULL;
