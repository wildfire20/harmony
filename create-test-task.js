const { Pool } = require('pg');
require('dotenv').config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function createTestTask() {
  try {
    console.log('CREATING TEST TASK');
    console.log('==================');
    
    // Get the teacher ID (user ID 3)
    const teacherResult = await db.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['teacher']);
    if (teacherResult.rows.length === 0) {
      console.log('❌ No teacher found');
      await db.end();
      return;
    }
    
    const teacher = teacherResult.rows[0];
    console.log('Teacher:', teacher.first_name, teacher.last_name, '(ID:', teacher.id + ')');
    
    // Get student
    const studentResult = await db.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['student']);
    if (studentResult.rows.length === 0) {
      console.log('❌ No student found');
      await db.end();
      return;
    }
    
    const student = studentResult.rows[0];
    console.log('Student:', student.first_name, student.last_name, '(ID:', student.id + ')');
    
    // Check grades and classes
    const gradesResult = await db.query('SELECT * FROM grades LIMIT 3');
    const classesResult = await db.query('SELECT * FROM classes LIMIT 3');
    
    console.log('\\nAvailable grades:', gradesResult.rows.map(g => `${g.id}: ${g.name}`));
    console.log('Available classes:', classesResult.rows.map(c => `${c.id}: ${c.name}`));
    
    const gradeId = gradesResult.rows[0]?.id || 1;
    const classId = classesResult.rows[0]?.id || 1;
    
    // Create a test task
    const taskResult = await db.query(`
      INSERT INTO tasks (title, description, task_type, due_date, max_score, grade_id, class_id, created_by, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      'Test Assignment',
      'A test assignment for debugging statistics',
      'assignment',
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Due in 7 days
      100,
      gradeId,
      classId,
      teacher.id,
      true
    ]);
    
    const task = taskResult.rows[0];
    console.log('\\n✅ Created task:', task.id, '-', task.title);
    
    // Make sure the teacher is assigned to this grade/class
    await db.query(`
      INSERT INTO teacher_assignments (teacher_id, grade_id, class_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (teacher_id, grade_id, class_id) DO NOTHING
    `, [teacher.id, gradeId, classId]);
    
    console.log('✅ Ensured teacher assignment');
    
    // Update student to be in the same grade/class
    await db.query(`
      UPDATE users SET grade_id = $1, class_id = $2 WHERE id = $3
    `, [gradeId, classId, student.id]);
    
    console.log('✅ Updated student grade/class assignment');
    
    // Create a test submission
    const submissionResult = await db.query(`
      INSERT INTO submissions (task_id, student_id, content, status, submitted_at, max_score)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      task.id,
      student.id,
      'This is a test submission for debugging',
      'submitted',
      new Date(),
      100
    ]);
    
    const submission = submissionResult.rows[0];
    console.log('✅ Created submission:', submission.id);
    
    console.log('\\n🎉 TEST DATA CREATED SUCCESSFULLY!');
    console.log('====================================');
    console.log('Task ID:', task.id);
    console.log('You can now test with URL: /tasks/' + task.id);
    console.log('Expected statistics:');
    console.log('- Total students: 1');
    console.log('- Submitted: 1');
    console.log('- Not submitted: 0');
    
    await db.end();
  } catch (error) {
    console.error('❌ Error creating test data:', error);
    await db.end();
  }
}

createTestTask();
