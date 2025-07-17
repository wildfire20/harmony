const { Pool } = require('pg');

async function addMarkingColumns() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:xMYmZJjVBIDCJUxmbVQtmNLqfvdPNJJO@junction.proxy.rlwy.net:57481/railway';
  
  const db = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Starting database migration...');

    // Check current table structure
    const columns = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'submissions'
      ORDER BY ordinal_position
    `);
    
    console.log('Current submissions table columns:');
    columns.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });

    // Check if marking columns exist
    const hasTeacherComments = columns.rows.some(col => col.column_name === 'teacher_comments');
    const hasAnnotations = columns.rows.some(col => col.column_name === 'annotations');

    if (!hasTeacherComments) {
      console.log('Adding teacher_comments column...');
      await db.query('ALTER TABLE submissions ADD COLUMN teacher_comments TEXT');
      console.log('✅ teacher_comments column added');
    } else {
      console.log('✅ teacher_comments column already exists');
    }

    if (!hasAnnotations) {
      console.log('Adding annotations column...');
      await db.query('ALTER TABLE submissions ADD COLUMN annotations JSONB');
      console.log('✅ annotations column added');
    } else {
      console.log('✅ annotations column already exists');
    }

    console.log('🎉 Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration error:', error);
  } finally {
    await db.end();
  }
}

addMarkingColumns();
