// Script to call the API fix endpoint
const fixOwnershipViaAPI = async () => {
  console.log('🔧 Calling API to fix announcement ownership...');
  
  const baseUrl = 'https://content-compassion-production.up.railway.app/api';
  
  try {
    // Login as admin
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
    
    // Call the fix endpoint
    const fixResponse = await fetch(`${baseUrl}/fix/fix-announcement-ownership`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!fixResponse.ok) {
      const errorText = await fixResponse.text();
      throw new Error(`Fix failed: ${fixResponse.status} - ${errorText}`);
    }
    
    const result = await fixResponse.json();
    console.log('✅ Ownership fix result:', result);
    
    if (result.success) {
      console.log(`🎉 Successfully fixed ownership of ${result.fixedCount} announcements!`);
      console.log('   Now refresh the announcements page and you should see delete buttons.');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    if (error.message.includes('404')) {
      console.log('⏳ The API endpoint might not be deployed yet. Wait 2-3 minutes and try again.');
    }
  }
};

fixOwnershipViaAPI();
