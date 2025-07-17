-- Enhanced Quiz System Database Setup
-- Run this script to ensure all tables and indexes are properly configured

-- Add additional columns to submissions table for enhanced quiz functionality
DO $$ 
BEGIN
    -- Add time_taken column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'submissions' AND column_name = 'time_taken') THEN
        ALTER TABLE submissions ADD COLUMN time_taken INTEGER; -- in seconds
    END IF;
    
    -- Add graded_by column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'submissions' AND column_name = 'graded_by') THEN
        ALTER TABLE submissions ADD COLUMN graded_by INTEGER REFERENCES users(id);
    END IF;
    
    -- Update status enum to include new statuses
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_status_check 
        CHECK (status IN ('submitted', 'graded', 'returned', 'pending_review'));

END $$;

-- Create indexes for better performance on quiz-related queries
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_graded_by ON submissions(graded_by);
CREATE INDEX IF NOT EXISTS idx_submissions_attempt ON submissions(task_id, student_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date_active ON tasks(due_date, is_active);

-- Create a view for quiz overview (useful for teacher dashboards)
CREATE OR REPLACE VIEW quiz_overview AS
SELECT 
    t.id as task_id,
    t.title,
    t.description,
    t.due_date,
    t.max_points,
    t.grade_id,
    t.class_id,
    g.name as grade_name,
    c.name as class_name,
    q.id as quiz_id,
    q.time_limit,
    q.attempts_allowed,
    q.show_results,
    q.randomize_questions,
    t.created_by as teacher_id,
    u.first_name as teacher_first_name,
    u.last_name as teacher_last_name,
    t.created_at,
    CASE 
        WHEN t.due_date < NOW() THEN 'overdue'
        WHEN t.due_date::date = CURRENT_DATE THEN 'due_today'
        ELSE 'active'
    END as status,
    (SELECT COUNT(*) FROM submissions s WHERE s.task_id = t.id) as submission_count,
    (SELECT COUNT(DISTINCT student_id) FROM submissions s WHERE s.task_id = t.id) as students_submitted,
    (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'student' AND u2.grade_id = t.grade_id AND u2.class_id = t.class_id AND u2.is_active = true) as total_students
FROM tasks t
JOIN quizzes q ON t.id = q.task_id
JOIN grades g ON t.grade_id = g.id
JOIN classes c ON t.class_id = c.id
JOIN users u ON t.created_by = u.id
WHERE t.is_active = true AND t.task_type = 'quiz';

-- Create a view for student quiz status
CREATE OR REPLACE VIEW student_quiz_status AS
SELECT 
    t.id as task_id,
    t.title,
    t.due_date,
    t.max_points,
    t.grade_id,
    t.class_id,
    q.attempts_allowed,
    q.time_limit,
    u.id as student_id,
    u.student_number,
    u.first_name,
    u.last_name,
    COALESCE(s.attempt_count, 0) as attempts_made,
    COALESCE(s.best_score, 0) as best_score,
    s.last_submission,
    s.last_status,
    CASE 
        WHEN t.due_date < NOW() AND COALESCE(s.attempt_count, 0) = 0 THEN 'overdue_not_attempted'
        WHEN t.due_date < NOW() AND COALESCE(s.attempt_count, 0) > 0 THEN 'overdue_attempted'
        WHEN COALESCE(s.attempt_count, 0) = 0 THEN 'not_attempted'
        WHEN COALESCE(s.attempt_count, 0) >= q.attempts_allowed THEN 'completed'
        ELSE 'in_progress'
    END as student_status
FROM tasks t
JOIN quizzes q ON t.id = q.task_id
CROSS JOIN users u
LEFT JOIN (
    SELECT 
        task_id,
        student_id,
        COUNT(*) as attempt_count,
        MAX(score) as best_score,
        MAX(submitted_at) as last_submission,
        MAX(status) as last_status
    FROM submissions 
    GROUP BY task_id, student_id
) s ON t.id = s.task_id AND u.id = s.student_id
WHERE t.is_active = true 
  AND t.task_type = 'quiz'
  AND u.role = 'student' 
  AND u.is_active = true
  AND u.grade_id = t.grade_id 
  AND u.class_id = t.class_id;

-- Create function to get quiz question analytics
CREATE OR REPLACE FUNCTION get_quiz_question_analytics(quiz_task_id INTEGER)
RETURNS TABLE (
    question_id INTEGER,
    question_text TEXT,
    question_type VARCHAR,
    total_answers BIGINT,
    correct_answers BIGINT,
    accuracy_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH quiz_data AS (
        SELECT jsonb_array_elements(q.questions) as question
        FROM quizzes q
        WHERE q.task_id = quiz_task_id
    ),
    question_info AS (
        SELECT 
            (question->>'id')::INTEGER as q_id,
            question->>'question' as q_text,
            question->>'type' as q_type
        FROM quiz_data
    ),
    answer_stats AS (
        SELECT 
            (jsonb_array_elements(s.quiz_answers)->>'question_id')::INTEGER as q_id,
            COUNT(*) as total_count,
            SUM(CASE WHEN (jsonb_array_elements(s.quiz_answers)->>'is_correct')::BOOLEAN THEN 1 ELSE 0 END) as correct_count
        FROM submissions s
        WHERE s.task_id = quiz_task_id
          AND s.quiz_answers IS NOT NULL
        GROUP BY (jsonb_array_elements(s.quiz_answers)->>'question_id')::INTEGER
    )
    SELECT 
        qi.q_id,
        qi.q_text,
        qi.q_type,
        COALESCE(ast.total_count, 0),
        COALESCE(ast.correct_count, 0),
        CASE 
            WHEN COALESCE(ast.total_count, 0) = 0 THEN 0
            ELSE ROUND((COALESCE(ast.correct_count, 0)::NUMERIC / ast.total_count::NUMERIC) * 100, 2)
        END
    FROM question_info qi
    LEFT JOIN answer_stats ast ON qi.q_id = ast.q_id
    ORDER BY qi.q_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to auto-archive old quizzes
CREATE OR REPLACE FUNCTION archive_old_quizzes()
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER;
BEGIN
    -- Archive quizzes that are more than 6 months past due date
    UPDATE tasks 
    SET is_active = false, 
        updated_at = CURRENT_TIMESTAMP
    WHERE task_type = 'quiz' 
      AND is_active = true 
      AND due_date < (CURRENT_DATE - INTERVAL '6 months');
    
    GET DIAGNOSTICS archived_count = ROW_COUNT;
    
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to tasks and quizzes tables
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quizzes_updated_at ON quizzes;
CREATE TRIGGER update_quizzes_updated_at
    BEFORE UPDATE ON quizzes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create quiz statistics summary view
CREATE OR REPLACE VIEW quiz_statistics_summary AS
SELECT 
    t.id as task_id,
    t.title,
    COUNT(DISTINCT s.student_id) as students_attempted,
    COUNT(s.id) as total_submissions,
    AVG(s.score) as average_score,
    MAX(s.score) as highest_score,
    MIN(s.score) as lowest_score,
    AVG(s.score::float / s.max_score::float * 100) as average_percentage,
    COUNT(CASE WHEN s.score::float / s.max_score::float >= 0.6 THEN 1 END)::float / COUNT(s.id)::float * 100 as pass_rate,
    COUNT(CASE WHEN s.status = 'pending_review' THEN 1 END) as pending_manual_grading
FROM tasks t
LEFT JOIN submissions s ON t.id = s.task_id
WHERE t.task_type = 'quiz' AND t.is_active = true
GROUP BY t.id, t.title;

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT SELECT ON quiz_overview TO quiz_readers;
-- GRANT SELECT ON student_quiz_status TO quiz_readers;
-- GRANT EXECUTE ON FUNCTION get_quiz_question_analytics(INTEGER) TO quiz_readers;

COMMENT ON VIEW quiz_overview IS 'Comprehensive view of all quizzes with submission statistics';
COMMENT ON VIEW student_quiz_status IS 'Individual student status for each quiz';
COMMENT ON FUNCTION get_quiz_question_analytics(INTEGER) IS 'Analyzes performance on individual quiz questions';
COMMENT ON FUNCTION archive_old_quizzes() IS 'Archives quizzes that are more than 6 months past due';
