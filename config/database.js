const { Pool } = require('pg');

// Railway provides PG* variables, but we also support DB* for other platforms
const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
  port: process.env.PGPORT || process.env.DB_PORT || 5432,
  database: process.env.PGDATABASE || process.env.DB_NAME || 'harmony_learning_db',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'password',
  // Railway specific SSL configuration
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Database initialization and table creation
const initialize = async () => {
  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully');

    // Create tables
    await createTables();
    console.log('✅ Database tables initialized');

    // Insert default data
    await insertDefaultData();
    console.log('✅ Default data inserted');

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
};

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        student_number VARCHAR(20) UNIQUE,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'super_admin')),
        grade_id INTEGER,
        class_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Grades table
    await client.query(`
      CREATE TABLE IF NOT EXISTS grades (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Classes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, grade_id)
      )
    `);

    // Tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        instructions TEXT,
        due_date TIMESTAMP,
        max_points INTEGER DEFAULT 100,
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        task_type VARCHAR(20) DEFAULT 'assignment' CHECK (task_type IN ('assignment', 'quiz')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Quizzes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        questions JSONB NOT NULL,
        time_limit INTEGER, -- in minutes
        attempts_allowed INTEGER DEFAULT 1,
        show_results BOOLEAN DEFAULT true,
        randomize_questions BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Announcements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Submissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT,
        file_path VARCHAR(500),
        quiz_answers JSONB,
        score INTEGER,
        max_score INTEGER,
        feedback TEXT,
        status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'graded', 'returned')),
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        graded_at TIMESTAMP,
        graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        attempt_number INTEGER DEFAULT 1,
        UNIQUE(task_id, student_id, attempt_number)
      )
    `);

    // Teacher assignments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_assignments (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(teacher_id, grade_id, class_id)
      )
    `);

    // Documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('timetable', 'past_paper', 'syllabus', 'assignment', 'notes', 'handbook', 'form', 'other')),
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER NOT NULL,
        grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add foreign key constraints if they don't exist
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users 
        ADD CONSTRAINT fk_users_grade 
        FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users 
        ADD CONSTRAINT fk_users_class 
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_student_number ON users(student_number);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_grade_class ON users(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_grade_class ON tasks(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_submissions_task_student ON submissions(task_id, student_id);
      CREATE INDEX IF NOT EXISTS idx_announcements_grade_class ON announcements(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_documents_grade_class ON documents(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const insertDefaultData = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Check if default data already exists
    const existingGrades = await client.query('SELECT COUNT(*) FROM grades');
    if (parseInt(existingGrades.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return; // Default data already exists
    }

    // Insert default grades
    await client.query(`
      INSERT INTO grades (name, description) VALUES
      ('Grade 1', 'First Grade'),
      ('Grade 2', 'Second Grade'),
      ('Grade 3', 'Third Grade'),
      ('Grade 4', 'Fourth Grade'),
      ('Grade 5', 'Fifth Grade'),
      ('Grade 6', 'Sixth Grade'),
      ('Grade 7', 'Seventh Grade'),
      ('Grade 8', 'Eighth Grade'),
      ('Grade 9', 'Ninth Grade'),
      ('Grade 10', 'Tenth Grade'),
      ('Grade 11', 'Eleventh Grade'),
      ('Grade 12', 'Twelfth Grade')
    `);

    // Insert default classes for each grade
    const grades = await client.query('SELECT id, name FROM grades ORDER BY id');
    
    for (const grade of grades.rows) {
      await client.query(`
        INSERT INTO classes (name, grade_id) VALUES
        ('Class A', $1),
        ('Class B', $1),
        ('Class C', $1)
      `, [grade.id]);
    }

    // Insert default super admin user
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    await client.query(`
      INSERT INTO users (email, password, first_name, last_name, role) VALUES
      ('admin@harmonylearning.edu', $1, 'System', 'Administrator', 'super_admin')
    `, [hashedPassword]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Export pool for use in other modules
module.exports = {
  pool,
  initialize,
  query: (text, params) => pool.query(text, params)
};
