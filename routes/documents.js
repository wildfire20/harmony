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

    // Check access permissions
    if (user.role === 'student' && (user.grade_id != gradeId || user.class_id != classId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const result = await db.query(`
      SELECT d.id, d.title, d.description, d.document_type, d.file_name, d.file_path, 
             d.file_size, d.uploaded_at, d.is_active,
             u.first_name as uploaded_by_first_name, u.last_name as uploaded_by_last_name,
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      JOIN grades g ON d.grade_id = g.id
      JOIN classes c ON d.class_id = c.id
      WHERE d.grade_id = $1 AND d.class_id = $2 AND d.is_active = true
      ORDER BY d.document_type, d.uploaded_at DESC
    `, [gradeId, classId]);

    // Group documents by type
    const groupedDocuments = result.rows.reduce((acc, doc) => {
      if (!acc[doc.document_type]) {
        acc[doc.document_type] = [];
      }
      acc[doc.document_type].push({
        ...doc,
        file_size_mb: (doc.file_size / (1024 * 1024)).toFixed(2)
      });
      return acc;
    }, {});

    res.json({ 
      documents: groupedDocuments,
      total_count: result.rows.length 
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Server error fetching documents' });
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
      INSERT INTO documents (title, description, document_type, file_name, file_path, file_size, 
                           grade_id, class_id, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, title, description, document_type, file_name, file_size, uploaded_at
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
      JOIN grades g ON d.grade_id = g.id
      JOIN classes c ON d.class_id = c.id
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
    res.download(document.file_path, document.file_name);

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

module.exports = router;
