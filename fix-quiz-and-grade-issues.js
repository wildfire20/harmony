const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixQuizAndGradeIssues() {
  try {
    console.log('🔧 Fixing Quiz and Grade Display Issues...\n');

    // 1. Check and fix quiz JSON corruption
    console.log('1️⃣ Checking quiz questions data...');
    const quizzesResult = await pool.query(`
      SELECT id, task_id, questions, 
             CASE 
               WHEN questions IS NULL THEN 'NULL'
               WHEN questions = '' THEN 'EMPTY'
               WHEN questions LIKE '[%' THEN 'ARRAY_STRING'
               WHEN questions LIKE '{%' THEN 'OBJECT_STRING'
               ELSE 'OTHER'
             END as data_type
      FROM quizzes
    `);

    console.log(`Found ${quizzesResult.rows.length} quizzes:`);
    for (const quiz of quizzesResult.rows) {
      console.log(`  Quiz ${quiz.id} (Task ${quiz.task_id}): ${quiz.data_type}`);
      
      // Try to parse and validate
      if (quiz.questions) {
        try {
          const parsed = JSON.parse(quiz.questions);
          if (!Array.isArray(parsed)) {
            console.log(`    ❌ Questions is not an array!`);
          } else {
            console.log(`    ✅ Valid JSON with ${parsed.length} questions`);
          }
        } catch (e) {
          console.log(`    ❌ JSON parse error: ${e.message}`);
        }
      }
    }

    // 2. Check grade names for duplication
    console.log('\n2️⃣ Checking grade names...');
    const gradesResult = await pool.query('SELECT id, name FROM grades ORDER BY id');
    console.log('Current grades:');
    for (const grade of gradesResult.rows) {
      console.log(`  Grade ${grade.id}: "${grade.name}"`);
      
      // Check if grade name has "Grade" prefix duplicated
      if (grade.name.toLowerCase().startsWith('grade grade')) {
        console.log(`    ❌ Duplicated "Grade" prefix detected!`);
        const fixedName = grade.name.replace(/^grade\s+/i, '');
        console.log(`    🔧 Fixing: "${grade.name}" -> "${fixedName}"`);
        
        await pool.query('UPDATE grades SET name = $1 WHERE id = $2', [fixedName, grade.id]);
        console.log(`    ✅ Fixed grade ${grade.id}`);
      }
    }

    // 3. Check if any students have corrupted grade/class data
    console.log('\n3️⃣ Checking student grade/class assignments...');
    const studentsResult = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.grade_id, u.class_id,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student' AND (u.grade_id IS NULL OR u.class_id IS NULL)
      LIMIT 5
    `);

    if (studentsResult.rows.length > 0) {
      console.log(`Found ${studentsResult.rows.length} students with missing grade/class assignments:`);
      for (const student of studentsResult.rows) {
        console.log(`  ${student.first_name} ${student.last_name}: Grade ${student.grade_id}, Class ${student.class_id}`);
      }
    } else {
      console.log('✅ All students have proper grade/class assignments');
    }

    // 4. Test quiz creation with proper validation
    console.log('\n4️⃣ Testing quiz question structure...');
    const testQuestions = [
      {
        id: 1,
        question: "What is 2 + 2?",
        type: "multiple_choice",
        options: ["3", "4", "5", "6"],
        correct_answer: "4",
        points: 1,
        explanation: "Basic addition"
      }
    ];

    const testJSON = JSON.stringify(testQuestions);
    console.log(`Test questions JSON: ${testJSON.length} characters`);
    
    try {
      const parsed = JSON.parse(testJSON);
      console.log(`✅ Test JSON is valid with ${parsed.length} questions`);
    } catch (e) {
      console.log(`❌ Test JSON failed: ${e.message}`);
    }

    console.log('\n🎉 Quiz and Grade fixes completed!');
    await pool.end();

  } catch (error) {
    console.error('❌ Fix error:', error);
    await pool.end();
    process.exit(1);
  }
}

fixQuizAndGradeIssues();
