const fs = require('fs');
const path = require('path');
const db = require('./config/database');

async function createTestDocuments() {
  console.log('🚀 Creating test documents with actual files...');
  
  // Ensure uploads directory exists
  const uploadsDir = 'uploads/documents';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Created uploads directory');
  }

  // Create test files
  const testFiles = [
    {
      name: 'sample-pdf-test.pdf',
      content: '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n/Contents 4 0 R\n>>\nendobj\n\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n72 720 Td\n(Test PDF Document) Tj\nET\nendstream\nendobj\n\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000189 00000 n \ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n285\n%%EOF',
      type: 'application/pdf',
      docType: 'handbook'
    },
    {
      name: 'sample-text-test.txt',
      content: 'This is a test text document for the Harmony Learning Institute.\n\nThis document can be viewed directly in the browser.\n\nContent:\n- Sample information\n- Test data\n- Educational material\n\nCreated for testing purposes.',
      type: 'text/plain',
      docType: 'notes'
    }
  ];

  try {
    // Find admin user
    const adminResult = await db.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['super_admin']);
    if (adminResult.rows.length === 0) {
      console.error('❌ No admin user found');
      return;
    }
    const adminId = adminResult.rows[0].id;

    for (const testFile of testFiles) {
      // Create actual file
      const timestamp = Date.now();
      const filename = `test-${timestamp}-${testFile.name}`;
      const filePath = path.join(uploadsDir, filename);
      
      fs.writeFileSync(filePath, testFile.content);
      console.log(`✅ Created file: ${filePath}`);

      // Create database record for admin document (everyone can see)
      const dbResult = await db.query(`
        INSERT INTO documents (title, description, document_type, file_name, file_size, 
                             uploaded_by, file_path, target_audience, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, title
      `, [
        `Test ${testFile.docType} - ${testFile.name}`,
        `This is a test ${testFile.docType} document that can be viewed and downloaded. Created automatically for testing.`,
        testFile.docType,
        filename,
        Buffer.byteLength(testFile.content),
        adminId,
        filePath,
        'everyone',
        true
      ]);

      console.log(`✅ Created database record: ${dbResult.rows[0].title} (ID: ${dbResult.rows[0].id})`);
    }

    // Also create a teacher-specific document
    const teacherResult = await db.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['teacher']);
    if (teacherResult.rows.length > 0) {
      const teacherId = teacherResult.rows[0].id;
      
      const teacherFile = {
        name: 'teacher-assignment.txt',
        content: 'TEACHER ASSIGNMENT\n\nThis is a class-specific document uploaded by a teacher.\n\nAssignment Details:\n- Due Date: Next Week\n- Points: 100\n- Subject: Mathematics\n\nInstructions:\nComplete all problems in the textbook chapter 5.\nShow your work for full credit.\n\nThis document should be viewable by students in the assigned class.',
        type: 'text/plain'
      };

      const timestamp = Date.now();
      const filename = `teacher-${timestamp}-${teacherFile.name}`;
      const filePath = path.join(uploadsDir, filename);
      
      fs.writeFileSync(filePath, teacherFile.content);
      console.log(`✅ Created teacher file: ${filePath}`);

      // Create for Grade 1, Class 1 (where we know there are students)
      const teacherDbResult = await db.query(`
        INSERT INTO documents (title, description, document_type, file_name, file_size, 
                             grade_id, class_id, uploaded_by, file_path, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, title
      `, [
        'Class Assignment - Mathematics Chapter 5',
        'Mathematics assignment for Grade 1 Class A students. Please complete all exercises.',
        'assignment',
        filename,
        Buffer.byteLength(teacherFile.content),
        1, // Grade 1
        1, // Class A
        teacherId,
        filePath,
        true
      ]);

      console.log(`✅ Created teacher document: ${teacherDbResult.rows[0].title} (ID: ${teacherDbResult.rows[0].id})`);
    }

    console.log('🎉 Test documents created successfully!');
    console.log('You can now test viewing and downloading these documents.');
    
  } catch (error) {
    console.error('❌ Error creating test documents:', error);
  } finally {
    process.exit(0);
  }
}

createTestDocuments();
