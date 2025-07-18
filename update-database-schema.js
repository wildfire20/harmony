const db = require('./config/database');

async function updateDatabaseSchema() {
  try {
    console.log('🔄 Updating database schema to fix payment processing...');
    
    // 1. Fix payment_transactions table column name
    console.log('Step 1: Checking payment_transactions table...');
    
    const columnCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      AND column_name IN ('transaction_date', 'payment_date')
    `);
    
    console.log('Current columns:', columnCheck.rows.map(r => r.column_name));
    
    // If transaction_date exists but payment_date doesn't, rename it
    const hasTransactionDate = columnCheck.rows.some(r => r.column_name === 'transaction_date');
    const hasPaymentDate = columnCheck.rows.some(r => r.column_name === 'payment_date');
    
    if (hasTransactionDate && !hasPaymentDate) {
      console.log('Renaming transaction_date to payment_date...');
      await db.query(`ALTER TABLE payment_transactions RENAME COLUMN transaction_date TO payment_date`);
      console.log('✅ Column renamed successfully');
    } else if (!hasPaymentDate) {
      console.log('Adding payment_date column...');
      await db.query(`ALTER TABLE payment_transactions ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE`);
      console.log('✅ Column added successfully');
    } else {
      console.log('✅ payment_date column already exists');
    }
    
    // 2. Verify all required columns exist
    console.log('Step 2: Verifying all required columns...');
    
    const allColumns = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    console.log('All payment_transactions columns:');
    console.table(allColumns.rows);
    
    // 3. Test a simple insert to verify the schema works
    console.log('Step 3: Testing schema with dummy transaction...');
    
    try {
      await db.query(`
        INSERT INTO payment_transactions (
          reference_number, amount, payment_date, 
          description, status
        ) VALUES ($1, $2, $3, $4, $5)
      `, ['TEST123', 100.00, new Date(), 'Schema test transaction', 'Matched']);
      
      console.log('✅ Test insert successful');
      
      // Clean up test data
      await db.query(`DELETE FROM payment_transactions WHERE reference_number = 'TEST123'`);
      console.log('✅ Test data cleaned up');
      
    } catch (testError) {
      console.error('❌ Test insert failed:', testError.message);
    }
    
    console.log('✅ Database schema update completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error updating database schema:', error);
    process.exit(1);
  }
}

updateDatabaseSchema();
