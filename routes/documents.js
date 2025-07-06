const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/documents';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Allow specific file types
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/jpg'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, Word, Excel, and Image files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Get documents for a grade/class
router.get('/grade/:gradeId/class/:classId', authenticate, async (req, res) => {
  try {
    const { gradeId, classId } = req.params;
    const user = req.user;

    // Convert URL parameters to integers for comparison
    const requestedGradeId = parseInt(gradeId, 10);
    const requestedClassId = parseInt(classId, 10);

    console.log('=== DOCUMENTS GRADE/CLASS ENDPOINT DEBUG ===');
    console.log('Requested gradeId:', gradeId, typeof gradeId, '-> parsed:', requestedGradeId);
    console.log('Requested classId:', classId, typeof classId, '-> parsed:', requestedClassId);
    console.log('User:', user);
    console.log('User grade_id:', user.grade_id, typeof user.grade_id);
    console.log('User class_id:', user.class_id, typeof user.class_id);
    console.log('User role:', user.role);

    // Validate URL parameters
    if (isNaN(requestedGradeId) || isNaN(requestedClassId)) {
      console.error('❌ Invalid grade or class ID parameters');
      return res.status(400).json({ 
        message: 'Invalid grade or class ID',
        debug: { gradeId, classId }
      });
    }

    // Check access permissions with detailed logging
    if (user.role === 'student') {
      console.log('=== STUDENT ACCESS CHECK ===');
      console.log('Comparing grade_id:', user.grade_id, '==', requestedGradeId);
      console.log('Comparing class_id:', user.class_id, '==', requestedClassId);
      console.log('Grade match:', user.grade_id === requestedGradeId);
      console.log('Class match:', user.class_id === requestedClassId);
      
      if (user.grade_id === requestedGradeId && user.class_id === requestedClassId) {
        console.log('✅ Student access GRANTED - exact match');
      } else {
        console.error('❌ Access denied for student - grade/class mismatch');
        console.error('User grade_id:', user.grade_id, 'Requested gradeId:', requestedGradeId);
        console.error('User class_id:', user.class_id, 'Requested classId:', requestedClassId);
        return res.status(403).json({ 
          message: 'Access denied - grade/class mismatch',
          debug: {
            user_grade: user.grade_id,
            user_class: user.class_id,
            requested_grade: requestedGradeId,
            requested_class: requestedClassId
          }
        });
      }
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, requestedGradeId, requestedClassId]);

      if (assignmentCheck.rows.length === 0) {
        console.error('Access denied for teacher - no assignment');
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    console.log('=== EXECUTING DATABASE QUERY ===');
    console.log('Query parameters:', [requestedGradeId, requestedClassId]);
    
    // Fixed: Ensure all column names match the database schema
    const result = await db.query(`
      SELECT d.id, d.title, d.description, d.document_type, d.filename, d.original_filename,
             d.file_size, d.created_at as uploaded_at, d.is_active,
             u.first_name as uploaded_by_first_name, u.last_name as uploaded_by_last_name,
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.grade_id = $1 AND d.class_id = $2 AND d.is_active = true
      ORDER BY d.document_type, d.created_at DESC
    `, [requestedGradeId, requestedClassId]);

    console.log('=== QUERY RESULTS ===');
    console.log('Query result rows:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('Sample document:', result.rows[0]);
    }
    console.log('All documents found:', result.rows);

    console.log('Query result:', result.rows.length, 'documents found');
    console.log('Documents:', result.rows);

    // Return documents as array (frontend expects this format)
    const documents = result.rows.map(doc => ({
      ...doc,
      file_size_mb: (doc.file_size / (1024 * 1024)).toFixed(2)
    }));

    console.log('Final documents array:', documents);
    console.log('=== END DEBUG ===');

    res.json({ 
      documents: documents,
      total: result.rows.length 
    });

  } catch (error) {
    console.error('❌ DOCUMENTS ENDPOINT ERROR:', error);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Server error fetching documents',
      error_details: error.message,
      error_code: error.code 
    });
  }
});

