const { Pool } = require('pg');

// Set production DATABASE_URL
process.env.DATABASE_URL = 'postgresql://postgres:xMYmZJjVBIDCJUxmbVQtmNLqfvdPNJJO@junction.proxy.rlwy.net:57481/railway';
process.env.NODE_ENV = 'production';

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function quickDiagnosis() {
  console.log('🔍 QUICK DATABASE DIAGNOSIS FOR RAILWAY');
  console.log('=======================================');
  
  try {
    // Test connection
    console.log('1. Testing connection...');
    const result = await db.query('SELECT NOW() as time');
    console.log('✅ Connected:', result.rows[0].time);
    
    // Check submissions table
    console.log('2. Checking submissions table...');
    const tableCheck = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'submissions'
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('❌ Submissions table missing!');
      
      // Create it
      console.log('3. Creating submissions table...');
      await db.query(`
        CREATE TABLE submissions (
          id SERIAL PRIMARY KEY,
          task_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          quiz_answers JSONB,
          score DECIMAL(5,2) DEFAULT 0,
          max_score DECIMAL(5,2) DEFAULT 0,
          status VARCHAR(20) DEFAULT 'submitted',
          attempt_number INTEGER DEFAULT 1,
          time_taken INTEGER,
          submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          graded_at TIMESTAMP WITH TIME ZONE,
          graded_by INTEGER,
          feedback TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      console.log('✅ Submissions table created');
    } else {
      console.log('✅ Submissions table exists with columns:');
      tableCheck.rows.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type}`);
      });
    }
    
    // Check for existing quizzes
    console.log('4. Checking quiz data...');
    const quizCheck = await db.query(`
      SELECT t.id, t.title, COUNT(q.id) as has_quiz
      FROM tasks t 
      LEFT JOIN quizzes q ON t.id = q.task_id
      WHERE t.task_type = 'quiz' 
      GROUP BY t.id, t.title 
      LIMIT 3
    `);
    
    console.log(`Found ${quizCheck.rows.length} quiz tasks:`);
    quizCheck.rows.forEach(row => {
      console.log(`   - Task ${row.id}: "${row.title}" (Has quiz: ${row.has_quiz > 0})`);
    });
    
    console.log('✅ DIAGNOSIS COMPLETE - Database is accessible');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await db.end();
  }
}

quickDiagnosis();
