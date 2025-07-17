const { Pool } = require('pg');
require('dotenv').config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkTasks() {
  try {
    console.log('CHECKING ALL TASKS');
    console.log('==================');
    
    // Get all tasks
    const tasksResult = await db.query('SELECT id, title, created_by, grade_id, class_id, is_active, created_at FROM tasks ORDER BY id DESC LIMIT 10');
    console.log('Recent tasks:');
    tasksResult.rows.forEach(task => {
      console.log(`- Task ${task.id}: "${task.title}" (Grade: ${task.grade_id}, Class: ${task.class_id}, Active: ${task.is_active})`);
    });
    
    // Check if there are any submissions
    console.log('\nCHECKING ALL SUBMISSIONS');
    console.log('=========================');
    const submissionsResult = await db.query('SELECT s.id, s.task_id, s.student_id, u.first_name, u.last_name FROM submissions s JOIN users u ON s.student_id = u.id ORDER BY s.id DESC LIMIT 10');
    console.log('Recent submissions:');
    submissionsResult.rows.forEach(submission => {
      console.log(`- Submission ${submission.id}: Task ${submission.task_id} by ${submission.first_name} ${submission.last_name}`);
    });
    
    await db.end();
  } catch (error) {
    console.error('Error:', error);
    await db.end();
  }
}

checkTasks();
