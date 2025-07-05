const db = require('./config/database');

const initializeDocumentsTable = async () => {
  try {
    console.log('Initializing documents table...');
    
    // Create documents table
    await db.query(`
      CREATE TABLE IF NOT EXISTS documents (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          document_type VARCHAR(50) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_path VARCHAR(500) NOT NULL,
          file_size BIGINT NOT NULL,
          grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
          class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
          uploaded_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
          is_active BOOLEAN DEFAULT true,
          uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('Documents table created successfully');
    
    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_grade_class ON documents(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
      CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(is_active);
    `);
    
    console.log('Indexes created successfully');
    
    // Create update trigger
    await db.query(`
      CREATE OR REPLACE FUNCTION update_documents_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    await db.query(`
      CREATE TRIGGER IF NOT EXISTS update_documents_updated_at
          BEFORE UPDATE ON documents
          FOR EACH ROW
          EXECUTE FUNCTION update_documents_updated_at();
    `);
    
    console.log('Trigger created successfully');
    
    // Test the table
    const testResult = await db.query('SELECT COUNT(*) FROM documents');
    console.log('Documents table test successful. Current count:', testResult.rows[0].count);
    
    console.log('Documents table initialization completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('Error initializing documents table:', error);
    process.exit(1);
  }
};

// Run if called directly
if (require.main === module) {
  initializeDocumentsTable();
}

module.exports = initializeDocumentsTable;
