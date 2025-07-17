const db = require('./config/database');

async function updateDatabase() {
  try {
    console.log('Connecting to database...');

    // Add target_audience column if it doesn't exist
    await db.query(`
      ALTER TABLE announcements 
      ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT 'everyone' 
      CHECK (target_audience IN ('everyone', 'staff', 'students'));
    `);
    console.log('✓ Added target_audience column');

    // Update existing records to have default value
    await db.query(`
      UPDATE announcements 
      SET target_audience = 'everyone' 
      WHERE target_audience IS NULL;
    `);
    console.log('✓ Updated existing records with default target_audience');

    // Create index for better performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_target_audience 
      ON announcements(target_audience);
    `);
    console.log('✓ Created index for target_audience');

    // Show the updated table structure
    const result = await db.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'announcements' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\nUpdated announcements table structure:');
    console.table(result.rows);

    console.log('\n✅ Database update completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Database update failed:', error);
    process.exit(1);
  }
}

updateDatabase();
