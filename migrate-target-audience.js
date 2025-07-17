const { Pool } = require('pg');

async function addTargetAudienceColumn() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Adding target_audience column to documents table...');
    
    // Add the column if it doesn't exist
    await pool.query(`
      ALTER TABLE documents 
      ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT NULL
    `);
    
    // Add constraint if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.constraint_column_usage 
          WHERE constraint_name = 'check_target_audience'
        ) THEN
          ALTER TABLE documents 
          ADD CONSTRAINT check_target_audience 
          CHECK (target_audience IS NULL OR target_audience IN ('everyone', 'student', 'staff'));
        END IF;
      END $$;
    `);
    
    // Add index if it doesn't exist
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_target_audience ON documents(target_audience)
    `);
    
    console.log('✅ Target audience column setup completed');
    
    // Verify the column exists
    const verification = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND column_name = 'target_audience'
    `);
    
    if (verification.rows.length > 0) {
      console.log('✅ Column verified:', verification.rows[0]);
    } else {
      console.log('❌ Column not found after creation');
    }
    
  } catch (error) {
    console.error('❌ Error adding target_audience column:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

module.exports = { addTargetAudienceColumn };

// Run if called directly
if (require.main === module) {
  addTargetAudienceColumn()
    .then(() => console.log('Migration completed'))
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
