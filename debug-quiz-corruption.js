const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function debugQuizCorruption() {
  try {
    console.log('🔍 Debugging Quiz Data Corruption...\n');

    // Get all quizzes with their questions
    const quizzesResult = await pool.query(`
      SELECT q.id, q.task_id, q.questions, t.title, t.grade_id, t.class_id,
             g.name as grade_name, c.name as class_name
      FROM quizzes q
      JOIN tasks t ON q.task_id = t.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      ORDER BY q.id DESC
      LIMIT 5
    `);

    console.log(`Found ${quizzesResult.rows.length} recent quizzes:\n`);

    for (const quiz of quizzesResult.rows) {
      console.log(`📝 Quiz ID: ${quiz.id} | Task ID: ${quiz.task_id}`);
      console.log(`   Title: ${quiz.title}`);
      console.log(`   Grade: ${quiz.grade_name} (ID: ${quiz.grade_id})`);
      console.log(`   Class: ${quiz.class_name} (ID: ${quiz.class_id})`);
      console.log(`   Questions Data Type: ${typeof quiz.questions}`);
      console.log(`   Questions Raw Length: ${quiz.questions ? quiz.questions.length : 'NULL'}`);
      
      // Try to parse questions
      try {
        const questions = JSON.parse(quiz.questions);
        console.log(`   ✅ JSON Valid - ${questions.length} questions`);
        
        // Check question structure
        questions.forEach((q, index) => {
          console.log(`     Q${index + 1}: ID=${q.id}, Type=${q.type}, Points=${q.points}`);
        });
      } catch (parseError) {
        console.log(`   ❌ JSON CORRUPTED: ${parseError.message}`);
        console.log(`   Raw Data Preview: ${quiz.questions.substring(0, 200)}...`);
      }
      console.log('');
    }

    // Check student data for the "Grade Grade 1" issue
    console.log('👨‍🎓 Checking Student Data:\n');
    const studentsResult = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.grade_id, u.class_id,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student'
      ORDER BY u.id DESC
      LIMIT 5
    `);

    for (const student of studentsResult.rows) {
      console.log(`Student: ${student.first_name} ${student.last_name}`);
      console.log(`  Grade ID: ${student.grade_id} -> Name: ${student.grade_name}`);
      console.log(`  Class ID: ${student.class_id} -> Name: ${student.class_name}`);
      console.log('');
    }

    // Check grades and classes table
    console.log('📚 Checking Grades & Classes:\n');
    const gradesResult = await pool.query('SELECT id, name FROM grades ORDER BY id');
    const classesResult = await pool.query('SELECT id, name, grade_id FROM classes ORDER BY grade_id, id');

    console.log('Grades:');
    gradesResult.rows.forEach(g => console.log(`  ${g.id}: ${g.name}`));

    console.log('\nClasses:');
    classesResult.rows.forEach(c => console.log(`  ${c.id}: ${c.name} (Grade ${c.grade_id})`));

    await pool.end();

  } catch (error) {
    console.error('Debug Error:', error);
    await pool.end();
    process.exit(1);
  }
}

debugQuizCorruption();
