const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function fixOwnership() {
  try {
    console.log('🔄 Fixing announcement ownership...');
    
    // Update announcements from admin (ID 1) to teacher (ID 11)
    const result = await pool.query(`
      UPDATE announcements 
      SET created_by = 11 
      WHERE created_by = 1 
      RETURNING id, title, created_by
    `);
    
    console.log(`✅ Updated ${result.rows.length} announcements to be owned by teacher (ID 11)`);
    result.rows.forEach(row => {
      console.log(`  - ID: ${row.id}, Title: "${row.title}", Now owned by: ${row.created_by}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixOwnership();
