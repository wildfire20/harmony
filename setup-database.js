// Comprehensive Database Setup Script for Harmony Learning System
// This script will set up the entire database with enhanced quiz functionality

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Database connection configuration
const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
  port: process.env.PGPORT || process.env.DB_PORT || 5432,
  database: process.env.PGDATABASE || process.env.DB_NAME || 'harmony_learning_db',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'password',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

console.log('🚀 Starting Harmony Learning System Database Setup...\n');

// Main setup function
async function setupDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('📊 Testing database connection...');
    await client.query('SELECT NOW()');
    console.log('✅ Database connection successful!\n');

    console.log('🏗️  Setting up database schema...');
    await setupSchema(client);
    
    console.log('📋 Setting up enhanced quiz system...');
    await setupEnhancedQuizSystem(client);
    
    console.log('📝 Inserting default data...');
    await insertDefaultData(client);
    
    console.log('🔍 Verifying setup...');
    await verifySetup(client);
    
    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n📊 Summary:');
    console.log('✅ All tables created');
    console.log('✅ Enhanced quiz system enabled');
    console.log('✅ Default data inserted');
    console.log('✅ Indexes and views created');
    console.log('\n🚀 Your Harmony Learning System is ready to use!');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Setup basic database schema
async function setupSchema(client) {
  await client.query('BEGIN');
  
  try {
    // Create grades table
    await client.query(`
      CREATE TABLE IF NOT EXISTS grades (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Grades table created');

    // Create classes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, grade_id)
      )
    `);
    console.log('  ✅ Classes table created');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        student_number VARCHAR(20) UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'super_admin')),
        grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Users table created');

    // Create teacher_assignments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_assignments (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        subject VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(teacher_id, grade_id, class_id)
      )
    `);
    console.log('  ✅ Teacher assignments table created');

    // Create tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        instructions TEXT,
        due_date TIMESTAMP,
        max_points INTEGER DEFAULT 100,
        task_type VARCHAR(50) DEFAULT 'assignment' CHECK (task_type IN ('assignment', 'quiz')),
        submission_type VARCHAR(50) DEFAULT 'online' CHECK (submission_type IN ('online', 'physical')),
        attachment_s3_key VARCHAR(500),
        attachment_s3_url TEXT,
        attachment_original_name VARCHAR(255),
        attachment_file_size BIGINT,
        attachment_file_type VARCHAR(100),
        grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Tasks table created');

    // Create submissions table with enhanced quiz support
    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT,
        file_path VARCHAR(500),
        s3_key VARCHAR(500),
        s3_url TEXT,
        original_file_name VARCHAR(255),
        file_size BIGINT,
        file_type VARCHAR(100),
        quiz_answers JSONB,
        score DECIMAL(5,2),
        max_score DECIMAL(5,2),
        feedback TEXT,
        status VARCHAR(50) DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned', 'pending_review')),
        attempt_number INTEGER DEFAULT 1,
        time_taken INTEGER, -- in seconds
        graded_by INTEGER REFERENCES users(id),
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        graded_at TIMESTAMP,
        UNIQUE(task_id, student_id, attempt_number)
      )
    `);
    console.log('  ✅ Submissions table created');

    // Create quizzes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        questions JSONB NOT NULL,
        time_limit INTEGER, -- in minutes
        attempts_allowed INTEGER DEFAULT 1,
        show_results BOOLEAN DEFAULT true,
        randomize_questions BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Quizzes table created');

    // Create announcements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        target_audience VARCHAR(20) DEFAULT 'all' CHECK (target_audience IN ('all', 'students', 'teachers', 'admins')),
        grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Announcements table created');

    // Create documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(100),
        file_size BIGINT,
        s3_key VARCHAR(500) NOT NULL,
        s3_url TEXT,
        target_audience VARCHAR(20) DEFAULT 'all' CHECK (target_audience IN ('all', 'students', 'teachers', 'admins')),
        grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Documents table created');

    await client.query('COMMIT');
    console.log('  ✅ Basic schema setup completed\n');
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error('Schema setup failed: ' + error.message);
  }
}

