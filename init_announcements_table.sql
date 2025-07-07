-- Create announcements table
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    target_grade_id INTEGER REFERENCES grades(id),
    target_class_id INTEGER REFERENCES classes(id),
    is_global BOOLEAN DEFAULT FALSE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements(created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_target_grade_class ON announcements(target_grade_id, target_class_id);
CREATE INDEX IF NOT EXISTS idx_announcements_is_global ON announcements(is_global);
CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at);

-- Add some sample data (optional)
INSERT INTO announcements (title, content, priority, is_global, created_by) 
VALUES 
    ('Welcome to Harmony Learning Institute', 'Welcome to our new academic year! We are excited to have you all here.', 'high', true, 1),
    ('Library Hours Updated', 'The library will now be open from 8 AM to 8 PM on weekdays.', 'medium', true, 1)
ON CONFLICT DO NOTHING;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON announcements TO harmony_user;
GRANT USAGE, SELECT ON SEQUENCE announcements_id_seq TO harmony_user;
