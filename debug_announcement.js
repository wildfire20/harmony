const db = require('./config/database');

async function debugAnnouncementCreation() {
  try {
    console.log('🔍 Testing announcement creation...');
    
    // Test basic database connection
    const testResult = await db.query('SELECT NOW()');
    console.log('✅ Database connection successful:', testResult.rows[0]);
    
    // Check announcements table structure
    const tableStructure = await db.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'announcements' 
      ORDER BY ordinal_position
    `);
    
    console.log('📊 Announcements table structure:');
    tableStructure.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default})`);
    });
    
    // Check if target_audience column exists
    const targetAudienceColumn = tableStructure.rows.find(row => row.column_name === 'target_audience');
    if (targetAudienceColumn) {
      console.log('✅ target_audience column exists');
    } else {
      console.log('❌ target_audience column missing');
    }
    
    // Test getting a sample user (admin)
    const adminUser = await db.query(`
      SELECT id, first_name, last_name, role 
      FROM users 
      WHERE role IN ('admin', 'super_admin') 
      LIMIT 1
    `);
    
    if (adminUser.rows.length > 0) {
      console.log('✅ Found admin user:', adminUser.rows[0]);
      
      // Test announcement creation
      const sampleAnnouncement = {
        title: 'Test Announcement',
        content: 'This is a test announcement',
        priority: 'normal',
        target_audience: 'everyone',
        created_by: adminUser.rows[0].id
      };
      
      console.log('🧪 Testing announcement creation with data:', sampleAnnouncement);
      
      const insertResult = await db.query(`
        INSERT INTO announcements (title, content, priority, grade_id, class_id, target_audience, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, title, content, priority, grade_id, class_id, target_audience, created_at
      `, [
        sampleAnnouncement.title, 
        sampleAnnouncement.content, 
        sampleAnnouncement.priority, 
        null, // grade_id for admin announcements
        null, // class_id for admin announcements
        sampleAnnouncement.target_audience, 
        sampleAnnouncement.created_by
      ]);
      
      console.log('✅ Announcement created successfully:', insertResult.rows[0]);
      
      // Clean up - delete the test announcement
      await db.query('DELETE FROM announcements WHERE id = $1', [insertResult.rows[0].id]);
      console.log('🧹 Test announcement cleaned up');
      
    } else {
      console.log('❌ No admin user found');
    }
    
  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    process.exit(0);
  }
}

debugAnnouncementCreation();
