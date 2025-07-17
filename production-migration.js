const { Pool } = require('pg');

async function addTargetAudienceColumnProduction() {
  console.log('🔧 Adding target_audience column to production database...');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Add the column
    console.log('Adding target_audience column...');
    await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT NULL`);
    
    // Add constraint
    console.log('Adding constraint...');
    await pool.query(`
      DO $$ 
      BEGIN
        BEGIN
          ALTER TABLE documents ADD CONSTRAINT check_target_audience 
          CHECK (target_audience IS NULL OR target_audience IN ('everyone', 'student', 'staff'));
        EXCEPTION
          WHEN duplicate_object THEN 
            NULL; -- Constraint already exists
        END;
      END $$;
    `);
    
    // Add index
    console.log('Adding index...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_target_audience ON documents(target_audience)`);
    
    // Verify
    console.log('Verifying column exists...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND column_name = 'target_audience'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ target_audience column verified:', result.rows[0]);
    } else {
      console.log('❌ Column not found');
    }
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
    console.log('Database connection closed');
  }
}

// Export for server.js to use
module.exports = { addTargetAudienceColumnProduction };

// If run directly, execute the migration
if (require.main === module) {
  addTargetAudienceColumnProduction()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}
