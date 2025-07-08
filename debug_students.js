const db = require('./config/database');

async function debugStudents() {
  try {
    console.log('=== DEBUGGING STUDENT DATA ===');
    
    // Get all students
    const studentsResult = await db.query(`
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, 
             u.role, u.grade_id, u.class_id, g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student'
      ORDER BY u.id
    `);
    
    console.log('Students found:', studentsResult.rows.length);
    console.log('Student data:');
    studentsResult.rows.forEach((student, index) => {
      console.log(`${index + 1}. ID: ${student.id}, Number: ${student.student_number}, Name: ${student.first_name} ${student.last_name}`);
      console.log(`   Grade ID: ${student.grade_id}, Grade Name: ${student.grade_name}`);
      console.log(`   Class ID: ${student.class_id}, Class Name: ${student.class_name}`);
      console.log(`   Email: ${student.email}`);
      console.log('---');
    });
    
    // Get all grades
    const gradesResult = await db.query('SELECT * FROM grades ORDER BY id');
    console.log('Grades available:', gradesResult.rows.length);
    gradesResult.rows.forEach(grade => {
      console.log(`Grade ID: ${grade.id}, Name: ${grade.name}`);
    });
    
    // Get all classes
    const classesResult = await db.query('SELECT * FROM classes ORDER BY id');
    console.log('Classes available:', classesResult.rows.length);
    classesResult.rows.forEach(cls => {
      console.log(`Class ID: ${cls.id}, Name: ${cls.name}, Grade ID: ${cls.grade_id}`);
    });
    
    // Get all documents
    const documentsResult = await db.query(`
      SELECT d.id, d.title, d.document_type, d.grade_id, d.class_id, 
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN grades g ON d.grade_id = g.id
      JOIN classes c ON d.class_id = c.id
      WHERE d.is_active = true
      ORDER BY d.id
    `);
    
    console.log('Documents available:', documentsResult.rows.length);
    documentsResult.rows.forEach(doc => {
      console.log(`Doc ID: ${doc.id}, Title: ${doc.title}, Type: ${doc.document_type}`);
      console.log(`   Grade ID: ${doc.grade_id}, Grade Name: ${doc.grade_name}`);
      console.log(`   Class ID: ${doc.class_id}, Class Name: ${doc.class_name}`);
      console.log('---');
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

debugStudents();
