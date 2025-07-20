// Debug script to check user IDs and fix announcement ownership
const fixAnnouncementOwnership = async () => {
  console.log('🔍 Debugging Announcement Ownership Issue');
  console.log('='.repeat(50));
  
  const baseUrl = 'https://content-compassion-production.up.railway.app/api';
  
  try {
    // Test with admin credentials to check database
    const adminLogin = await fetch(`${baseUrl}/auth/login/staff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@harmonylearning.edu',
        password: 'admin123'
      })
    });
    
    if (!adminLogin.ok) {
      throw new Error(`Admin login failed: ${adminLogin.status}`);
    }
    
    const adminData = await adminLogin.json();
    const adminToken = adminData.token;
    console.log('✅ Admin logged in successfully');
    
    // Get all users to find the teacher
    const usersResponse = await fetch(`${baseUrl}/admin/users`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    if (usersResponse.ok) {
      const usersData = await usersResponse.json();
      const teachers = usersData.users?.filter(u => u.role === 'teacher') || [];
      
      console.log('\n👨‍🏫 Teachers in system:');
      teachers.forEach(teacher => {
        console.log(`   ID: ${teacher.id} - ${teacher.first_name} ${teacher.last_name} (${teacher.email})`);
      });
      
      // Find teacher "ove ove"
      const oveTeacher = teachers.find(t => 
        t.first_name?.toLowerCase() === 'ove' && 
        t.last_name?.toLowerCase() === 'ove'
      );
      
      if (oveTeacher) {
        console.log(`\n✅ Found teacher "ove ove" with ID: ${oveTeacher.id}`);
        
        // Get announcements
        const announcementsResponse = await fetch(`${baseUrl}/announcements`, {
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        });
        
        if (announcementsResponse.ok) {
          const announcementsData = await announcementsResponse.json();
          const announcements = announcementsData.announcements || [];
          
          console.log('\n📢 Current announcements:');
          announcements.forEach(ann => {
            console.log(`   ID: ${ann.id} - "${ann.title}" - Created by ID: ${ann.created_by} (${ann.author_first_name} ${ann.author_last_name})`);
          });
          
          // Find announcements that should belong to ove but don't
          const oveAnnouncements = announcements.filter(ann => 
            ann.author_first_name === 'ove' && ann.author_last_name === 'ove'
          );
          
          console.log(`\n🔍 Announcements by "ove ove": ${oveAnnouncements.length}`);
          
          if (oveAnnouncements.length > 0) {
            console.log('\n🔧 These announcements need ownership fix:');
            oveAnnouncements.forEach(ann => {
              if (ann.created_by !== oveTeacher.id) {
                console.log(`   - "${ann.title}" (ID: ${ann.id}) - Current owner: ${ann.created_by}, Should be: ${oveTeacher.id}`);
              }
            });
          }
        }
      } else {
        console.log('\n❌ Could not find teacher "ove ove" in system');
      }
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
};

fixAnnouncementOwnership();
