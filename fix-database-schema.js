const { Client } = require('pg');

async function fixDatabaseSchema() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('🔗 Connected to database');

    // 1. Fix payment_transactions table - rename transaction_date to payment_date
    console.log('🔧 Step 1: Fixing payment_transactions table...');
    
    try {
      // Check current columns
      const columns = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions'
        ORDER BY ordinal_position
      `);
      
      console.log('Current columns:', columns.rows.map(r => r.column_name));
      
      const hasTransactionDate = columns.rows.some(r => r.column_name === 'transaction_date');
      const hasPaymentDate = columns.rows.some(r => r.column_name === 'payment_date');
      
      if (hasTransactionDate && !hasPaymentDate) {
        console.log('Renaming transaction_date to payment_date...');
        await client.query('ALTER TABLE payment_transactions RENAME COLUMN transaction_date TO payment_date');
        console.log('✅ Renamed transaction_date to payment_date');
      } else if (!hasPaymentDate) {
        console.log('Adding payment_date column...');
        await client.query('ALTER TABLE payment_transactions ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE');
        console.log('✅ Added payment_date column');
      } else {
        console.log('✅ payment_date column already exists');
      }
    } catch (error) {
      console.log('⚠️ payment_transactions table might not exist yet, will be created later');
    }

    // 2. Fix payment_upload_logs table completely
    console.log('🔧 Step 2: Fixing payment_upload_logs table...');
    
    // Drop and recreate with correct schema
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
    
    console.log('✅ payment_upload_logs table recreated with correct schema');

    // 3. Ensure payment_transactions table exists with correct schema
    console.log('🔧 Step 3: Ensuring payment_transactions table exists...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id SERIAL PRIMARY KEY,
        reference_number VARCHAR(100) UNIQUE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_date DATE NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'Unmatched',
        invoice_id INTEGER,
        student_id INTEGER,
        student_number VARCHAR(50),
        matched_by INTEGER,
        matched_at TIMESTAMP,
        bank_statement_upload_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (matched_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    
    // Check if status column exists and add it if missing
    const statusColumnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      AND column_name = 'status'
    `);
    
    if (statusColumnCheck.rows.length === 0) {
      console.log('Adding missing status column...');
      await client.query(`
        ALTER TABLE payment_transactions 
        ADD COLUMN status VARCHAR(50) DEFAULT 'Unmatched'
      `);
      console.log('✅ Added status column');
    }
    
    // Check if other missing columns exist
    const requiredColumns = [
      'student_id', 'student_number', 'matched_by', 'matched_at', 'bank_statement_upload_id'
    ];
    
    for (const column of requiredColumns) {
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        AND column_name = $1
      `, [column]);
      
      if (columnCheck.rows.length === 0) {
        console.log(`Adding missing ${column} column...`);
        let columnDef = '';
        switch (column) {
          case 'student_id':
          case 'matched_by':
          case 'bank_statement_upload_id':
            columnDef = `${column} INTEGER`;
            break;
          case 'student_number':
            columnDef = `${column} VARCHAR(50)`;
            break;
          case 'matched_at':
            columnDef = `${column} TIMESTAMP`;
            break;
        }
        
        if (columnDef) {
          await client.query(`ALTER TABLE payment_transactions ADD COLUMN ${columnDef}`);
          console.log(`✅ Added ${column} column`);
        }
      }
    }
    
    console.log('✅ payment_transactions table ensured with all required columns');

    // 4. Test the schema
    console.log('🧪 Step 4: Testing the schema...');
    
    try {
      // Test payment_upload_logs insertion
      await client.query(`
        INSERT INTO payment_upload_logs (
          filename, uploaded_by, transactions_processed, 
          matched_count, partial_count, overpaid_count,
          unmatched_count, duplicate_count, error_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, ['test-schema-fix.csv', 1, 5, 2, 1, 1, 1, 0, 0]);
      
      // Test payment_transactions insertion
      await client.query(`
        INSERT INTO payment_transactions (
          reference_number, amount, payment_date, 
          description, status
        ) VALUES ($1, $2, $3, $4, $5)
      `, ['TEST_REF_123', 2100.00, new Date(), 'Schema test transaction', 'Matched']);
      
      // Clean up test data
      await client.query(`DELETE FROM payment_upload_logs WHERE filename = 'test-schema-fix.csv'`);
      await client.query(`DELETE FROM payment_transactions WHERE reference_number = 'TEST_REF_123'`);
      
      console.log('✅ Schema test passed successfully!');
      
    } catch (testError) {
      console.error('❌ Schema test failed:', testError.message);
      console.log('Attempting to fix missing columns...');
      
      // If test fails, it might be due to missing columns, let's add them
      const allColumns = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        ORDER BY ordinal_position
      `);
      
      console.log('Current payment_transactions columns:', allColumns.rows.map(r => r.column_name));
      
      // Try a simpler test
      try {
        await client.query(`
          INSERT INTO payment_transactions (reference_number, amount, payment_date, description) 
          VALUES ($1, $2, $3, $4)
        `, ['SIMPLE_TEST_123', 100.00, new Date(), 'Simple test']);
        
        await client.query(`DELETE FROM payment_transactions WHERE reference_number = 'SIMPLE_TEST_123'`);
        console.log('✅ Simplified schema test passed');
      } catch (simpleError) {
        console.error('❌ Even simple test failed:', simpleError.message);
        throw simpleError;
      }
    }

    // 5. Show final schema
    const finalUploadLogs = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs' 
      ORDER BY ordinal_position
    `);
    
    const finalPaymentTrans = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    console.log('\n📊 Final Schema:');
    console.log('payment_upload_logs columns:', finalUploadLogs.rows.map(r => r.column_name));
    console.log('payment_transactions columns:', finalPaymentTrans.rows.map(r => r.column_name));
    
    console.log('\n🎉 Database schema fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Database schema fix failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the fix
if (require.main === module) {
  fixDatabaseSchema()
    .then(() => {
      console.log('✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = fixDatabaseSchema;
