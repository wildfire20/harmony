const { Pool } = require('pg');
require('dotenv').config();

// Use Railway public database URL for external access
const databaseUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
console.log('Using database URL:', databaseUrl ? databaseUrl.replace(/:[^:@]*@/, ':***@') : 'Not configured');

const db = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false } // Always use SSL for Railway
});

async function addMarkedDocumentColumns() {
  console.log('🔧 ADDING MARKED DOCUMENT COLUMNS TO SUBMISSIONS TABLE');
  console.log('==================================================');
  
  try {
    // Check current table structure
    console.log('Checking current submissions table structure...');
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'submissions' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('Current table structure:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // Check which columns need to be added
    const existingColumns = columns.rows.map(row => row.column_name);
    const newColumns = [
      'marked_document_s3_key',
      'marked_document_s3_url', 
      'marked_document_file_path',
      'marked_document_original_name',
      'marked_document_file_size',
      'marked_document_uploaded_at',
      'marked_document_uploaded_by',
      'teacher_comments',
      'annotations'
    ];

    let addedColumns = [];

    for (const columnName of newColumns) {
      if (!existingColumns.includes(columnName)) {
        console.log(`\n🔧 Adding column: ${columnName}`);
        
        let alterQuery = '';
        
        switch (columnName) {
          case 'marked_document_s3_key':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_s3_key VARCHAR(500)';
            break;
          case 'marked_document_s3_url':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_s3_url TEXT';
            break;
          case 'marked_document_file_path':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_file_path TEXT';
            break;
          case 'marked_document_original_name':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_original_name VARCHAR(255)';
            break;
          case 'marked_document_file_size':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_file_size BIGINT';
            break;
          case 'marked_document_uploaded_at':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_uploaded_at TIMESTAMP WITH TIME ZONE';
            break;
          case 'marked_document_uploaded_by':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN marked_document_uploaded_by INTEGER REFERENCES users(id)';
            break;
          case 'teacher_comments':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN teacher_comments TEXT';
            break;
          case 'annotations':
            alterQuery = 'ALTER TABLE submissions ADD COLUMN annotations JSONB DEFAULT \'[]\'::jsonb';
            break;
        }

        await db.query(alterQuery);
        addedColumns.push(columnName);
        console.log(`✅ Successfully added column: ${columnName}`);
      } else {
        console.log(`ℹ️  Column already exists: ${columnName}`);
      }
    }

    // Add indexes for better performance
    console.log('\n🔧 Adding indexes for better performance...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_submissions_marked_doc_s3_key ON submissions(marked_document_s3_key)',
      'CREATE INDEX IF NOT EXISTS idx_submissions_marked_doc_uploaded_by ON submissions(marked_document_uploaded_by)',
      'CREATE INDEX IF NOT EXISTS idx_submissions_teacher_comments ON submissions USING gin(to_tsvector(\'english\', teacher_comments))'
    ];

    for (const indexQuery of indexes) {
      try {
        await db.query(indexQuery);
        console.log('✅ Index created successfully');
      } catch (indexError) {
        console.log('ℹ️  Index already exists or failed:', indexError.message);
      }
    }

    // Test the new columns
    console.log('\n🧪 Testing new columns...');
    const testResult = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name LIKE '%marked_document%' OR column_name IN ('teacher_comments', 'annotations')
      ORDER BY column_name
    `);

    console.log('✅ New columns confirmed:');
    testResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    console.log(`✅ Added ${addedColumns.length} new columns`);
    console.log('✅ Added performance indexes');
    console.log('✅ Table structure verified');
    
    console.log('\n📝 New Features Available:');
    console.log('  - Teachers can upload marked documents to students');
    console.log('  - Students can download their marked documents');  
    console.log('  - Teachers can add detailed comments and annotations');
    console.log('  - Support for both S3 and local file storage');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the migration
addMarkedDocumentColumns();
