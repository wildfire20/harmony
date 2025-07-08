// Test script for announcements functionality
const testAnnouncements = async () => {
  console.log('=== Testing Announcements Functionality ===');

  try {
    // Test 1: Check if create button exists for authorized users
    const createBtn = document.querySelector('button:has(svg)');
    if (createBtn) {
      console.log('✅ Create button found');
    } else {
      console.log('❌ Create button not found');
    }

    // Test 2: Open create modal
    createBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 500));

    const modal = document.querySelector('.fixed.inset-0');
    if (modal) {
      console.log('✅ Create modal opens');
    } else {
      console.log('❌ Create modal not found');
    }

    // Test 3: Check form fields
    const titleInput = document.querySelector('input[type="text"]');
    const contentTextarea = document.querySelector('textarea');
    const prioritySelect = document.querySelector('select');

    console.log('Form fields present:');
    console.log('- Title:', !!titleInput);
    console.log('- Content:', !!contentTextarea);
    console.log('- Priority:', !!prioritySelect);

    // Test 4: Create announcement
    if (titleInput && contentTextarea && prioritySelect) {
      titleInput.value = 'Test Announcement';
      titleInput.dispatchEvent(new Event('change'));
      
      contentTextarea.value = 'This is a test announcement';
      contentTextarea.dispatchEvent(new Event('change'));
      
      prioritySelect.value = 'normal';
      prioritySelect.dispatchEvent(new Event('change'));

      console.log('✅ Form fields can be filled');
    }

    // Test 5: Check delete buttons on existing announcements
    const announcements = document.querySelectorAll('.bg-white.rounded-lg');
    let hasDeleteButtons = false;
    announcements.forEach(announcement => {
      if (announcement.querySelector('button svg[class*="trash"]')) {
        hasDeleteButtons = true;
      }
    });

    console.log('Delete buttons present:', hasDeleteButtons ? '✅' : '❌');

    console.log('=== Test Complete ===');
  } catch (error) {
    console.error('Test failed:', error);
  }
};

// Run test
setTimeout(testAnnouncements, 1000);
