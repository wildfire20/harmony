// Database migration script - execute from browser console
// This will fix the payment_upload_logs table schema issue

async function executeDatabaseMigration() {
  try {
    console.log('🔄 Starting database migration...');
    
    const response = await fetch('/api/invoices/migrate-database', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Migration successful!', result);
      alert('Database migration completed successfully! Please refresh the page and try uploading the CSV again.');
    } else {
      console.error('❌ Migration failed:', result);
      alert('Migration failed: ' + result.message);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Migration error:', error);
    alert('Migration error: ' + error.message);
  }
}

// Execute the migration
executeDatabaseMigration();
