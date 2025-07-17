-- Add target_audience column to documents table for admin uploads
-- This allows admins to upload documents for specific audiences without grade/class restrictions

-- First, add the column
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT NULL;

-- Add a check constraint to ensure valid values
ALTER TABLE documents 
ADD CONSTRAINT check_target_audience 
CHECK (target_audience IS NULL OR target_audience IN ('everyone', 'student', 'staff'));

-- Create index for better performance on target_audience queries
CREATE INDEX IF NOT EXISTS idx_documents_target_audience ON documents(target_audience);

-- Update existing documents to have appropriate target_audience values
-- Documents with grade_id/class_id are for specific classes (set to NULL to maintain existing behavior)
-- This allows the system to distinguish between class-specific uploads and audience-based uploads

-- Comment for clarity:
-- NULL target_audience = class/grade specific document (teacher uploads)
-- 'everyone' = visible to all users (admin upload)
-- 'student' = visible only to students (admin upload)
-- 'staff' = visible only to teachers and admins (admin upload)