// Upload document
router.post('/upload', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  upload.single('document')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { title, description, document_type, grade_id, class_id } = req.body;
    const user = req.user;

    // Validate required fields
    if (!title || !document_type || !grade_id || !class_id) {
      // Clean up uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        message: 'Title, document type, grade ID, and class ID are required' 
      });
    }

    // Check if teacher has access to this grade/class
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, grade_id, class_id]);

      if (assignmentCheck.rows.length === 0) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }

    // Insert document record
    const result = await db.query(`
      INSERT INTO documents (title, description, document_type, filename, file_path, file_size, 
                           grade_id, class_id, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, title, description, document_type, filename, file_size, created_at as uploaded_at
    `, [
      title,
      description,
      document_type,
      req.file.originalname,
      req.file.path,
      req.file.size,
      grade_id,
      class_id,
      user.id
    ]);

    res.status(201).json({
      message: 'Document uploaded successfully',
      document: {
        ...result.rows[0],
        file_size_mb: (req.file.size / (1024 * 1024)).toFixed(2)
      }
    });

  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Upload document error:', error);
    res.status(500).json({ message: 'Server error uploading document' });
  }
});

// Download document
router.get('/download/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Get document information
    const result = await db.query(`
      SELECT d.*, g.name as grade_name, c.name as class_name
      FROM documents d
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.id = $1 AND d.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];

    // Check access permissions
    if (user.role === 'student' && (user.grade_id != document.grade_id || user.class_id != document.class_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, document.grade_id, document.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Check if file exists
    if (!fs.existsSync(document.file_path)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    // Send file
    res.download(document.file_path, document.filename);

  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({ message: 'Server error downloading document' });
  }
});

// Delete document
router.delete('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Get document information
    const result = await db.query(`
      SELECT * FROM documents WHERE id = $1 AND is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];

    // Check permissions (teachers can only delete their own documents)
    if (user.role === 'teacher' && document.uploaded_by !== user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check teacher assignment permissions
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, document.grade_id, document.class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Soft delete document
    await db.query(`
      UPDATE documents SET is_active = false WHERE id = $1
    `, [id]);

    // Optionally delete physical file (commented out for safety)
    // if (fs.existsSync(document.file_path)) {
    //   fs.unlinkSync(document.file_path);
    // }

    res.json({ message: 'Document deleted successfully' });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ message: 'Server error deleting document' });
  }
});

// Get document types
router.get('/types', authenticate, async (req, res) => {
  try {
    const documentTypes = [
      { value: 'timetable', label: 'Timetable', icon: 'calendar' },
      { value: 'past_paper', label: 'Past Paper', icon: 'file-text' },
      { value: 'syllabus', label: 'Syllabus', icon: 'book' },
      { value: 'assignment', label: 'Assignment', icon: 'edit' },
      { value: 'notes', label: 'Study Notes', icon: 'bookmark' },
      { value: 'handbook', label: 'Handbook', icon: 'info' },
      { value: 'form', label: 'Form', icon: 'clipboard' },
      { value: 'other', label: 'Other', icon: 'file' }
    ];

    res.json({ document_types: documentTypes });
  } catch (error) {
    console.error('Get document types error:', error);
    res.status(500).json({ message: 'Server error fetching document types' });
  }
});

