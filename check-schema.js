// Simple script to check database schema
const db = require('./config/database');

async function checkSchema() {
  try {
    console.log('Checking database schema...');
    
    const result = await db.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'announcements' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Announcements table columns:');
    console.table(result.rows);
    
    // Check if target_audience column exists
    const targetAudienceColumn = result.rows.find(row => row.column_name === 'target_audience');
    if (targetAudienceColumn) {
      console.log('✅ target_audience column exists');
    } else {
      console.log('❌ target_audience column missing - adding it now...');
      
      // Add the column
      await db.query(`
        ALTER TABLE announcements 
        ADD COLUMN target_audience VARCHAR(20) DEFAULT 'everyone' 
        CHECK (target_audience IN ('everyone', 'staff', 'students'));
      `);
      
      console.log('✅ target_audience column added successfully');
      
      // Update existing records
      await db.query(`
        UPDATE announcements 
        SET target_audience = 'everyone' 
        WHERE target_audience IS NULL;
      `);
      
      console.log('✅ Updated existing records with default target_audience');
    }
    
  } catch (error) {
    console.error('❌ Schema check failed:', error);
  }
}

checkSchema();
