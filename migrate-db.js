// Database migration script to run during Railway deployment
const { Pool } = require('pg');

async function migrateDatabase() {
  console.log('🔧 Starting database migration...');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Check if target_audience column exists
    console.log('Checking if target_audience column exists...');
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND column_name = 'target_audience'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('❌ target_audience column missing - adding it now...');
      
      // Add the column
      await pool.query(`ALTER TABLE documents ADD COLUMN target_audience VARCHAR(20) DEFAULT NULL`);
      console.log('✅ Added target_audience column');
      
      // Add constraint
      await pool.query(`
        ALTER TABLE documents ADD CONSTRAINT check_target_audience 
        CHECK (target_audience IS NULL OR target_audience IN ('everyone', 'student', 'staff'))
      `);
      console.log('✅ Added constraint');
      
      // Add index
      await pool.query(`CREATE INDEX idx_documents_target_audience ON documents(target_audience)`);
      console.log('✅ Added index');
      
    } else {
      console.log('✅ target_audience column already exists');
    }
    
    console.log('✅ Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
    console.log('Database connection closed');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateDatabase()
    .then(() => {
      console.log('Migration script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateDatabase };
