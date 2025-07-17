require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'harmony_learning_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

async function checkData() {
  try {
    const client = await pool.connect();
    
    // Check grades
    const gradesResult = await client.query('SELECT * FROM grades ORDER BY id');
    console.log('Grades in database:');
    console.log(gradesResult.rows);
    
    // Check students with grades
    const studentsResult = await client.query(`
      SELECT u.id, u.first_name, u.last_name, u.grade_id, g.name as grade_name 
      FROM users u 
      LEFT JOIN grades g ON u.grade_id = g.id 
      WHERE u.role = 'student' 
      ORDER BY u.id LIMIT 5
    `);
    console.log('\nStudents with grades:');
    console.log(studentsResult.rows);
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkData();
