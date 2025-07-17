const { Pool } = require('pg');

// Use environment DATABASE_URL or Railway URL
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:xMYmZJjVBIDCJUxmbVQtmNLqfvdPNJJO@junction.proxy.rlwy.net:57481/railway';

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initializeSubmissionsTable() {
  console.log('🔧 INITIALIZING SUBMISSIONS TABLE');
  console.log('=================================');
  
  try {
    // Check if table exists
    console.log('Checking if submissions table exists...');
    const tableExists = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'submissions' AND table_schema = 'public'
    `);
    
    if (tableExists.rows.length > 0) {
      console.log('✅ Submissions table already exists');
      
      // Check table structure
      const columns = await db.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'submissions' 
        ORDER BY ordinal_position
      `);
      
      console.log('Current table structure:');
      columns.rows.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
      
      return;
    }
    
    console.log('Creating submissions table...');
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
    
    console.log('Creating indexes...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_task_id ON submissions(task_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON submissions(student_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_unique_attempt 
      ON submissions(task_id, student_id, attempt_number);
    `);
    
    console.log('✅ Submissions table created successfully with indexes');
    
    // Test insert
    console.log('Testing table with sample insert...');
    try {
      const testResult = await db.query(`
        INSERT INTO submissions (task_id, student_id, score, max_score, attempt_number)
        VALUES (999, 999, 10, 10, 999)
        RETURNING id
      `);
      
      console.log('✅ Test insert successful:', testResult.rows[0].id);
      
      // Clean up test
      await db.query('DELETE FROM submissions WHERE id = $1', [testResult.rows[0].id]);
      console.log('✅ Test record cleaned up');
      
    } catch (testError) {
      console.warn('⚠️ Test insert failed (might be foreign key constraints):', testError.message);
    }
    
  } catch (error) {
    console.error('❌ Failed to initialize submissions table:', error);
    throw error;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  initializeSubmissionsTable().catch(console.error);
}

module.exports = { initializeSubmissionsTable };
