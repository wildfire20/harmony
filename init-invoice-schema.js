const db = require('./config/database');
const fs = require('fs');
const path = require('path');

async function initializeInvoiceSchema() {
  try {
    console.log('🔄 Initializing invoice schema...');
    
    // First, fix the existing schema issues
    console.log('🔧 Fixing payment_transactions table...');
    
    // Check if payment_date column exists
    const paymentDateCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      AND column_name = 'payment_date'
    `);
    
    if (paymentDateCheck.rows.length === 0) {
      // Check if transaction_date exists to rename it
      const transactionDateCheck = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        AND column_name = 'transaction_date'
      `);
      
      if (transactionDateCheck.rows.length > 0) {
        console.log('Renaming transaction_date to payment_date...');
        await db.query('ALTER TABLE payment_transactions RENAME COLUMN transaction_date TO payment_date');
      } else {
        console.log('Adding payment_date column...');
        await db.query('ALTER TABLE payment_transactions ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE');
      }
    }
    
    console.log('🔧 Fixing payment_upload_logs table...');
    
    // Check if transactions_processed column exists
    const transactionsProcessedCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs' 
      AND column_name = 'transactions_processed'
    `);
    
    if (transactionsProcessedCheck.rows.length === 0) {
      console.log('Recreating payment_upload_logs table with correct schema...');
      
      // Drop and recreate the table with correct schema
      await db.query('DROP TABLE IF EXISTS payment_upload_logs CASCADE');
      
      await db.query(`
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
    }
    
    // Read and execute the original schema file
    const schemaPath = path.join(__dirname, 'invoice-payment-schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await db.query(schema);
    }
    
    console.log('✅ Invoice schema initialized and fixed successfully!');
    
    // Test the schema
    console.log('🧪 Testing schema...');
    await db.query(`
      INSERT INTO payment_upload_logs (
        filename, uploaded_by, transactions_processed, 
        matched_count, partial_count, overpaid_count,
        unmatched_count, duplicate_count, error_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, ['test-schema.csv', 1, 1, 1, 0, 0, 0, 0, 0]);
    
    // Clean up test data
    await db.query(`DELETE FROM payment_upload_logs WHERE filename = 'test-schema.csv'`);
    
    console.log('✅ Schema test successful!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing invoice schema:', error);
    process.exit(1);
  }
}

initializeInvoiceSchema();
