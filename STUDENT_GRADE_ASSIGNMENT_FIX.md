# Student Grade Assignment Fix

## Issue Identified
Students showing "Grade N/A" cannot see documents because they lack proper grade/class assignments.

## Root Cause Analysis
1. Students may have been created without proper grade_id assignment
2. Frontend validation might not be working correctly
3. Database constraints may be missing

## Quick Fix Script (For Railway Console)

```sql
-- Check students without grade assignments
SELECT u.id, u.student_number, u.first_name, u.last_name, u.grade_id, u.class_id,
       g.name as grade_name, c.name as class_name
FROM users u
LEFT JOIN grades g ON u.grade_id = g.id
LEFT JOIN classes c ON u.class_id = c.id
WHERE u.role = 'student'
ORDER BY u.created_at DESC;

-- Check available grades
SELECT * FROM grades ORDER BY id;

-- Check available classes
SELECT * FROM classes ORDER BY id;

-- Assign all unassigned students to Grade 1, Class 1 (adjust as needed)
UPDATE users 
SET grade_id = 1, class_id = 1 
WHERE role = 'student' AND (grade_id IS NULL OR grade_id = 0);

-- Alternative: Assign to specific grade based on pattern
-- UPDATE users SET grade_id = 1, class_id = 1 WHERE role = 'student' AND grade_id IS NULL;
```

## Prevention Measures
1. Add database constraints
2. Improve frontend validation
3. Add default grade assignment

## Implementation Steps
1. Run diagnostic SQL queries
2. Update unassigned students
3. Add database constraints
4. Test document visibility
