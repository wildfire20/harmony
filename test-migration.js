// Simple test to verify our database migration
const { Pool } = require('pg');

async function testMigration() {
  console.log('🔄 Testing database migration...');
  
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:xMYmZJjVBIDCJUxmbVQtmNLqfvdPNJJO@junction.proxy.rlwy.net:57481/railway';
  
  const db = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // First, let's see the current structure of the submissions table
    const currentColumns = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      ORDER BY ordinal_position
    `);

    console.log('\n📋 Current submissions table structure:');
    currentColumns.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // Check if our marking columns exist
    const markingColumns = currentColumns.rows.filter(col => 
      col.column_name === 'teacher_comments' || col.column_name === 'annotations'
    );

    if (markingColumns.length === 0) {
      console.log('\n⚠️ Marking columns not found. Adding them now...');
      
      // Add teacher_comments column
      await db.query('ALTER TABLE submissions ADD COLUMN teacher_comments TEXT');
      console.log('✅ Added teacher_comments column');
      
      // Add annotations column
      await db.query('ALTER TABLE submissions ADD COLUMN annotations JSONB');
      console.log('✅ Added annotations column');
      
      console.log('\n🎉 Marking columns added successfully!');
    } else {
      console.log('\n✅ Marking columns already exist:');
      markingColumns.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type}`);
      });
    }

    // Test a simple query to make sure everything works
    const testQuery = await db.query('SELECT COUNT(*) as total_submissions FROM submissions');
    console.log(`\n📊 Total submissions in database: ${testQuery.rows[0].total_submissions}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await db.end();
    console.log('\n🔚 Database connection closed');
  }
}

if (require.main === module) {
  testMigration().catch(console.error);
}
