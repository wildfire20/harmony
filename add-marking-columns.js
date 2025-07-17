const { Pool } = require('pg');

// Use environment DATABASE_URL or Railway URL
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:xMYmZJjVBIDCJUxmbVQtmNLqfvdPNJJO@junction.proxy.rlwy.net:57481/railway';

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addMarkingColumns() {
  try {
    console.log('🔄 Adding marking columns to submissions table...');

    // Check if columns already exist
    const checkColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('teacher_comments', 'annotations')
    `);

    const existingColumns = checkColumns.rows.map(row => row.column_name);

    if (!existingColumns.includes('teacher_comments')) {
      await db.query(`
        ALTER TABLE submissions 
        ADD COLUMN teacher_comments TEXT
      `);
      console.log('✅ Added teacher_comments column');
    } else {
      console.log('⚠️ teacher_comments column already exists');
    }

    if (!existingColumns.includes('annotations')) {
      await db.query(`
        ALTER TABLE submissions 
        ADD COLUMN annotations JSONB
      `);
      console.log('✅ Added annotations column');
    } else {
      console.log('⚠️ annotations column already exists');
    }

    // Verify the columns were added
    const verifyColumns = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('teacher_comments', 'annotations')
      ORDER BY column_name
    `);

    console.log('\n📋 Current marking columns:');
    verifyColumns.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });

    console.log('\n🎉 Marking columns migration completed successfully!');

  } catch (error) {
    console.error('❌ Error adding marking columns:', error);
    throw error;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  addMarkingColumns().catch(console.error);
}

module.exports = { addMarkingColumns };
