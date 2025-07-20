const db = require('./config/database');

async function fixAnnouncementOwnership() {
  try {
    console.log('🔧 Fixing announcement ownership for teacher "ove ove"...');
    
    // First, find the teacher "ove ove"
    const teacherResult = await db.query(`
      SELECT id, first_name, last_name, email 
      FROM users 
      WHERE role = 'teacher' 
      AND LOWER(first_name) = 'ove' 
      AND LOWER(last_name) = 'ove'
    `);
    
    if (teacherResult.rows.length === 0) {
      console.log('❌ Teacher "ove ove" not found');
      return;
    }
    
    const teacher = teacherResult.rows[0];
    console.log(`✅ Found teacher: ${teacher.first_name} ${teacher.last_name} (ID: ${teacher.id})`);
    
    // Find announcements that were created by "ove ove" but have wrong ownership
    const announcementsResult = await db.query(`
      SELECT a.id, a.title, a.created_by, u.first_name, u.last_name
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY a.created_at DESC
    `);
    
    console.log('\n📢 Current announcements:');
    announcementsResult.rows.forEach(ann => {
      console.log(`   ID: ${ann.id} - "${ann.title}" - Created by: ${ann.first_name} ${ann.last_name} (User ID: ${ann.created_by})`);
    });
    
    // Find announcements that should belong to "ove ove" but don't
    const announceementsToFix = announcementsResult.rows.filter(ann => 
      ann.created_by !== teacher.id && 
      (ann.first_name === 'ove' || ann.title?.includes('it time') || ann.title?.includes('qwer') || ann.title?.includes('new'))
    );
    
    if (announceementsToFix.length > 0) {
      console.log(`\n🔧 Fixing ownership of ${announceementsToFix.length} announcements...`);
      
      for (const ann of announceementsToFix) {
        await db.query(`
          UPDATE announcements 
          SET created_by = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [teacher.id, ann.id]);
        
        console.log(`   ✅ Fixed: "${ann.title}" (ID: ${ann.id}) now owned by user ${teacher.id}`);
      }
      
      console.log('\n🎉 Ownership fix completed!');
      console.log('   Now refresh the announcements page and you should see delete buttons.');
    } else {
      console.log('\n✅ All announcements already have correct ownership');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing ownership:', error);
    process.exit(1);
  }
}

fixAnnouncementOwnership();
