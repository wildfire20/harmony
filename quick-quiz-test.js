const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function quickDiagnose() {
  try {
    console.log('🔧 Quick Quiz Diagnosis...');

    // Get the most recent quiz
    const quiz = await pool.query(`
      SELECT q.*, t.title 
      FROM quizzes q 
      JOIN tasks t ON q.task_id = t.id 
      ORDER BY q.id DESC 
      LIMIT 1
    `);

    if (quiz.rows.length === 0) {
      console.log('❌ No quizzes found');
      return;
    }

    const latestQuiz = quiz.rows[0];
    console.log(`📝 Latest Quiz: ${latestQuiz.title} (ID: ${latestQuiz.task_id})`);

    // Test JSON parsing
    try {
      const questions = JSON.parse(latestQuiz.questions);
      console.log(`✅ Questions JSON is valid - ${questions.length} questions`);
    } catch (e) {
      console.log(`❌ Questions JSON is corrupted: ${e.message}`);
      console.log(`Raw questions data: ${latestQuiz.questions}`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

quickDiagnose();
