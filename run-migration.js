// Deploy migration to Railway database
const { Pool } = require('pg');
const fs = require('fs');

async function runMigration() {
  let pool;
  try {
    // Create connection to Railway database
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    console.log('🚀 Running target_audience migration on Railway database...');
    const sql = fs.readFileSync('./add_target_audience_to_documents.sql', 'utf8');
    await pool.query(sql);
    console.log('✅ Migration completed successfully');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

runMigration();
