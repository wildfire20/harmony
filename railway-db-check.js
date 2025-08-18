#!/usr/bin/env node
/**
 * Railway Database Initialization Check
 * Verifies and creates enhanced payment system tables on Railway
 */

console.log('🔍 Checking Railway Database for Enhanced Payment System...');

const db = require('./config/database');

async function checkRailwayDatabase() {
  try {
    // Check if csv_column_mappings table exists
    console.log('📊 Checking for csv_column_mappings table...');
    
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'csv_column_mappings'
      );
    `);
    
    const tableExists = tableCheck.rows[0].exists;
    console.log(`📋 csv_column_mappings table exists: ${tableExists}`);
    
    if (!tableExists) {
      console.log('🔧 Creating csv_column_mappings table...');
      
      await db.query(`
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
          created_by INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          last_used_at TIMESTAMP,
          use_count INTEGER DEFAULT 0,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      
      // Create indexes
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_mapping_name ON csv_column_mappings(mapping_name);
      `);
      
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_bank_name ON csv_column_mappings(bank_name);
      `);
      
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_last_used ON csv_column_mappings(last_used_at DESC);
      `);
      
      console.log('✅ csv_column_mappings table created successfully');
      
      // Insert default mapping
      await db.query(`
        INSERT INTO csv_column_mappings (
          mapping_name, reference_column, amount_column, date_column, 
          description_column, is_default, created_by
        ) VALUES (
          'Default (reference, amount, date)', 'reference', 'amount', 
          'date', 'description', TRUE, 1
        ) ON CONFLICT (mapping_name) DO NOTHING;
      `);
      
      console.log('✅ Default mapping inserted');
    }
    
    // Check mapping count
    const countResult = await db.query('SELECT COUNT(*) FROM csv_column_mappings');
    const mappingCount = countResult.rows[0].count;
    console.log(`📊 Total column mappings: ${mappingCount}`);
    
    console.log('🎉 Railway database check completed successfully!');
    
    // Close database connection
    await db.end();
    
  } catch (error) {
    console.error('❌ Railway database check failed:');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('Details:', error.detail);
    process.exit(1);
  }
}

// Only run if called directly
if (require.main === module) {
  checkRailwayDatabase();
}

module.exports = { checkRailwayDatabase };
