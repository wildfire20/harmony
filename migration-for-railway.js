const { Pool } = require('pg');

async function runMigration() {
  // Use Railway's DATABASE_URL environment variable
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable not found');
    process.exit(1);
  }

  const db = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false } // Required for Railway
  });

  try {
    console.log('🔄 Starting Railway database migration...');
    console.log('📍 Database URL:', databaseUrl.substring(0, 30) + '...');

    // Check current table structure
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'submissions'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Current submissions table columns:');
    columns.rows.forEach(col => {
      console.log(`  • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // Check if marking columns exist
    const hasTeacherComments = columns.rows.some(col => col.column_name === 'teacher_comments');
    const hasAnnotations = columns.rows.some(col => col.column_name === 'annotations');

    console.log(`\n🔍 Column status:`);
    console.log(`  • teacher_comments: ${hasTeacherComments ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`  • annotations: ${hasAnnotations ? '✅ EXISTS' : '❌ MISSING'}`);

    // Add missing columns
    if (!hasTeacherComments) {
      console.log('\n🔧 Adding teacher_comments column...');
      await db.query(`
        ALTER TABLE submissions 
        ADD COLUMN teacher_comments TEXT
      `);
      console.log('✅ teacher_comments column added successfully');
    }

    if (!hasAnnotations) {
      console.log('\n🔧 Adding annotations column...');
      await db.query(`
        ALTER TABLE submissions 
        ADD COLUMN annotations JSONB DEFAULT '[]'::jsonb
      `);
      console.log('✅ annotations column added successfully');
    }

    // Verify the additions
    const updatedColumns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('teacher_comments', 'annotations')
    `);

    console.log('\n✅ Migration completed successfully!');
    console.log('📋 New marking columns:');
    updatedColumns.rows.forEach(col => {
      console.log(`  • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // Test the columns with a simple query
    console.log('\n🧪 Testing marking columns...');
    const testResult = await db.query(`
      SELECT COUNT(*) as total_submissions,
             COUNT(teacher_comments) as with_comments,
             COUNT(annotations) as with_annotations
      FROM submissions
    `);
    
    const stats = testResult.rows[0];
    console.log(`📊 Submission statistics:`);
    console.log(`  • Total submissions: ${stats.total_submissions}`);
    console.log(`  • With teacher comments: ${stats.with_comments}`);
    console.log(`  • With annotations: ${stats.with_annotations}`);

    console.log('\n🎉 Database migration completed successfully!');
    console.log('🚀 The document marking system is now ready to use.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('💡 Full error:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Auto-run if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };
