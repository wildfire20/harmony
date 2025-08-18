const db = require('./config/database');

async function initializeEnhancedPaymentSystem() {
  try {
    console.log('🚀 Initializing Enhanced Payment System...');

    // Create CSV column mappings table
    console.log('📊 Creating csv_column_mappings table...');
    await db.query(`
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
          created_by INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          last_used_at TIMESTAMP,
          use_count INTEGER DEFAULT 0,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_mapping_name ON csv_column_mappings(mapping_name)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_bank_name ON csv_column_mappings(bank_name)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_last_used ON csv_column_mappings(last_used_at DESC)
    `);

    console.log('✅ csv_column_mappings table created successfully');

    // Insert default mappings
    console.log('📝 Inserting default column mappings...');
    
    // Check if we have at least one admin user
    const adminCheck = await db.query(`
      SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1
    `);
    
    if (adminCheck.rows.length === 0) {
      console.log('⚠️ No admin users found, skipping default mappings insertion');
      return;
    }

    const adminUserId = adminCheck.rows[0].id;

    // Insert default mappings
    const defaultMappings = [
      {
        name: 'Default (reference, amount, date)',
        bank: null,
        reference: 'reference',
        amount: 'amount',
        date: 'date',
        description: 'description',
        debit: null,
        credit: null,
        isDefault: true
      },
      {
        name: 'Standard Bank Format',
        bank: 'Standard Bank',
        reference: 'Description',
        amount: 'Amount',
        date: 'Date',
        description: 'Description',
        debit: null,
        credit: null,
        isDefault: false
      },
      {
        name: 'FNB Bank Format',
        bank: 'FNB',
        reference: 'Description',
        amount: 'Amount',
        date: 'Date',
        description: 'Description',
        debit: null,
        credit: null,
        isDefault: false
      },
      {
        name: 'ABSA Bank Format',
        bank: 'ABSA',
        reference: 'Reference',
        amount: 'Amount',
        date: 'Transaction Date',
        description: 'Narrative',
        debit: null,
        credit: null,
        isDefault: false
      },
      {
        name: 'Nedbank Format',
        bank: 'Nedbank',
        reference: 'Reference',
        amount: null,
        date: 'Date',
        description: 'Description',
        debit: 'Debit',
        credit: 'Credit',
        isDefault: false
      },
      {
        name: 'Capitec Bank Format',
        bank: 'Capitec',
        reference: 'Description',
        amount: 'Amount',
        date: 'Date',
        description: 'Description',
        debit: null,
        credit: null,
        isDefault: false
      }
    ];

    for (const mapping of defaultMappings) {
      try {
        await db.query(`
          INSERT INTO csv_column_mappings (
            mapping_name, bank_name, reference_column, amount_column, 
            date_column, description_column, debit_column, credit_column, 
            is_default, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (mapping_name) DO NOTHING
        `, [
          mapping.name,
          mapping.bank,
          mapping.reference,
          mapping.amount,
          mapping.date,
          mapping.description,
          mapping.debit,
          mapping.credit,
          mapping.isDefault,
          adminUserId
        ]);
        
        console.log(`✅ Inserted mapping: ${mapping.name}`);
      } catch (error) {
        console.log(`⚠️ Mapping already exists: ${mapping.name}`);
      }
    }

    console.log('✅ Enhanced Payment System initialized successfully!');

    // Test the system by checking table contents
    const mappingsCount = await db.query('SELECT COUNT(*) FROM csv_column_mappings');
    console.log(`📊 Total column mappings: ${mappingsCount.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error initializing Enhanced Payment System:', error);
    throw error;
  }
}

// Run initialization if called directly
if (require.main === module) {
  initializeEnhancedPaymentSystem()
    .then(() => {
      console.log('🎉 Initialization complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Initialization failed:', error);
      process.exit(1);
    });
}

module.exports = { initializeEnhancedPaymentSystem };
