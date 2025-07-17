const { Pool } = require('pg');

// Use Railway public database URL for external access
const databaseUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
console.log('Using database URL:', databaseUrl.replace(/:[^:@]*@/, ':***@')); // Hide password

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false } // Always use SSL for Railway
});

async function addFilePathColumn() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Adding file_path column to submissions table...');
    
    // Add file_path column if it doesn't exist
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_path TEXT;`);
    console.log('✅ file_path column added successfully');
    
    // Verify the column exists
    const columnsCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('s3_key', 's3_url', 'original_file_name', 'file_path');
    `);
    console.log('📋 Submissions table columns:', columnsCheck.rows.map(r => r.column_name));
    
    console.log('🎉 File path column addition completed successfully!');
    
  } catch (error) {
    console.error('❌ Column addition failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addFilePathColumn()
  .then(() => {
    console.log('✅ Column addition script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Column addition script failed:', error);
    process.exit(1);
  });
