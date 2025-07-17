const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const resetDatabase = async () => {
  const client = await pool.connect();
  
  try {
    console.log('🗑️ Dropping all tables...');
    
    // Drop all tables in the correct order (reverse of dependencies)
    await client.query('DROP TABLE IF EXISTS documents CASCADE');
    await client.query('DROP TABLE IF EXISTS teacher_assignments CASCADE');
    await client.query('DROP TABLE IF EXISTS submissions CASCADE');
    await client.query('DROP TABLE IF EXISTS quiz_questions CASCADE');
    await client.query('DROP TABLE IF EXISTS quizzes CASCADE');
    await client.query('DROP TABLE IF EXISTS tasks CASCADE');
    await client.query('DROP TABLE IF EXISTS announcements CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    await client.query('DROP TABLE IF EXISTS classes CASCADE');
    await client.query('DROP TABLE IF EXISTS grades CASCADE');
    
    console.log('✅ All tables dropped successfully');
    console.log('📝 Database is now clean and ready for initialization');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
  } finally {
    client.release();
    pool.end();
  }
};

resetDatabase();
