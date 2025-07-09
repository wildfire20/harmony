-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    instructions TEXT,
    due_date TIMESTAMP,
    max_points INTEGER DEFAULT 100,
    task_type VARCHAR(50) DEFAULT 'assignment' CHECK (task_type IN ('assignment', 'quiz')),
    submission_type VARCHAR(50) DEFAULT 'online' CHECK (submission_type IN ('online', 'physical')),
    attachment_s3_key VARCHAR(500),
    attachment_s3_url TEXT,
    attachment_original_name VARCHAR(255),
    attachment_file_size BIGINT,
    attachment_file_type VARCHAR(100),
    grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create submissions table
CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    file_path VARCHAR(500),
    s3_key VARCHAR(500),
    s3_url TEXT,
    original_file_name VARCHAR(255),
    file_size BIGINT,
    file_type VARCHAR(100),
    quiz_answers JSONB,
    score DECIMAL(5,2),
    max_score DECIMAL(5,2),
    feedback TEXT,
    status VARCHAR(50) DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned')),
    attempt_number INTEGER DEFAULT 1,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    graded_at TIMESTAMP,
    UNIQUE(task_id, student_id, attempt_number)
);

-- Create quizzes table for quiz-specific data
CREATE TABLE IF NOT EXISTS quizzes (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    questions JSONB NOT NULL,
    time_limit INTEGER, -- in minutes
    attempts_allowed INTEGER DEFAULT 1,
    show_results BOOLEAN DEFAULT true,
    randomize_questions BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tasks_grade_class ON tasks(grade_id, class_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_attachment_s3_key ON tasks(attachment_s3_key);
CREATE INDEX IF NOT EXISTS idx_submissions_task_student ON submissions(task_id, student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_s3_key ON submissions(s3_key);
CREATE INDEX IF NOT EXISTS idx_quizzes_task ON quizzes(task_id);
