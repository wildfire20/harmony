const { Pool } = require('pg');
require('dotenv').config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkSchema() {
  try {
    console.log('CHECKING TABLE SCHEMAS');
    console.log('======================');
    
    // Check tasks table structure
    const tasksSchemaResult = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'tasks'
      ORDER BY ordinal_position
    `);
    
    console.log('TASKS table columns:');
    tasksSchemaResult.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Check submissions table structure
    const submissionsSchemaResult = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'submissions'
      ORDER BY ordinal_position
    `);
    
    console.log('\nSUBMISSIONS table columns:');
    submissionsSchemaResult.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    await db.end();
  } catch (error) {
    console.error('❌ Error checking schema:', error);
    await db.end();
  }
}

checkSchema();
