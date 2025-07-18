const db = require('./config/database');
const fs = require('fs');
const path = require('path');

async function fixPaymentDateColumn() {
  try {
    console.log('🔄 Fixing payment_date column in payment_transactions table...');
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'fix-payment-date-column.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await db.query(migration);
    
    console.log('✅ Payment date column migration completed successfully!');
    
    // Test the column exists
    const testResult = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      AND column_name = 'payment_date'
    `);
    
    if (testResult.rows.length > 0) {
      console.log('✅ payment_date column confirmed to exist:', testResult.rows[0]);
    } else {
      console.log('❌ payment_date column still not found');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing payment_date column:', error);
    process.exit(1);
  }
}

fixPaymentDateColumn();
