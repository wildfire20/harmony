const { Client } = require('pg');

async function quickDatabaseFix() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('🔗 Connected to database for quick fix');

    // 1. Drop and recreate payment_transactions table completely
    console.log('🔧 Dropping and recreating payment_transactions table...');
    
    await client.query('DROP TABLE IF EXISTS payment_transactions CASCADE');
    
    await client.query(`
      CREATE TABLE payment_transactions (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER,
        student_id INTEGER,
        student_number VARCHAR(50),
        reference_number VARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_date DATE NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'Unmatched',
        matched_by INTEGER,
        matched_at TIMESTAMP,
        bank_statement_upload_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (matched_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    
    console.log('✅ payment_transactions table recreated successfully');

    // 2. Ensure payment_upload_logs table is correct
    console.log('🔧 Fixing payment_upload_logs table...');
    
    await client.query('DROP TABLE IF EXISTS payment_upload_logs CASCADE');
    
    await client.query(`
      CREATE TABLE payment_upload_logs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        uploaded_by INTEGER NOT NULL,
        transactions_processed INTEGER DEFAULT 0,
        matched_count INTEGER DEFAULT 0,
        partial_count INTEGER DEFAULT 0,
        overpaid_count INTEGER DEFAULT 0,
        unmatched_count INTEGER DEFAULT 0,
        duplicate_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    console.log('✅ payment_upload_logs table recreated successfully');

    // 3. Test both tables
    console.log('🧪 Testing tables...');
    
    // Test payment_transactions
    await client.query(`
      INSERT INTO payment_transactions (
        reference_number, amount, payment_date, description, status
      ) VALUES ($1, $2, $3, $4, $5)
    `, ['QUICK_TEST_123', 1000.00, new Date(), 'Quick test transaction', 'Matched']);
    
    // Test payment_upload_logs
    await client.query(`
      INSERT INTO payment_upload_logs (
        filename, uploaded_by, transactions_processed, matched_count
      ) VALUES ($1, $2, $3, $4)
    `, ['quick-test.csv', 1, 1, 1]);
    
    // Clean up
    await client.query(`DELETE FROM payment_transactions WHERE reference_number = 'QUICK_TEST_123'`);
    await client.query(`DELETE FROM payment_upload_logs WHERE filename = 'quick-test.csv'`);
    
    console.log('✅ All tables working correctly!');
    
    // 4. Show final schemas
    const ptColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    const pulColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs' 
      ORDER BY ordinal_position
    `);
    
    console.log('\n📊 Final Schemas:');
    console.log('payment_transactions:', ptColumns.rows.map(r => r.column_name));
    console.log('payment_upload_logs:', pulColumns.rows.map(r => r.column_name));
    
    console.log('\n🎉 Quick database fix completed! CSV processing should now work correctly.');
    
  } catch (error) {
    console.error('❌ Quick database fix failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the fix
if (require.main === module) {
  quickDatabaseFix()
    .then(() => {
      console.log('✅ Quick fix completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Quick fix failed:', error);
      process.exit(1);
    });
}

module.exports = quickDatabaseFix;
