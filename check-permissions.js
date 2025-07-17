const { Pool } = require('pg');
require('dotenv').config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkPermissions() {
  try {
    console.log('PERMISSION CHECK FOR TASK 16');
    console.log('=============================');
    
    // Get task details
    const taskResult = await db.query('SELECT * FROM tasks WHERE id = 16');
    if (taskResult.rows.length > 0) {
      const task = taskResult.rows[0];
      console.log('Task Details:');
      console.log('- ID:', task.id);
      console.log('- Title:', task.title);
      console.log('- Created by user ID:', task.created_by);
      console.log('- Grade ID:', task.grade_id);
      console.log('- Class ID:', task.class_id);
      
      // Get creator details
      const creatorResult = await db.query('SELECT id, first_name, last_name, role FROM users WHERE id = $1', [task.created_by]);
      if (creatorResult.rows.length > 0) {
        const creator = creatorResult.rows[0];
        console.log('\nTask Creator:');
        console.log('- Name:', creator.first_name, creator.last_name);
        console.log('- Role:', creator.role);
      }
      
      // Get all teacher assignments for this grade/class
      console.log('\nTeacher Assignments for Grade', task.grade_id, 'Class', task.class_id + ':');
      const assignmentsResult = await db.query('SELECT ta.*, u.first_name, u.last_name FROM teacher_assignments ta JOIN users u ON ta.teacher_id = u.id WHERE ta.grade_id = $1 AND ta.class_id = $2', [task.grade_id, task.class_id]);
      assignmentsResult.rows.forEach(assignment => {
        console.log('- Teacher:', assignment.first_name, assignment.last_name, '(ID:', assignment.teacher_id + ')');
      });
      
      // Get students in this grade/class
      console.log('\nStudents in Grade', task.grade_id, 'Class', task.class_id + ':');
      const studentsResult = await db.query("SELECT id, first_name, last_name, student_number FROM users WHERE role = 'student' AND grade_id = $1 AND class_id = $2 AND is_active = true ORDER BY last_name", [task.grade_id, task.class_id]);
      console.log('Total students:', studentsResult.rows.length);
      studentsResult.rows.forEach(student => {
        console.log('- Student:', student.first_name, student.last_name, '(ID:', student.id + ', Number:', student.student_number + ')');
      });
      
      // Get submissions for this task
      console.log('\nSubmissions for Task 16:');
      const submissionsResult = await db.query('SELECT s.*, u.first_name, u.last_name FROM submissions s JOIN users u ON s.student_id = u.id WHERE s.task_id = 16 ORDER BY s.submitted_at DESC');
      console.log('Total submissions:', submissionsResult.rows.length);
      submissionsResult.rows.forEach(submission => {
        console.log('- Submission by:', submission.first_name, submission.last_name, '(Status:', submission.status + ')');
      });
    } else {
      console.log('Task 16 not found!');
    }
    
    await db.end();
  } catch (error) {
    console.error('Error:', error);
    await db.end();
  }
}

checkPermissions();
