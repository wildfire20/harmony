const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeTeacherAssignment, requireTeacherAssignment, authenticateFlexible } = require('../middleware/auth');
const s3Service = require('../services/s3Service');

const router = express.Router();

// Configure multer for handling file uploads (now stores in memory for S3)
const storage = multer.memoryStorage(); // Use memory storage for S3 upload

const fileFilter = (req, file, cb) => {
  // Allow specific file types
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'image/gif'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, Word, Excel, PowerPoint, Text, and Image files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Get documents for a grade/class - COMPLETELY REWRITTEN VERSION
router.get('/grade/:gradeId/class/:classId', [
  authenticate,
  authorizeTeacherAssignment
], async (req, res) => {
  try {
    const { gradeId, classId } = req.params;
    const user = req.user;

    console.log('=== DOCUMENTS ENDPOINT - FULL DEBUG ===');
    console.log('Raw params - gradeId:', gradeId, 'classId:', classId);
    console.log('User object:', JSON.stringify(user, null, 2));

    // Validate and parse parameters
    const requestedGradeId = parseInt(gradeId, 10);
    const requestedClassId = parseInt(classId, 10);

    if (isNaN(requestedGradeId) || isNaN(requestedClassId)) {
      console.error('❌ Invalid parameters:', { gradeId, classId });
      return res.status(400).json({ 
        success: false,
        message: 'Invalid grade or class ID parameters',
        debug: { gradeId, classId, parsed_grade: requestedGradeId, parsed_class: requestedClassId }
      });
    }

    // Validate user object
    if (!user || !user.id) {
      console.error('❌ Invalid user object');
      return res.status(401).json({ 
        success: false,
        message: 'Invalid user authentication' 
      });
    }

    // Check access permissions
    if (user.role === 'student') {
      console.log('=== STUDENT ACCESS VALIDATION ===');
      console.log('User grade_id:', user.grade_id, typeof user.grade_id);
      console.log('User class_id:', user.class_id, typeof user.class_id);
      console.log('Requested grade:', requestedGradeId, typeof requestedGradeId);
      console.log('Requested class:', requestedClassId, typeof requestedClassId);

      // Convert user grade/class to integers for comparison
      const userGradeId = parseInt(user.grade_id, 10);
      const userClassId = parseInt(user.class_id, 10);

      console.log('Parsed user grade_id:', userGradeId);
      console.log('Parsed user class_id:', userClassId);

      if (isNaN(userGradeId) || isNaN(userClassId)) {
        console.error('❌ Student missing valid grade/class assignment');
        return res.status(403).json({ 
          success: false,
          message: 'Your account is missing grade or class assignment. Please contact the administrator.',
          debug: {
            user_grade_id: user.grade_id,
            user_class_id: user.class_id,
            parsed_user_grade: userGradeId,
            parsed_user_class: userClassId
          }
        });
      }

      if (userGradeId !== requestedGradeId || userClassId !== requestedClassId) {
        console.error('❌ Student access denied - grade/class mismatch');
        return res.status(403).json({ 
          success: false,
          message: 'Access denied - you can only access documents for your assigned grade and class',
          debug: {
            user_grade: userGradeId,
            user_class: userClassId,
            requested_grade: requestedGradeId,
            requested_class: requestedClassId
          }
        });
      }

      console.log('✅ Student access granted');
    }

    // Teacher access validation
    if (user.role === 'teacher') {
      console.log('=== TEACHER ACCESS VALIDATION ===');
      try {
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, requestedGradeId, requestedClassId]);

        if (assignmentCheck.rows.length === 0) {
          console.error('❌ Teacher access denied - no assignment');
          return res.status(403).json({ 
            success: false,
            message: 'Access denied - you are not assigned to this grade/class' 
          });
        }
        console.log('✅ Teacher access granted');
      } catch (teacherError) {
        console.error('❌ Teacher assignment check failed:', teacherError);
        return res.status(500).json({ 
          success: false,
          message: 'Error checking teacher assignments',
          error: teacherError.message 
        });
      }
    }

    // Admin/super_admin get automatic access
    if (user.role === 'admin' || user.role === 'super_admin') {
      console.log('✅ Admin access granted');
    }

    // Execute database query with fallback for different column names
    console.log('=== EXECUTING DATABASE QUERY ===');
    console.log('Query parameters:', [requestedGradeId, requestedClassId, user.role]);

    let query = `
      SELECT d.id, d.title, d.description, d.document_type, 
             d.file_name as filename, d.file_name as original_filename, d.file_size, 
             d.uploaded_at, d.is_active, d.target_audience,
             u.first_name as uploaded_by_first_name, 
             u.last_name as uploaded_by_last_name,
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.is_active = true 
        AND (
          -- Class-specific documents (teacher/admin uploads to specific grade/class)
          (d.grade_id = $1 AND d.class_id = $2 AND d.target_audience IS NULL)
          OR
          -- Admin target audience documents
          (d.target_audience = 'everyone')
          OR
          (d.target_audience = 'student' AND $3 = 'student')
          OR
          (d.target_audience = 'staff' AND $3 IN ('teacher', 'admin', 'super_admin'))
        )
      ORDER BY d.document_type, d.uploaded_at DESC
    `;

    console.log('Executing query:', query);
    let result;

    try {
      result = await db.query(query, [requestedGradeId, requestedClassId, user.role]);
    } catch (queryError) {
      console.log('Primary query failed, trying fallback:', queryError.message);
      // Fallback query with different column names
      query = `
        SELECT d.id, d.title, d.description, d.document_type, 
               d.file_name as filename, d.file_name as original_filename, d.file_size, 
               d.uploaded_at, d.is_active, d.target_audience,
               u.first_name as uploaded_by_first_name, 
               u.last_name as uploaded_by_last_name,
               g.name as grade_name, c.name as class_name
        FROM documents d
        JOIN users u ON d.uploaded_by = u.id
        LEFT JOIN grades g ON d.grade_id = g.id
        LEFT JOIN classes c ON d.class_id = c.id
        WHERE d.is_active = true 
          AND (
            -- Class-specific documents (teacher/admin uploads to specific grade/class)
            (d.grade_id = $1 AND d.class_id = $2 AND d.target_audience IS NULL)
            OR
            -- Admin target audience documents
            (d.target_audience = 'everyone')
            OR
            (d.target_audience = 'student' AND $3 = 'student')
            OR
            (d.target_audience = 'staff' AND $3 IN ('teacher', 'admin', 'super_admin'))
          )
        ORDER BY d.document_type, d.created_at DESC
      `;
      result = await db.query(query, [requestedGradeId, requestedClassId, user.role]);
    }

    console.log('=== QUERY RESULTS ===');
    console.log('Rows returned:', result.rows.length);
    
    if (result.rows.length > 0) {
      console.log('Sample document:', JSON.stringify(result.rows[0], null, 2));
    }

    // Format documents
    const documents = result.rows.map(doc => ({
      ...doc,
      file_size_mb: doc.file_size ? (doc.file_size / (1024 * 1024)).toFixed(2) : '0.00'
    }));

    // Group documents by type for better organization
    const documentsByType = {};
    documents.forEach(doc => {
      if (!documentsByType[doc.document_type]) {
        documentsByType[doc.document_type] = [];
      }
      documentsByType[doc.document_type].push(doc);
    });

    console.log('✅ Query successful, returning', documents.length, 'documents');
    console.log('=== END DEBUG ===');

    res.json({ 
      success: true,
      documents: documentsByType,
      total: documents.length,
      grade_id: requestedGradeId,
      class_id: requestedClassId
    });

  } catch (error) {
    console.error('❌ CRITICAL ERROR IN DOCUMENTS ENDPOINT:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error constraint:', error.constraint);
    console.error('Error stack:', error.stack);

    // Return detailed error for debugging
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching documents',
      error_details: {
        name: error.name,
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      },
      timestamp: new Date().toISOString()
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
    console.log('=== DOCUMENT UPLOAD DEBUG ===');
    console.log('Headers:', req.headers);
    console.log('Request body:', req.body);
    console.log('File received:', !!req.file);
    if (req.file) {
      console.log('File details:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
    }
    
    if (!req.file) {
      console.log('❌ No file uploaded in request');
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded' 
      });
    }

    const { title, description, document_type, grade_id, class_id, target_audience } = req.body;
    const user = req.user;

    console.log('User:', JSON.stringify(user, null, 2));
    console.log('S3 Environment Variables Check:', {
      AWS_ACCESS_KEY_ID: !!process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: !!process.env.AWS_SECRET_ACCESS_KEY,
      AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME,
      AWS_REGION: process.env.AWS_REGION,
      accessKeyStart: process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.substring(0, 8) : 'N/A',
      secretKeyLength: process.env.AWS_SECRET_ACCESS_KEY ? process.env.AWS_SECRET_ACCESS_KEY.length : 0
    });

    // Validate required fields based on user role
    if (!title || !document_type) {
      return res.status(400).json({ 
        success: false,
        message: 'Title and document type are required' 
      });
    }

    // For admin uploads, validate target_audience
    if ((user.role === 'admin' || user.role === 'super_admin')) {
      if (!target_audience) {
        return res.status(400).json({ 
          success: false,
          message: 'Target audience is required for admin uploads' 
        });
      }
      
      const validAudiences = ['everyone', 'student', 'staff'];
      if (!validAudiences.includes(target_audience)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid target audience. Must be: everyone, student, or staff' 
        });
      }
    } else {
      // For teacher uploads, validate grade_id and class_id
      if (!grade_id || !class_id) {
        return res.status(400).json({ 
          success: false,
          message: 'Grade ID and class ID are required for teacher uploads' 
        });
      }
    }

    let gradeId = null;
    let classId = null;

    // Only process grade/class for non-admin uploads
    if (user.role === 'teacher') {
      gradeId = parseInt(grade_id, 10);
      classId = parseInt(class_id, 10);

      if (isNaN(gradeId) || isNaN(classId)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid grade or class ID' 
        });
      }
    }

    // Check if teacher has access to this grade/class - MANDATORY CHECK
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You are not assigned to this grade/class. Please contact an administrator for assignment.' 
        });
      }
      console.log('✅ Teacher assignment verified');
    }

    // Insert document record with S3 information OR local file fallback
    console.log('Preparing file upload and database insert...');

    let s3UploadResult = null;
    let localFilePath = null;
    
    // Check if S3 is configured (for testing purposes)
    const isS3Configured = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME;
    console.log('🔍 S3 Configuration Check:', {
      isS3Configured,
      bucketName: process.env.AWS_S3_BUCKET_NAME,
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ? '[SET]' : '[NOT SET]',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? '[SET]' : '[NOT SET]'
    });
    
    if (!isS3Configured) {
      console.log('⚠️ S3 not configured properly');
      return res.status(500).json({
        success: false,
        message: 'File storage not properly configured. Please contact administrator.',
        error: 'S3_NOT_CONFIGURED',
        details: {
          missingVars: [
            !process.env.AWS_ACCESS_KEY_ID && 'AWS_ACCESS_KEY_ID',
            !process.env.AWS_SECRET_ACCESS_KEY && 'AWS_SECRET_ACCESS_KEY', 
            !process.env.AWS_S3_BUCKET_NAME && 'AWS_S3_BUCKET_NAME'
          ].filter(Boolean)
        }
      });
    }

    console.log('✅ S3 is configured, uploading to cloud storage...');
    try {
      // Upload file to S3
      s3UploadResult = await s3Service.uploadFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'documents'
      );
      console.log('✅ S3 upload successful:', s3UploadResult);
    } catch (s3Error) {
      console.error('❌ S3 upload failed:', s3Error);
      console.error('S3 Error details:', {
        message: s3Error.message,
        code: s3Error.code,
        name: s3Error.name,
        stack: s3Error.stack
      });
      
      // Send specific error message back to frontend
      return res.status(500).json({
        success: false,
        message: `S3 upload failed: ${s3Error.message}`,
        error: 'S3_UPLOAD_ERROR',
        details: {
          errorCode: s3Error.code,
          errorName: s3Error.name
        }
      });
    }

    // Insert document record into database
    console.log('💾 Inserting document record into database...');
    const result = await db.query(`
      INSERT INTO documents (title, description, document_type, file_name, file_path, original_file_name, file_size, 
                           grade_id, class_id, uploaded_by, s3_key, s3_url, target_audience)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, title, description, document_type, file_name, file_path, original_file_name, file_size, uploaded_at, target_audience, s3_key
    `, [
      title,
      description || null,
      document_type,
      s3UploadResult.uniqueFileName,
      s3UploadResult.s3Url, // Use S3 URL as file_path
      req.file.originalname,
      req.file.size,
      gradeId,
      classId,
      user.id,
      s3UploadResult.s3Key,
      s3UploadResult.s3Url,
      target_audience || null
    ]);

    console.log('✅ Document uploaded successfully:', result.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully to S3 cloud storage',
      document: {
        ...result.rows[0],
        file_size_mb: (req.file.size / (1024 * 1024)).toFixed(2),
        storage_type: 'S3',
        s3_bucket: process.env.AWS_S3_BUCKET_NAME
      }
    });

  } catch (error) {
    console.error('❌ Upload document error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      stack: error.stack
    });
    
    // Send detailed error for debugging
    res.status(500).json({ 
      success: false,
      message: 'Server error uploading document',
      error_details: {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      }
    });
  }
});

