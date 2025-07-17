// Railway environment DATABASE_URL configuration
const { Pool } = require('pg');

// Use Railway DATABASE_URL or local fallback
const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/harmony';

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Add query method to match interface
db.query = db.query.bind(db);

async function comprehensiveDatabaseDiagnosis() {
  console.log('🔍 COMPREHENSIVE DATABASE DIAGNOSIS');
  console.log('=====================================');
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Database URL:', databaseUrl.substring(0, 50) + '...');
  
  try {
    // 1. Test database connection
    console.log('\n1. Testing database connection...');
    const connectionTest = await db.query('SELECT NOW() as current_time, version() as db_version');
    console.log('✅ Database connected successfully');
    console.log('📅 Current time:', connectionTest.rows[0].current_time);
    console.log('💾 Database version:', connectionTest.rows[0].db_version.substring(0, 50) + '...');

    // 2. Check if submissions table exists
    console.log('\n2. Checking submissions table structure...');
    const tableExists = await db.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      ORDER BY ordinal_position
    `);
    
    if (tableExists.rows.length === 0) {
      console.log('❌ SUBMISSIONS TABLE DOES NOT EXIST!');
      console.log('🔧 Creating submissions table...');
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS submissions (
          id SERIAL PRIMARY KEY,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          quiz_answers JSONB,
          score DECIMAL(5,2) DEFAULT 0,
          max_score DECIMAL(5,2) DEFAULT 0,
          status VARCHAR(20) DEFAULT 'submitted',
          attempt_number INTEGER DEFAULT 1,
          time_taken INTEGER,
          submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          graded_at TIMESTAMP WITH TIME ZONE,
          graded_by INTEGER REFERENCES users(id),
          feedback TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Add indexes for better performance
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_submissions_task_id ON submissions(task_id);
        CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON submissions(student_id);
        CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_unique_attempt 
        ON submissions(task_id, student_id, attempt_number);
      `);
      
      console.log('✅ Submissions table created successfully');
    } else {
      console.log('✅ Submissions table exists with columns:');
      tableExists.rows.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
    }

    // 3. Check tasks table for quiz tasks
    console.log('\n3. Checking quiz tasks...');
    const quizTasks = await db.query(`
      SELECT t.id, t.title, t.task_type, t.is_active, 
             COUNT(q.id) as has_quiz_data,
             COUNT(s.id) as submission_count
      FROM tasks t 
      LEFT JOIN quizzes q ON t.id = q.task_id
      LEFT JOIN submissions s ON t.id = s.task_id
      WHERE t.task_type = 'quiz' AND t.is_active = true
      GROUP BY t.id, t.title, t.task_type, t.is_active
      ORDER BY t.created_at DESC
      LIMIT 10
    `);
    
    console.log(`📊 Found ${quizTasks.rows.length} active quiz tasks:`);
    quizTasks.rows.forEach(task => {
      console.log(`   - Task ${task.id}: "${task.title}" (Quiz data: ${task.has_quiz_data ? 'Yes' : 'No'}, Submissions: ${task.submission_count})`);
    });

    // 4. Check user accounts
    console.log('\n4. Checking test user accounts...');
    const testUsers = await db.query(`
      SELECT id, email, role, grade_id, class_id, is_active
      FROM users 
      WHERE email IN ('SUT123', 'ove@harmonylearning.edu')
      OR student_number = 'SUT123'
    `);
    
    console.log(`👥 Found ${testUsers.rows.length} test users:`);
    testUsers.rows.forEach(user => {
      console.log(`   - ${user.email} (${user.role}) - Grade: ${user.grade_id}, Class: ${user.class_id}, Active: ${user.is_active}`);
    });

    // 5. Test quiz submission simulation
    console.log('\n5. Testing quiz submission process...');
    
    if (quizTasks.rows.length > 0 && testUsers.rows.length > 0) {
      const testTask = quizTasks.rows[0];
      const testStudent = testUsers.rows.find(u => u.role === 'student') || testUsers.rows[0];
      
      console.log(`🧪 Simulating submission for Task ${testTask.id} by User ${testStudent.id}...`);
      
      try {
        // Try to get quiz details
        const quizDetails = await db.query(`
          SELECT q.*, t.title, t.max_points 
          FROM quizzes q 
          JOIN tasks t ON q.task_id = t.id 
          WHERE q.task_id = $1
        `, [testTask.id]);
        
        if (quizDetails.rows.length === 0) {
          console.log('❌ No quiz data found for this task');
        } else {
          console.log('✅ Quiz data retrieved successfully');
          
          // Test submission insertion
          const testSubmission = {
            task_id: testTask.id,
            student_id: testStudent.id,
            quiz_answers: JSON.stringify([{
              question_id: 1,
              student_answer: "test answer",
              is_correct: true,
              points_earned: 1
            }]),
            score: 1,
            max_score: 1,
            status: 'graded',
            attempt_number: 999, // Use unique attempt number for testing
            time_taken: 60
          };
          
          console.log('📝 Testing submission insertion...');
          const insertResult = await db.query(`
            INSERT INTO submissions (
              task_id, student_id, quiz_answers, score, max_score, 
              status, attempt_number, time_taken
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, submitted_at
          `, [
            testSubmission.task_id,
            testSubmission.student_id,
            testSubmission.quiz_answers,
            testSubmission.score,
            testSubmission.max_score,
            testSubmission.status,
            testSubmission.attempt_number,
            testSubmission.time_taken
          ]);
          
          console.log('✅ Test submission inserted successfully:', insertResult.rows[0]);
          
          // Clean up test submission
          await db.query('DELETE FROM submissions WHERE id = $1', [insertResult.rows[0].id]);
          console.log('🧹 Test submission cleaned up');
        }
        
      } catch (simError) {
        console.error('❌ Simulation error:', {
          message: simError.message,
          code: simError.code,
          detail: simError.detail,
          constraint: simError.constraint
        });
      }
    } else {
      console.log('⚠️  No quiz tasks or test users found for simulation');
    }

    // 6. Check database constraints
    console.log('\n6. Checking database constraints...');
    const constraints = await db.query(`
      SELECT conname, contype, conrelid::regclass as table_name
      FROM pg_constraint 
      WHERE conrelid IN (
        SELECT oid FROM pg_class WHERE relname IN ('submissions', 'tasks', 'quizzes', 'users')
      )
      ORDER BY table_name, conname
    `);
    
    console.log('🔒 Database constraints:');
    constraints.rows.forEach(constraint => {
      const type = {
        'p': 'PRIMARY KEY',
        'f': 'FOREIGN KEY',
        'u': 'UNIQUE',
        'c': 'CHECK'
      }[constraint.contype] || constraint.contype;
      console.log(`   - ${constraint.table_name}.${constraint.conname}: ${type}`);
    });

    console.log('\n✅ DIAGNOSIS COMPLETE');
    console.log('===================');

  } catch (error) {
    console.error('❌ DIAGNOSIS FAILED:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Set Railway production DATABASE_URL for testing
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:xMYmZJjVBIDCJUxmbVQtmNLqfvdPNJJO@junction.proxy.rlwy.net:57481/railway';
}

// Run diagnosis
comprehensiveDatabaseDiagnosis().catch(console.error);
