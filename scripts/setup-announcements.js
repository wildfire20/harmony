const { Pool } = require('pg');
require('dotenv').config();

// Database configuration - use the same as the main app
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const createAnnouncementsTable = async () => {
  console.log('🔧 Creating announcements table...');
  
  try {
    // Create announcements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
          target_grade_id INTEGER,
          target_class_id INTEGER,
          is_global BOOLEAN DEFAULT FALSE,
          created_by INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
      )
    `);

    console.log('✅ Announcements table created');

    // Create indexes for better performance
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements(created_by)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_target_grade_class ON announcements(target_grade_id, target_class_id) WHERE target_grade_id IS NOT NULL AND target_class_id IS NOT NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_is_global ON announcements(is_global)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at)`);
    } catch (indexError) {
      console.log('⚠️  Some indexes may already exist or have issues:', indexError.message);
    }

    console.log('✅ Indexes created');

    // Add some sample data
    const sampleData = await pool.query(`
      INSERT INTO announcements (title, content, priority, is_global, created_by) 
      VALUES 
          ('Welcome to Harmony Learning Institute', 'Welcome to our new academic year! We are excited to have you all here. Please check your schedules and prepare for an amazing learning journey.', 'high', true, 1),
          ('Library Hours Updated', 'The library will now be open from 8 AM to 8 PM on weekdays, and 10 AM to 6 PM on weekends. Please plan your study sessions accordingly.', 'medium', true, 1),
          ('Midterm Examinations Schedule', 'Midterm examinations will begin next Monday. Please review the examination schedule posted on the notice board and prepare accordingly.', 'high', true, 1)
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    if (sampleData.rows.length > 0) {
      console.log('✅ Sample announcements created');
    } else {
      console.log('ℹ️  Sample announcements already exist');
    }

    console.log('🎉 Announcements feature setup complete!');

    // Test the table
    const testQuery = await pool.query('SELECT COUNT(*) as count FROM announcements');
    console.log(`📊 Total announcements in database: ${testQuery.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error setting up announcements table:', error);
  } finally {
    await pool.end();
  }
};

// Run the setup
if (require.main === module) {
  createAnnouncementsTable();
}

module.exports = { createAnnouncementsTable };
