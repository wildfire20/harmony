-- Check for students with missing grade/class assignments
SELECT 
  u.id, 
  u.first_name, 
  u.last_name, 
  u.email,
  u.grade_id,
  u.class_id,
  g.name as grade_name,
  c.name as class_name
FROM users u
LEFT JOIN grades g ON u.grade_id = g.id
LEFT JOIN classes c ON u.class_id = c.id
WHERE u.role = 'student'
  AND (u.grade_id IS NULL OR u.class_id IS NULL OR g.id IS NULL OR c.id IS NULL);

-- Check documents table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'documents' 
ORDER BY ordinal_position;

-- Check sample documents
SELECT * FROM documents LIMIT 3;
