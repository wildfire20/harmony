const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Use Railway public database URL for external access
const databaseUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
console.log('Using database URL:', databaseUrl.replace(/:[^:@]*@/, ':***@')); // Hide password

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false } // Always use SSL for Railway
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting Railway database migration...');
    
    // Read and execute S3 migration for documents
    console.log('📄 Running documents S3 migration...');
    const documentsS3Migration = fs.readFileSync(
      path.join(__dirname, 'migrations', 'add_s3_support.sql'), 
      'utf8'
    );
    await client.query(documentsS3Migration);
    console.log('✅ Documents S3 migration completed');
    
    // Read and execute S3 migration for submissions
    console.log('📋 Running submissions S3 migration...');
    const submissionsS3Migration = fs.readFileSync(
      path.join(__dirname, 'migrations', 'add_s3_support_submissions.sql'), 
      'utf8'
    );
    await client.query(submissionsS3Migration);
    console.log('✅ Submissions S3 migration completed');
    
    // Verify the new columns exist
    console.log('🔍 Verifying migration...');
    
    const documentsCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      AND column_name IN ('s3_key', 's3_url', 'original_file_name');
    `);
    console.log('📄 Documents table new columns:', documentsCheck.rows.map(r => r.column_name));
    
    const submissionsCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('s3_key', 's3_url', 'original_file_name');
    `);
    console.log('📋 Submissions table new columns:', submissionsCheck.rows.map(r => r.column_name));
    
    console.log('🎉 Railway database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });
