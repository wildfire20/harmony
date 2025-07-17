const { Pool } = require('pg');
require('dotenv').config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkDatabase() {
  try {
    console.log('DATABASE CONNECTION CHECK');
    console.log('=========================');
    console.log('Database URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
    
    // Test basic connection
    const result = await db.query('SELECT NOW()');
    console.log('✅ Database connection successful');
    console.log('Current time:', result.rows[0].now);
    
    // Check if tables exist
    const tablesResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('\nDATABASE TABLES:');
    console.log('================');
    tablesResult.rows.forEach(table => {
      console.log('- ' + table.table_name);
    });
    
    // Check row counts for main tables
    console.log('\nTABLE ROW COUNTS:');
    console.log('=================');
    
    const tables = ['users', 'tasks', 'submissions', 'teacher_assignments'];
    for (const table of tables) {
      try {
        const countResult = await db.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`- ${table}: ${countResult.rows[0].count} rows`);
      } catch (error) {
        console.log(`- ${table}: ERROR - ${error.message}`);
      }
    }
    
    // Check users
    console.log('\nUSERS CHECK:');
    console.log('============');
    const usersResult = await db.query('SELECT id, first_name, last_name, role FROM users LIMIT 5');
    usersResult.rows.forEach(user => {
      console.log(`- ${user.first_name} ${user.last_name} (${user.role}) - ID: ${user.id}`);
    });
    
    await db.end();
  } catch (error) {
    console.error('❌ Database error:', error.message);
    await db.end();
  }
}

checkDatabase();
