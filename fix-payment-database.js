#!/usr/bin/env node
/**
 * Database Migration: Fix Payment Transactions Table
 * Adds missing columns and ensures compatibility with enhanced payment system
 */

const db = require('./config/database');

async function fixPaymentTransactionsTable() {
  let client;
  try {
    console.log('🔧 Fixing payment_transactions table structure...');
    
    client = await db.connect();
    
    // Check current table structure
    const tableInfo = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Current payment_transactions columns:');
    tableInfo.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Add missing columns if they don't exist
    const currentColumns = tableInfo.rows.map(row => row.column_name);
    
    if (!currentColumns.includes('uploaded_by')) {
      console.log('➕ Adding uploaded_by column...');
      await client.query(`
        ALTER TABLE payment_transactions 
        ADD COLUMN uploaded_by INTEGER DEFAULT 1
      `);
    }
    
    if (!currentColumns.includes('description')) {
      console.log('➕ Adding description column...');
      await client.query(`
        ALTER TABLE payment_transactions 
        ADD COLUMN description TEXT
      `);
    }
    
    if (!currentColumns.includes('payment_date')) {
      console.log('➕ Adding payment_date column...');
      await client.query(`
        ALTER TABLE payment_transactions 
        ADD COLUMN payment_date DATE DEFAULT CURRENT_DATE
      `);
    }
    
    if (!currentColumns.includes('reference_number')) {
      console.log('➕ Adding reference_number column...');
      await client.query(`
        ALTER TABLE payment_transactions 
        ADD COLUMN reference_number VARCHAR(100)
      `);
    }
    
    // Ensure csv_column_mappings table exists
    console.log('📊 Ensuring csv_column_mappings table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS csv_column_mappings (
        id SERIAL PRIMARY KEY,
        mapping_name VARCHAR(100) NOT NULL UNIQUE,
        bank_name VARCHAR(50),
        reference_column VARCHAR(50),
        amount_column VARCHAR(50),
        date_column VARCHAR(50),
        description_column VARCHAR(50),
        debit_column VARCHAR(50),
        credit_column VARCHAR(50),
        is_default BOOLEAN DEFAULT FALSE,
        created_by INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used_at TIMESTAMP,
        use_count INTEGER DEFAULT 0
      )
    `);
    
    // Insert default mappings
    await client.query(`
      INSERT INTO csv_column_mappings (
        mapping_name, reference_column, amount_column, date_column, 
        description_column, is_default, created_by
      ) VALUES 
      ('Default (reference, amount, date)', 'reference', 'amount', 'date', 'description', TRUE, 1),
      ('Standard Bank Format', 'Description', 'Amount', 'Date', 'Description', FALSE, 1),
      ('FNB Format', 'Description', 'Credit Amount', 'Transaction Date', 'Description', FALSE, 1),
      ('ABSA Format', 'Reference', 'Amount', 'Transaction Date', 'Narrative', FALSE, 1),
      ('Capitec Format', 'Description', 'Credit', 'Transaction Date', 'Description', FALSE, 1)
      ON CONFLICT (mapping_name) DO NOTHING
    `);
    
    console.log('✅ Database migration completed successfully!');
    
    // Verify final structure
    const finalTableInfo = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Final payment_transactions structure:');
    finalTableInfo.rows.forEach(col => {
      console.log(`  ✅ ${col.column_name}: ${col.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Database migration failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Run migration
fixPaymentTransactionsTable()
  .then(() => {
    console.log('🎉 Database migration completed successfully!');
    console.log('✅ Enhanced payment system should now work properly');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error.message);
    process.exit(1);
  });
