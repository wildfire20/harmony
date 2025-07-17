const { Pool } = require('pg');

// Initialize database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkStudentCount() {
  try {
    console.log('=== Checking Student Count Issues ===');
    console.log('Database URL exists:', !!process.env.DATABASE_URL);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    
    // Check total students by grade/class
    const studentsByGradeClass = await pool.query(`
      SELECT grade_id, class_id, COUNT(*) as student_count
      FROM users 
      WHERE role = 'student' AND is_active = true 
      GROUP BY grade_id, class_id 
      ORDER BY grade_id, class_id
    `);
    
    console.log('\n📊 Students by Grade/Class:');
    studentsByGradeClass.rows.forEach(row => {
      console.log(`Grade ${row.grade_id}, Class ${row.class_id}: ${row.student_count} students`);
    });
    
    // Check specific task and its grade/class
    const taskId = 73; // The task from the screenshot
    const taskInfo = await pool.query(`
      SELECT id, title, grade_id, class_id 
      FROM tasks 
      WHERE id = $1
    `, [taskId]);
    
    if (taskInfo.rows.length > 0) {
      const task = taskInfo.rows[0];
      console.log(`\n📝 Task Info:`, task);
      
      // Check students for this specific task's grade/class
      const studentsForTask = await pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.student_number, u.grade_id, u.class_id,
               s.id as submission_id, s.status as submission_status, s.submitted_at
        FROM users u
        LEFT JOIN submissions s ON u.id = s.student_id AND s.task_id = $1
        WHERE u.role = 'student' 
          AND u.grade_id = $2
          AND u.class_id = $3
          AND u.is_active = true
        ORDER BY u.last_name, u.first_name
      `, [taskId, task.grade_id, task.class_id]);
      
      console.log(`\n👥 Students in Grade ${task.grade_id}, Class ${task.class_id} for Task "${task.title}":`);
      console.log(`Total Students: ${studentsForTask.rows.length}`);
      
      const submitted = studentsForTask.rows.filter(s => s.submission_id);
      const notSubmitted = studentsForTask.rows.filter(s => !s.submission_id);
      
      console.log(`Students who submitted: ${submitted.length}`);
      console.log(`Students who haven't submitted: ${notSubmitted.length}`);
      
      console.log('\nSubmitted:');
      submitted.forEach(s => {
        console.log(`  - ${s.first_name} ${s.last_name} (${s.student_number}) - Status: ${s.submission_status}`);
      });
      
      console.log('\nNot submitted:');
      notSubmitted.forEach(s => {
        console.log(`  - ${s.first_name} ${s.last_name} (${s.student_number})`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkStudentCount();
