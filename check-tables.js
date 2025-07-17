// Check table structure
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
  port: process.env.PGPORT || process.env.DB_PORT || 5432,
  database: process.env.PGDATABASE || process.env.DB_NAME || 'harmony_learning_db',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'password',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkTables() {
  try {
    console.log('📋 Checking database structure...\n');
    
    // Check classes table
    const classesResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'classes' 
      ORDER BY ordinal_position
    `);
    
    console.log('Classes table structure:');
    if (classesResult.rows.length === 0) {
      console.log('  ❌ Classes table does not exist');
    } else {
      classesResult.rows.forEach(row => {
        console.log(`  ${row.column_name}: ${row.data_type}`);
      });
    }
    
    // Check if description column exists in classes
    const hasDescription = classesResult.rows.some(row => row.column_name === 'description');
    
    if (!hasDescription && classesResult.rows.length > 0) {
      console.log('\n🔧 Adding missing description column to classes table...');
      await pool.query('ALTER TABLE classes ADD COLUMN description TEXT');
      console.log('✅ Description column added to classes table');
    }
    
    // Check teacher_assignments table
    const teacherAssignmentsResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'teacher_assignments' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nTeacher assignments table structure:');
    if (teacherAssignmentsResult.rows.length === 0) {
      console.log('  ❌ Teacher assignments table does not exist');
    } else {
      teacherAssignmentsResult.rows.forEach(row => {
        console.log(`  ${row.column_name}: ${row.data_type}`);
      });
    }
    
    // Check if subject column exists in teacher_assignments
    const hasSubject = teacherAssignmentsResult.rows.some(row => row.column_name === 'subject');
    
    if (!hasSubject && teacherAssignmentsResult.rows.length > 0) {
      console.log('\n🔧 Adding missing subject column to teacher_assignments table...');
      await pool.query('ALTER TABLE teacher_assignments ADD COLUMN subject VARCHAR(100)');
      console.log('✅ Subject column added to teacher_assignments table');
    }
    
    await pool.end();
    console.log('\n✅ Table structure check completed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

checkTables();