// Download document
router.get('/download/:id', authenticateFlexible, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    console.log('=== DOWNLOAD DOCUMENT ===');
    console.log('Document ID:', id);
    console.log('User:', { id: user.id, role: user.role, grade_id: user.grade_id, class_id: user.class_id });

    // Get document information
    const result = await db.query(`
      SELECT d.*, g.name as grade_name, c.name as class_name
      FROM documents d
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.id = $1 AND d.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      console.log('❌ Document not found');
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];
    console.log('Document:', { 
      id: document.id, 
      title: document.title, 
      grade_id: document.grade_id, 
      class_id: document.class_id, 
      target_audience: document.target_audience 
    });

    // Enhanced access permissions check that supports target_audience
    let hasAccess = false;

    if (user.role === 'admin' || user.role === 'super_admin') {
      hasAccess = true;
      console.log('✅ Admin access granted');
    } else if (document.target_audience) {
      // Target audience based documents (admin uploads)
      if (document.target_audience === 'everyone') {
        hasAccess = true;
        console.log('✅ Everyone audience access granted');
      } else if (document.target_audience === 'student' && user.role === 'student') {
        hasAccess = true;
        console.log('✅ Student audience access granted');
      } else if (document.target_audience === 'staff' && ['teacher', 'admin', 'super_admin'].includes(user.role)) {
        hasAccess = true;
        console.log('✅ Staff audience access granted');
      }
    } else {
      // Class-specific documents (traditional teacher uploads)
      if (user.role === 'student') {
        if (user.grade_id == document.grade_id && user.class_id == document.class_id) {
          hasAccess = true;
          console.log('✅ Student class access granted');
        }
      } else if (user.role === 'teacher') {
        // Check teacher assignments
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, document.grade_id, document.class_id]);

        if (assignmentCheck.rows.length > 0) {
          hasAccess = true;
          console.log('✅ Teacher assignment access granted');
        }
      }
    }

    if (!hasAccess) {
      console.log('❌ Access denied');
      return res.status(403).json({ message: 'Access denied' });
    }

    // Handle file serving - S3 or local fallback
    if (document.s3_key) {
      console.log('✅ Generating signed URL for S3 download:', document.s3_key);
      
      try {
        // Use the new getDownloadUrl method to force download behavior
        const signedUrl = await s3Service.getDownloadUrl(
          document.s3_key, 
          document.original_file_name || document.file_name, 
          300
        );
        console.log('✅ Download URL generated with attachment disposition');
        
        // Redirect directly to S3 signed URL with download headers
        return res.redirect(signedUrl);
        
      } catch (s3Error) {
        console.log('❌ S3 download error:', s3Error);
        return res.status(404).json({ 
          message: 'Document file is temporarily unavailable',
          details: 'The file could not be accessed from cloud storage. Please try again later or contact an administrator.',
          document_title: document.title,
          document_id: document.id
        });
      }
    } else if (document.file_path) {
      // Local file fallback
      console.log('📁 Serving local file:', document.file_path);
      
      if (!fs.existsSync(document.file_path)) {
        console.log('❌ Local file not found:', document.file_path);
        return res.status(404).json({ 
          message: 'Document file is not available',
          details: 'The local file was not found. It may have been moved or deleted.',
          document_title: document.title,
          document_id: document.id
        });
      }
      
      // Set appropriate headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${document.original_file_name || document.file_name}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      
      // Stream the file
      const fileStream = fs.createReadStream(document.file_path);
      fileStream.pipe(res);
      
    } else {
      console.log('❌ Document missing both S3 key and file path');
      return res.status(404).json({ 
        message: 'Document file is not available',
        details: 'This document was uploaded before proper file storage was implemented. Please ask an administrator to re-upload it.',
        document_title: document.title,
        document_id: document.id
      });
    }

  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({ message: 'Server error downloading document' });
  }
});

// View document in browser
router.get('/view/:id', authenticateFlexible, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    console.log('=== VIEW DOCUMENT ===');
    console.log('Document ID:', id);
    console.log('User:', { id: user.id, role: user.role, grade_id: user.grade_id, class_id: user.class_id });

    // Get document information
    const result = await db.query(`
      SELECT d.*, g.name as grade_name, c.name as class_name
      FROM documents d
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.id = $1 AND d.is_active = true
    `, [id]);

    if (result.rows.length === 0) {
      console.log('❌ Document not found');
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];
    console.log('Document:', { 
      id: document.id, 
      title: document.title, 
      grade_id: document.grade_id, 
      class_id: document.class_id, 
      target_audience: document.target_audience 
    });

    // Enhanced access permissions check that supports target_audience
    let hasAccess = false;

    if (user.role === 'admin' || user.role === 'super_admin') {
      hasAccess = true;
      console.log('✅ Admin access granted');
    } else if (document.target_audience) {
      // Target audience based documents (admin uploads)
      if (document.target_audience === 'everyone') {
        hasAccess = true;
        console.log('✅ Everyone audience access granted');
      } else if (document.target_audience === 'student' && user.role === 'student') {
        hasAccess = true;
        console.log('✅ Student audience access granted');
      } else if (document.target_audience === 'staff' && ['teacher', 'admin', 'super_admin'].includes(user.role)) {
        hasAccess = true;
        console.log('✅ Staff audience access granted');
      }
    } else {
      // Class-specific documents (traditional teacher uploads)
      if (user.role === 'student') {
        if (user.grade_id == document.grade_id && user.class_id == document.class_id) {
          hasAccess = true;
          console.log('✅ Student class access granted');
        }
      } else if (user.role === 'teacher') {
        // Check teacher assignments
        const assignmentCheck = await db.query(`
          SELECT 1 FROM teacher_assignments 
          WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
        `, [user.id, document.grade_id, document.class_id]);

        if (assignmentCheck.rows.length > 0) {
          hasAccess = true;
          console.log('✅ Teacher assignment access granted');
        }
      }
    }

    if (!hasAccess) {
      console.log('❌ Access denied');
      return res.status(403).json({ message: 'Access denied' });
    }

    // Handle file serving - S3 or local fallback for viewing
    if (document.s3_key) {
      console.log('✅ Getting file content from S3 for direct view:', document.s3_key);

      try {
        // Get file content directly from S3
        const fileContent = await s3Service.getFileContent(document.s3_key);
        
        // Set appropriate headers for viewing in browser
        const fileName = document.original_file_name || document.file_name || 'document';
        
        // Determine content type based on file extension for better browser compatibility
        const ext = path.extname(fileName).toLowerCase();
        let contentType = 'application/octet-stream';
        
        switch (ext) {
          case '.pdf':
            contentType = 'application/pdf';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.gif':
            contentType = 'image/gif';
            break;
          case '.webp':
            contentType = 'image/webp';
            break;
          case '.txt':
            contentType = 'text/plain';
            break;
          case '.doc':
            contentType = 'application/msword';
            break;
          case '.docx':
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            break;
          default:
            // Use stored file_type as fallback, but prefer extension-based detection
            contentType = document.file_type || 'application/octet-stream';
        }
        
        console.log('📄 Serving file:', { fileName, ext, contentType });
        
        // Force inline viewing for viewable file types
        const viewableExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt'];
        const isViewable = viewableExtensions.includes(ext);
        
        res.setHeader('Content-Type', contentType);
        if (isViewable) {
          res.setHeader('Content-Disposition', 'inline');
        } else {
          res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        }
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        
        // Send the file content
        return res.send(fileContent);
        
      } catch (s3Error) {
        console.log('❌ S3 view error:', s3Error);
        return res.status(404).json({ 
          message: 'Document file is temporarily unavailable',
          details: 'The file could not be accessed from cloud storage. Please try again later or contact an administrator.',
          document_title: document.title,
          document_id: document.id
        });
      }
    } else if (document.file_path) {
      // Local file fallback for viewing
      console.log('📁 Serving local file for viewing:', document.file_path);
      
      if (!fs.existsSync(document.file_path)) {
        console.log('❌ Local file not found:', document.file_path);
        return res.status(404).json({ 
          message: 'Document file is not available',
          details: 'The local file was not found. It may have been moved or deleted.',
          document_title: document.title,
          document_id: document.id
        });
      }
      
      // Set appropriate headers for viewing in browser
      const fileName = document.original_file_name || document.file_name || path.basename(document.file_path);
      
      // Determine content type based on file extension for better browser compatibility
      const ext = path.extname(fileName).toLowerCase();
      let contentType = 'application/octet-stream';
      
      switch (ext) {
        case '.pdf':
          contentType = 'application/pdf';
          break;
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.webp':
          contentType = 'image/webp';
          break;
        case '.txt':
          contentType = 'text/plain';
          break;
        case '.doc':
          contentType = 'application/msword';
          break;
        case '.docx':
          contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          break;
        default:
          // Use stored file_type as fallback, but prefer extension-based detection
          contentType = document.file_type || 'application/octet-stream';
      }
      
      console.log('📄 Serving local file:', { fileName, ext, contentType });
      
      // Force inline viewing for viewable file types
      const viewableExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt'];
      const isViewable = viewableExtensions.includes(ext);
      
      res.setHeader('Content-Type', contentType);
      if (isViewable) {
        res.setHeader('Content-Disposition', 'inline');
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      
      // Send the file directly
      return res.sendFile(path.resolve(document.file_path));
      
    } else {
      console.log('❌ Document missing both S3 key and file path');
      return res.status(404).json({ 
        message: 'Document file is not available',
        details: 'This document was uploaded before proper file storage was implemented. Please ask an administrator to re-upload it.',
        document_title: document.title,
        document_id: document.id
      });
    }

  } catch (error) {
    console.error('View document error:', error);
    res.status(500).json({ message: 'Server error viewing document' });
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
      SELECT d.id, d.title, d.description, d.document_type, d.file_name as filename, d.file_name as original_filename,
             d.file_size, d.uploaded_at, d.is_active, d.uploaded_by,
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

    query += ` ORDER BY d.document_type, d.uploaded_at DESC`;

    console.log('Executing /all query:', query);
    let result;

    try {
      result = await db.query(query, queryParams);
    } catch (queryError) {
      console.log('Primary /all query failed, trying fallback:', queryError.message);
      // Fallback query with different column names
      query = `
        SELECT d.id, d.title, d.description, d.document_type, d.file_name as filename, d.file_name as original_filename,
               d.file_size, d.uploaded_at, d.is_active, d.uploaded_by,
               u.first_name as uploaded_by_first_name, u.last_name as uploaded_by_last_name,
               g.name as grade_name, c.name as class_name
        FROM documents d
        JOIN users u ON d.uploaded_by = u.id
        LEFT JOIN grades g ON d.grade_id = g.id
        LEFT JOIN classes c ON d.class_id = c.id
        WHERE d.is_active = true
      `;
      
      if (user.role === 'teacher') {
        query += ` AND EXISTS (
          SELECT 1 FROM teacher_assignments ta 
          WHERE ta.teacher_id = $1 AND ta.grade_id = d.grade_id AND ta.class_id = d.class_id
        )`;
      }
      
      query += ` ORDER BY d.document_type, d.created_at DESC`;
      result = await db.query(query, queryParams);
    }

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
      SELECT d.id, d.title, d.description, d.document_type, d.file_name as filename, d.file_name as original_filename,
             d.file_size, d.uploaded_at, d.is_active,
             u.first_name as uploaded_by_first_name, u.last_name as uploaded_by_last_name,
             g.name as grade_name, c.name as class_name
      FROM documents d
      JOIN users u ON d.uploaded_by = u.id
      LEFT JOIN grades g ON d.grade_id = g.id
      LEFT JOIN classes c ON d.class_id = c.id
      WHERE d.grade_id = $1 AND d.is_active = true
      ORDER BY d.document_type, d.uploaded_at DESC
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
        file_name, file_path, original_file_name, file_size, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      `Test Document for ${studentData.first_name} ${studentData.last_name}`,
      `Test document for Grade ${studentData.grade_id} Class ${studentData.class_id}`,
      'other',
      studentData.grade_id,
      studentData.class_id,
      req.user.id,
      `test-document-grade${studentData.grade_id}-class${studentData.class_id}.pdf`,
      `/test/test-document-grade${studentData.grade_id}-class${studentData.class_id}.pdf`, // file_path for test document
      `Test Document Grade ${studentData.grade_id} Class ${studentData.class_id}.pdf`,
      1024, // dummy file size
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

// Quick debug endpoint to check database schema for documents table
router.get('/debug-columns', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    // Check the actual columns in the documents table
    const schemaQuery = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      ORDER BY ordinal_position
    `);
    
    // Try to get one sample document to see actual data structure
    const sampleQuery = await db.query(`
      SELECT * FROM documents LIMIT 1
    `);
    
    res.json({
      message: 'Database schema debug',
      columns: schemaQuery.rows,
      sample_document: sampleQuery.rows[0] || 'No documents found'
    });
    
  } catch (error) {
    console.error('Debug columns error:', error);
    res.status(500).json({ 
      message: 'Error checking database schema',
      error: error.message 
    });
  }
});

module.exports = router;