// Get all documents (for admin users)
router.get('/all', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const user = req.user;

    let query = `
      SELECT d.id, d.title, d.description, d.document_type, d.filename, d.original_filename,
             d.file_size, d.created_at as uploaded_at, d.is_active, d.uploaded_by,
             u.first_name as uploaded_by_first_name, u.last_name as uploaded_by_last_name,
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.is_active = true
    `;
    
    let queryParams = [];

    // For teachers, only show documents they can access
    if (user.role === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $1 AND ta.grade_id = d.grade_id AND ta.class_id = d.class_id
      )`;
      queryParams.push(user.id);
    }

    query += ` ORDER BY d.document_type, d.created_at DESC`;

    const result = await db.query(query, queryParams);

    // Return as flat array for the new Documents component
    const documents = result.rows.map(doc => ({
      ...doc,
      file_size_mb: (doc.file_size / (1024 * 1024)).toFixed(2)
    }));

    res.json({ 
      documents: documents,
      total_count: documents.length 
    });

  } catch (error) {
    console.error('Get all documents error:', error);
    res.status(500).json({ message: 'Server error fetching documents' });
  }
});

// Get documents for a grade only (for students without class assignment)
router.get('/grade/:gradeId', authenticate, async (req, res) => {
  try {
    const { gradeId } = req.params;
    const user = req.user;

    console.log('=== DOCUMENTS GRADE-ONLY ENDPOINT DEBUG ===');
    console.log('Requested gradeId:', gradeId);
    console.log('User:', user);

    // Check access permissions
    if (user.role === 'student' && user.grade_id != gradeId) {
      console.error('Access denied for student - grade mismatch');
      return res.status(403).json({ message: 'Access denied' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2
      `, [user.id, gradeId]);

      if (assignmentCheck.rows.length === 0) {
        console.error('Access denied for teacher - no assignment to this grade');
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const result = await db.query(`
      SELECT d.id, d.title, d.description, d.document_type, d.filename, d.original_filename,
             d.file_size, d.created_at as uploaded_at, d.is_active,
             u.first_name as uploaded_by_first_name, u.last_name as uploaded_by_last_name,
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.grade_id = $1 AND d.is_active = true
      ORDER BY d.document_type, d.created_at DESC
    `, [gradeId]);

    console.log('Query result for grade-only:', result.rows.length, 'documents found');

    // Return documents as array (frontend expects this format)
    const documents = result.rows.map(doc => ({
      ...doc,
      file_size_mb: (doc.file_size / (1024 * 1024)).toFixed(2)
    }));

    console.log('Final documents array for grade-only:', documents);
    console.log('=== END DEBUG ===');

    res.json({
      documents: documents,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Error fetching documents for grade:', error);
    res.status(500).json({ message: 'Server error fetching documents' });
  }
});

// Create test document for debugging
router.post('/create-test-document', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    console.log('Creating test document...');
    console.log('User creating test:', req.user);
    
    // First, let's find the student (Broe Plussies) and their exact grade/class assignment
    const student = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.grade_id, u.class_id,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student' AND u.first_name ILIKE '%broe%'
      LIMIT 1
    `);
    
    if (student.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    const studentData = student.rows[0];
    console.log('Found student:', studentData);
    
    // Create test document for this specific student's grade/class
    const result = await db.query(`
      INSERT INTO documents (
        title, description, document_type, grade_id, class_id, uploaded_by, 
        filename, original_filename, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      `Test Document for ${studentData.first_name} ${studentData.last_name}`,
      `Test document for Grade ${studentData.grade_id} Class ${studentData.class_id}`,
      'other',
      studentData.grade_id,
      studentData.class_id,
      req.user.id,
      `test-document-grade${studentData.grade_id}-class${studentData.class_id}.pdf`,
      `Test Document Grade ${studentData.grade_id} Class ${studentData.class_id}.pdf`,
      true
    ]);
    
    console.log('Test document created:', result.rows[0]);
    
    res.json({
      message: `Test document created successfully for ${studentData.first_name} ${studentData.last_name}`,
      document: result.rows[0],
      student_info: studentData
    });
    
  } catch (error) {
    console.error('Create test document error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint
    });
    res.status(500).json({ 
      message: 'Server error creating test document',
      error: error.message,
      details: error.detail || 'No additional details'
    });
  }
});

// Debug database schema and existing data
router.get('/debug-schema', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    console.log('=== DEBUGGING DATABASE SCHEMA ===');
    
    // Check documents table structure
    const documentsSchema = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      ORDER BY ordinal_position
    `);
    
    // Check if documents table exists and get sample data
    const documentsData = await db.query(`
      SELECT * FROM documents LIMIT 3
    `);
    
    // Check grades table
    const gradesData = await db.query(`
      SELECT * FROM grades ORDER BY id
    `);
    
    // Check classes table  
    const classesData = await db.query(`
      SELECT * FROM classes ORDER BY id
    `);
    
    // Check users (students) table
    const studentsData = await db.query(`
      SELECT id, first_name, last_name, grade_id, class_id, role 
      FROM users 
      WHERE role = 'student' 
      ORDER BY id
    `);
    
    res.json({
      documents_schema: documentsSchema.rows,
      sample_documents: documentsData.rows,
      grades: gradesData.rows,
      classes: classesData.rows,
      students: studentsData.rows
    });
    
  } catch (error) {
    console.error('Debug schema error:', error);
    res.status(500).json({ 
      message: 'Server error debugging schema',
      error: error.message 
    });
  }
});

module.exports = router;