// Setup enhanced quiz system with views and functions
async function setupEnhancedQuizSystem(client) {
  try {
    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_grade_class ON tasks(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
      CREATE INDEX IF NOT EXISTS idx_submissions_task_student ON submissions(task_id, student_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
      CREATE INDEX IF NOT EXISTS idx_submissions_attempt ON submissions(task_id, student_id, attempt_number);
      CREATE INDEX IF NOT EXISTS idx_quizzes_task ON quizzes(task_id);
    `);
    console.log('  ✅ Performance indexes created');

    // Create quiz overview view
    await client.query(`
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
      WHERE t.is_active = true AND t.task_type = 'quiz'
    `);
    console.log('  ✅ Quiz overview view created');

    // Create student quiz status view
    await client.query(`
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
        AND u.class_id = t.class_id
    `);
    console.log('  ✅ Student quiz status view created');

    // Create trigger function for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Apply triggers
    await client.query(`
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
    `);
    console.log('  ✅ Database triggers created');

    console.log('  ✅ Enhanced quiz system setup completed\n');
    
  } catch (error) {
    throw new Error('Enhanced quiz system setup failed: ' + error.message);
  }
}

// Insert default data
async function insertDefaultData(client) {
  try {
    // Insert default grades
    await client.query(`
      INSERT INTO grades (name, description) VALUES
      ('Grade 1', 'First grade students'),
      ('Grade 2', 'Second grade students'),
      ('Grade 3', 'Third grade students'),
      ('Grade 4', 'Fourth grade students'),
      ('Grade 5', 'Fifth grade students')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('  ✅ Default grades inserted');

    // Insert default classes
    await client.query(`
      INSERT INTO classes (name, grade_id, description) VALUES
      ('Class A', 1, 'Grade 1 Class A'),
      ('Class B', 1, 'Grade 1 Class B'),
      ('Class A', 2, 'Grade 2 Class A'),
      ('Class B', 2, 'Grade 2 Class B'),
      ('Class A', 3, 'Grade 3 Class A'),
      ('Class B', 3, 'Grade 3 Class B'),
      ('Class A', 4, 'Grade 4 Class A'),
      ('Class B', 4, 'Grade 4 Class B'),
      ('Class A', 5, 'Grade 5 Class A'),
      ('Class B', 5, 'Grade 5 Class B')
      ON CONFLICT (name, grade_id) DO NOTHING
    `);
    console.log('  ✅ Default classes inserted');

    // Insert default admin user (password: admin123)
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    await client.query(`
      INSERT INTO users (
        email, password, first_name, last_name, role, student_number
      ) VALUES (
        'admin@harmony.edu', $1, 'System', 'Administrator', 'super_admin', 'ADMIN001'
      ) ON CONFLICT (email) DO NOTHING
    `, [hashedPassword]);
    console.log('  ✅ Default admin user created (email: admin@harmony.edu, password: admin123)');

    // Insert sample teacher
    const teacherPassword = await bcrypt.hash('teacher123', 12);
    await client.query(`
      INSERT INTO users (
        email, password, first_name, last_name, role, student_number
      ) VALUES (
        'teacher@harmony.edu', $1, 'Sample', 'Teacher', 'teacher', 'TEACHER001'
      ) ON CONFLICT (email) DO NOTHING
    `, [teacherPassword]);
    console.log('  ✅ Sample teacher created (email: teacher@harmony.edu, password: teacher123)');

    // Assign teacher to classes
    await client.query(`
      INSERT INTO teacher_assignments (teacher_id, grade_id, class_id, subject)
      SELECT u.id, 1, 1, 'Mathematics'
      FROM users u 
      WHERE u.email = 'teacher@harmony.edu'
      ON CONFLICT (teacher_id, grade_id, class_id) DO NOTHING
    `);

    // Insert sample student
    const studentPassword = await bcrypt.hash('student123', 12);
    await client.query(`
      INSERT INTO users (
        email, password, first_name, last_name, role, grade_id, class_id, student_number
      ) VALUES (
        'student@harmony.edu', $1, 'Sample', 'Student', 'student', 1, 1, 'STU001'
      ) ON CONFLICT (email) DO NOTHING
    `, [studentPassword]);
    console.log('  ✅ Sample student created (email: student@harmony.edu, password: student123)');

    console.log('  ✅ Default data insertion completed\n');
    
  } catch (error) {
    throw new Error('Default data insertion failed: ' + error.message);
  }
}

// Verify setup
async function verifySetup(client) {
  try {
    // Check tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('  📋 Tables created:', tablesResult.rows.map(r => r.table_name).join(', '));

    // Check views
    const viewsResult = await client.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public'
    `);
    console.log('  👁️  Views created:', viewsResult.rows.map(r => r.table_name).join(', '));

    // Check users
    const usersResult = await client.query(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role
    `);
    console.log('  👥 Users by role:');
    usersResult.rows.forEach(row => {
      console.log(`    ${row.role}: ${row.count}`);
    });

    // Check grades and classes
    const gradesResult = await client.query('SELECT COUNT(*) FROM grades');
    const classesResult = await client.query('SELECT COUNT(*) FROM classes');
    console.log(`  🎓 Grades: ${gradesResult.rows[0].count}, Classes: ${classesResult.rows[0].count}`);

    console.log('  ✅ Verification completed\n');
    
  } catch (error) {
    console.warn('  ⚠️  Verification partially failed:', error.message);
  }
}

// Run the setup
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log('\n🎯 Next steps:');
      console.log('1. Start your server: npm start');
      console.log('2. Login with admin credentials:');
      console.log('   Email: admin@harmony.edu');
      console.log('   Password: admin123');
      console.log('3. Test quiz functionality with sample accounts');
      console.log('\n🚀 Happy learning!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = { setupDatabase };
