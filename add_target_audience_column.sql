-- Add target_audience column to announcements table
ALTER TABLE announcements 
ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT 'everyone' CHECK (target_audience IN ('everyone', 'staff', 'students'));

-- Update existing records to have default value
UPDATE announcements 
SET target_audience = 'everyone' 
WHERE target_audience IS NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_announcements_target_audience ON announcements(target_audience);

-- Show the updated table structure
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'announcements' 
ORDER BY ordinal_position;
