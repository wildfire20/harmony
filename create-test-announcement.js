// Script to create a test announcement for the current teacher
const createTestAnnouncement = async () => {
  console.log('🎯 Creating Test Announcement for Current Teacher');
  console.log('='.repeat(50));
  
  // Note: Replace with your actual teacher token from browser localStorage
  const token = 'YOUR_TEACHER_TOKEN_HERE';
  
  if (token === 'YOUR_TEACHER_TOKEN_HERE') {
    console.log('❌ Please get your teacher token:');
    console.log('   1. Open browser developer tools (F12)');
    console.log('   2. Go to Application tab -> Local Storage');
    console.log('   3. Copy the "token" value');
    console.log('   4. Replace YOUR_TEACHER_TOKEN_HERE in this script');
    console.log('   5. Run: node create-test-announcement.js');
    return;
  }
  
  const baseUrl = 'https://content-compassion-production.up.railway.app/api';
  
  try {
    // Create a test announcement
    const announcementData = {
      title: 'Test Announcement - Delete Me',
      content: 'This is a test announcement created by the current teacher. You should be able to delete this one!',
      priority: 'normal',
      target_audience: 'everyone'
    };
    
    console.log('Creating announcement...');
    const response = await fetch(`${baseUrl}/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(announcementData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create announcement: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ Test announcement created successfully!');
    console.log(`   Announcement ID: ${result.announcement?.id}`);
    console.log('   Title: Test Announcement - Delete Me');
    
    console.log('\n🎯 Now go back to the announcements page and refresh.');
    console.log('   You should see a red delete button for this new announcement!');
    
  } catch (error) {
    console.error('❌ Failed to create test announcement:', error.message);
  }
};

createTestAnnouncement();
