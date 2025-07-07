const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const updateAnnouncementsTable = async () => {
  try {
    console.log('🔧 Updating announcements table structure...');
    
    // Add missing columns
    try {
      await pool.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE`);
      console.log('✅ Added is_global column');
    } catch (error) {
      console.log('ℹ️  is_global column already exists or error:', error.message);
    }
    
    // Rename columns to match our API
    try {
      await pool.query(`ALTER TABLE announcements RENAME COLUMN grade_id TO target_grade_id`);
      console.log('✅ Renamed grade_id to target_grade_id');
    } catch (error) {
      console.log('ℹ️  target_grade_id column already exists or error:', error.message);
    }
    
    try {
      await pool.query(`ALTER TABLE announcements RENAME COLUMN class_id TO target_class_id`);
      console.log('✅ Renamed class_id to target_class_id');
    } catch (error) {
      console.log('ℹ️  target_class_id column already exists or error:', error.message);
    }
    
    // Ensure created_by is NOT NULL
    try {
      await pool.query(`ALTER TABLE announcements ALTER COLUMN created_by SET NOT NULL`);
      console.log('✅ Set created_by as NOT NULL');
    } catch (error) {
      console.log('ℹ️  created_by constraint already exists or error:', error.message);
    }
    
    // Add foreign key constraints if they don't exist
    try {
      await pool.query(`
        ALTER TABLE announcements 
        ADD CONSTRAINT fk_announcements_created_by 
        FOREIGN KEY (created_by) REFERENCES users(id)
      `);
      console.log('✅ Added foreign key constraint for created_by');
    } catch (error) {
      console.log('ℹ️  Foreign key constraint already exists or error:', error.message);
    }
    
    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements(created_by)',
      'CREATE INDEX IF NOT EXISTS idx_announcements_target_grade_class ON announcements(target_grade_id, target_class_id)',
      'CREATE INDEX IF NOT EXISTS idx_announcements_is_global ON announcements(is_global)',
      'CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at)'
    ];
    
    for (const indexQuery of indexes) {
      try {
        await pool.query(indexQuery);
      } catch (error) {
        console.log('ℹ️  Index may already exist:', error.message);
      }
    }
    
    console.log('✅ Indexes updated');
    
    // Update existing announcements to be global if they don't have target grade/class
    const updateResult = await pool.query(`
      UPDATE announcements 
      SET is_global = true 
      WHERE target_grade_id IS NULL OR target_class_id IS NULL
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} announcements to be global`);
    
    // Check final structure
    const finalCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'announcements' 
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Final table structure:');
    finalCheck.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    console.log('🎉 Announcements table updated successfully!');
    
  } catch (error) {
    console.error('❌ Error updating announcements table:', error);
  } finally {
    await pool.end();
  }
};

updateAnnouncementsTable();
