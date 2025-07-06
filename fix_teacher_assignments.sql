-- Quick fix to ensure teacher "ove ove" is assigned to the grade/class
-- First, let's see what we have:

-- Check current teacher assignments
SELECT 'Current teacher assignments:' as info;
SELECT ta.id, ta.teacher_id, ta.grade_id, ta.class_id, 
       u.first_name, u.last_name, g.name as grade_name, c.name as class_name
FROM teacher_assignments ta
JOIN users u ON ta.teacher_id = u.id
JOIN grades g ON ta.grade_id = g.id
JOIN classes c ON ta.class_id = c.id;

-- Check student "Broe Plussies" grade/class
SELECT 'Student info:' as info;
SELECT id, first_name, last_name, student_number, grade_id, class_id
FROM users 
WHERE first_name = 'Broe' AND last_name = 'Plussies';

-- Check teacher "ove ove" 
SELECT 'Teacher info:' as info;
SELECT id, first_name, last_name, role
FROM users 
WHERE first_name = 'ove' AND last_name = 'ove';

-- Check the task details
SELECT 'Task info:' as info;
SELECT t.id, t.title, t.grade_id, t.class_id, t.created_by,
       u.first_name as teacher_first_name, u.last_name as teacher_last_name
FROM tasks t
JOIN users u ON t.created_by = u.id
WHERE t.id = 28;

-- Check submissions
SELECT 'Submissions:' as info;
SELECT s.id, s.task_id, s.student_id, s.submitted_at, s.status,
       u.first_name, u.last_name, u.student_number
FROM submissions s
JOIN users u ON s.student_id = u.id
WHERE s.task_id = 28;
