const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function fixAllAnnouncements() {
  try {
    console.log('🔍 Checking current announcement data...');
    
    // First, check current state
    const currentState = await pool.query(`
      SELECT id, title, created_by 
      FROM announcements 
      ORDER BY created_at DESC
    `);
    
    console.log('📢 Current announcements:');
    currentState.rows.forEach(row => {
      console.log(`  ID: ${row.id}, Title: "${row.title}", Created by: "${row.created_by}"`);
    });
    
    // Get the teacher user ID
    const teacherResult = await pool.query(`
      SELECT id, first_name, last_name, email 
      FROM users 
      WHERE email = 'ove@harmonylearning.edu' AND role = 'teacher'
    `);
    
    if (teacherResult.rows.length === 0) {
      console.log('❌ Teacher not found');
      return;
    }
    
    const teacher = teacherResult.rows[0];
    console.log(`\\n👩‍🏫 Teacher found: ${teacher.first_name} ${teacher.last_name} (ID: ${teacher.id})`);
    
    // Update ALL announcements to be owned by the teacher
    console.log('🔧 Fixing ALL announcements to be owned by teacher...');
    
    const updateResult = await pool.query(`
      UPDATE announcements 
      SET created_by = $1 
      WHERE created_by IS NULL OR created_by != $1
      RETURNING id, title, created_by
    `, [teacher.id]);
    
    console.log(`\\n✅ Updated ${updateResult.rows.length} announcements:`);
    updateResult.rows.forEach(row => {
      console.log(`  - ID: ${row.id}, Title: "${row.title}", Now owned by: ${row.created_by}`);
    });
    
    // Verify final state
    const finalState = await pool.query(`
      SELECT id, title, created_by 
      FROM announcements 
      ORDER BY created_at DESC
    `);
    
    console.log('\\n🎉 Final state:');
    finalState.rows.forEach(row => {
      console.log(`  ID: ${row.id}, Title: "${row.title}", Created by: ${row.created_by}`);
    });
    
    console.log('\\n✅ All announcements now owned by teacher! Delete buttons should appear.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixAllAnnouncements();
