const db = require('./config/database');
const fs = require('fs');
const path = require('path');

async function initTasksTables() {
  try {
    console.log('Initializing tasks tables...');
    
    // Read the SQL file
    const sqlFile = path.join(__dirname, 'init_tasks_tables.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Execute the SQL
    await db.query(sql);
    
    console.log('✅ Tasks tables initialized successfully');
    
    // Check if tables were created
    const tablesCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('tasks', 'submissions', 'quizzes')
      ORDER BY table_name
    `);
    
    console.log('Created tables:', tablesCheck.rows.map(row => row.table_name));
    
  } catch (error) {
    console.error('❌ Error initializing tasks tables:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

initTasksTables();
