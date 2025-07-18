const db = require('./config/database');
const fs = require('fs');
const path = require('path');

async function initializeInvoiceSchema() {
  try {
    console.log('🔄 Initializing invoice schema...');
    
    // Read the SQL schema file
    const schemaPath = path.join(__dirname, 'invoice-payment-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the schema
    await db.query(schema);
    
    console.log('✅ Invoice schema initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing invoice schema:', error);
    process.exit(1);
  }
}

initializeInvoiceSchema();
