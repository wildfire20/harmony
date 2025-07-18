const db = require('./config/database');

async function debugPaymentSystem() {
  try {
    console.log('🔍 Debugging Payment System...\n');

    // 1. Check payment_transactions table schema
    console.log('1. Payment Transactions Table Schema:');
    const schemaResult = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    console.table(schemaResult.rows);

    // 2. Check invoices table schema (relevant columns)
    console.log('\n2. Invoices Table Schema (key columns):');
    const invoiceSchemaResult = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'invoices' 
      AND column_name IN ('id', 'amount_due', 'amount_paid', 'outstanding_balance', 'status', 'reference_number')
      ORDER BY ordinal_position
    `);
    console.table(invoiceSchemaResult.rows);

    // 3. Check current invoice states
    console.log('\n3. Current Invoice States:');
    const invoicesResult = await db.query(`
      SELECT reference_number, amount_due, amount_paid, outstanding_balance, status
      FROM invoices 
      ORDER BY id
      LIMIT 10
    `);
    console.table(invoicesResult.rows);

    // 4. Check payment transactions
    console.log('\n4. Existing Payment Transactions:');
    const transactionsResult = await db.query(`
      SELECT id, invoice_id, reference_number, amount, payment_date, status, description
      FROM payment_transactions 
      ORDER BY created_at DESC
      LIMIT 10
    `);
    console.table(transactionsResult.rows);

    // 5. Check for database trigger functionality
    console.log('\n5. Testing Invoice Balance Trigger:');
    const testUpdate = await db.query(`
      UPDATE invoices SET amount_paid = 100 WHERE reference_number = 'SUT0886' 
      RETURNING reference_number, amount_due, amount_paid, outstanding_balance, status
    `);
    if (testUpdate.rows.length > 0) {
      console.log('Trigger test result:', testUpdate.rows[0]);
      
      // Revert the test
      await db.query(`
        UPDATE invoices SET amount_paid = 0 WHERE reference_number = 'SUT0886'
      `);
      console.log('Test reverted successfully');
    } else {
      console.log('No invoice found with reference SUT0886 to test trigger');
    }

    // 6. Check for database connection errors
    console.log('\n6. Database Connection Status:');
    const connectionTest = await db.query('SELECT NOW() as current_time');
    console.log('Database connection working:', connectionTest.rows[0].current_time);

    console.log('\n✅ Debug complete!');

  } catch (error) {
    console.error('❌ Debug error:', error);
  } finally {
    process.exit(0);
  }
}

debugPaymentSystem();
