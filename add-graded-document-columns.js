const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/harmony_learning',
});

async function addGradedDocumentColumns() {
  console.log('🔄 Adding graded document columns to submissions table...');
  
  try {
    // Check if columns already exist
    const checkColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('graded_document_s3_key', 'graded_document_s3_url', 'graded_document_original_name', 'graded_document_file_size', 'graded_document_file_type', 'graded_document_uploaded_at')
    `);

    const existingColumns = checkColumns.rows.map(row => row.column_name);
    console.log('Existing graded document columns:', existingColumns);

    const columnsToAdd = [
      { name: 'graded_document_s3_key', definition: 'graded_document_s3_key TEXT' },
      { name: 'graded_document_s3_url', definition: 'graded_document_s3_url TEXT' },
      { name: 'graded_document_original_name', definition: 'graded_document_original_name TEXT' },
      { name: 'graded_document_file_size', definition: 'graded_document_file_size INTEGER' },
      { name: 'graded_document_file_type', definition: 'graded_document_file_type TEXT' },
      { name: 'graded_document_uploaded_at', definition: 'graded_document_uploaded_at TIMESTAMP' }
    ];

    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        await pool.query(`ALTER TABLE submissions ADD COLUMN ${column.definition}`);
        console.log(`✅ Added column: ${column.name}`);
      } else {
        console.log(`⚠️  Column already exists: ${column.name}`);
      }
    }

    console.log('✅ Graded document columns added successfully');

  } catch (error) {
    console.error('❌ Error adding graded document columns:', error);
    throw error;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  addGradedDocumentColumns()
    .then(() => {
      console.log('✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addGradedDocumentColumns };
