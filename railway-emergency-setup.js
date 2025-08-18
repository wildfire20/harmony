#!/usr/bin/env node
/**
 * Railway Emergency Database Setup
 * Creates csv_column_mappings table and fixes deployment issues
 */

const db = require('./config/database');

async function emergencyDatabaseSetup() {
  let client;
  try {
    console.log('🚨 Railway Emergency Database Setup Starting...');
    
    // Get a client from the pool
    client = await db.connect();
    
    console.log('📊 Creating csv_column_mappings table...');
    
    // Drop and recreate table to ensure clean state
    await client.query('DROP TABLE IF EXISTS csv_column_mappings CASCADE');
    
    // Create table with all required fields
    await client.query(`
      CREATE TABLE csv_column_mappings (
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
    
    console.log('✅ Table created successfully');
    
    // Create indexes
    await client.query('CREATE INDEX idx_csv_mappings_name ON csv_column_mappings(mapping_name)');
    await client.query('CREATE INDEX idx_csv_mappings_bank ON csv_column_mappings(bank_name)');
    await client.query('CREATE INDEX idx_csv_mappings_used ON csv_column_mappings(last_used_at DESC)');
    
    console.log('✅ Indexes created');
    
    // Insert default mappings
    await client.query(`
      INSERT INTO csv_column_mappings (
        mapping_name, reference_column, amount_column, date_column, 
        description_column, is_default, created_by
      ) VALUES 
      ('Default (reference, amount, date)', 'reference', 'amount', 'date', 'description', TRUE, 1),
      ('Standard Bank Format', 'Description', 'Amount', 'Date', 'Description', FALSE, 1),
      ('FNB Format', 'Description', 'Credit Amount', 'Transaction Date', 'Description', FALSE, 1),
      ('ABSA Format', 'Reference', 'Amount', 'Transaction Date', 'Narrative', FALSE, 1)
    `);
    
    console.log('✅ Default mappings inserted');
    
    // Verify setup
    const result = await client.query('SELECT COUNT(*) FROM csv_column_mappings');
    console.log(`📊 Total mappings: ${result.rows[0].count}`);
    
    console.log('🎉 Emergency database setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Emergency setup failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Run setup
emergencyDatabaseSetup()
  .then(() => {
    console.log('✅ Setup complete - Railway deployment should work now');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Setup failed:', error.message);
    process.exit(1);
  });
