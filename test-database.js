// Simple database test to check if target_audience column exists
const { Pool } = require('pg');

async function testDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Testing database schema...');
    
    // Check if target_audience column exists
    const columnCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND column_name = 'target_audience'
    `);
    
    console.log('Target audience column check:', columnCheck.rows);
    
    // Test inserting a document with target_audience
    const testInsert = await pool.query(`
      INSERT INTO documents (title, description, document_type, file_name, file_size, 
                           uploaded_by, file_path, target_audience)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, target_audience
    `, [
      'Test Document',
      'Test Description', 
      'test',
      'test.pdf',
      1000,
      1, // admin user
      '/test/path',
      'everyone'
    ]);
    
    console.log('Test insert successful:', testInsert.rows[0]);
    
    // Clean up test document
    await pool.query('DELETE FROM documents WHERE id = $1', [testInsert.rows[0].id]);
    console.log('Test document cleaned up');
    
  } catch (error) {
    console.error('Database test failed:', error.message);
    console.error('Error details:', error);
  } finally {
    await pool.end();
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testDatabase();
}

module.exports = { testDatabase };
