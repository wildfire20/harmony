// Debug script to check announcement delete functionality
const testAnnouncementDelete = async () => {
  console.log('🔍 Testing Announcement Delete Functionality for Teachers');
  console.log('='.repeat(60));
  
  // Note: You'll need to replace this with an actual teacher token
  // You can get this from the browser's developer tools -> Application -> Local Storage -> token
  const token = 'YOUR_TEACHER_TOKEN_HERE'; // Replace with actual token from browser
  
  if (token === 'YOUR_TEACHER_TOKEN_HERE') {
    console.log('❌ Please update this script with your actual teacher token');
    console.log('   1. Open browser developer tools (F12)');
    console.log('   2. Go to Application tab -> Local Storage');
    console.log('   3. Find the token value and replace it in this script');
    return;
  }
  
  const baseUrl = 'https://content-compassion-production.up.railway.app/api';
  
  try {
    // Get announcements for current teacher
    console.log('Fetching announcements...');
    const response = await fetch(`${baseUrl}/announcements`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch announcements: ${response.status}`);
    }
    
    const data = await response.json();
    const announcements = data.announcements || [];
    
    console.log(`✅ Found ${announcements.length} announcements`);
    
    // Get current user info
    const userResponse = await fetch(`${baseUrl}/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!userResponse.ok) {
      throw new Error(`Failed to verify user: ${userResponse.status}`);
    }
    
    const userData = await userResponse.json();
    const currentUser = userData.user;
    
    console.log(`Current user: ${currentUser.first_name} ${currentUser.last_name} (ID: ${currentUser.id})`);
    
    // Check which announcements the teacher can delete
    const teacherAnnouncements = announcements.filter(announcement => {
      return announcement.created_by === currentUser.id;
    });
    
    console.log(`\n📝 Teacher's own announcements: ${teacherAnnouncements.length}`);
    teacherAnnouncements.forEach((announcement, index) => {
      console.log(`   ${index + 1}. "${announcement.title}" - Created by ID: ${announcement.created_by}`);
    });
    
    if (teacherAnnouncements.length > 0) {
      console.log('\n✅ Delete buttons should be visible for these announcements!');
      console.log('   Look for trash can icons on the right side of each announcement.');
    } else {
      console.log('\n⚠️  No announcements created by this teacher found.');
      console.log('   Create an announcement first to test delete functionality.');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

console.log('To run this test:');
console.log('1. Get your teacher token from browser localStorage');
console.log('2. Replace YOUR_TEACHER_TOKEN_HERE with the actual token');
console.log('3. Run: node debug-announcement-delete.js');

// testAnnouncementDelete();
