// Debug script to test task file upload locally
const express = require('express');
const multer = require('multer');
const cors = require('cors');

const app = express();

// Enable CORS for all routes
app.use(cors());

// Configure multer for task file attachments (using memory storage for S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
  },
  fileFilter: (req, file, cb) => {
    console.log('=== MULTER DEBUG ===');
    console.log('File received:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|ppt|pptx|xls|xlsx|zip|rar/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                     file.mimetype.includes('application/') || 
                     file.mimetype.includes('text/') ||
                     file.mimetype.includes('image/');

    if (mimetype && extname) {
      console.log('✅ File accepted');
      return cb(null, true);
    } else {
      console.log('❌ File rejected');
      cb(new Error('File type not supported. Please upload documents, images, or text files.'));
    }
  }
});

// Middleware to log all incoming requests
app.use((req, res, next) => {
  console.log('=== REQUEST DEBUG ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

// Test endpoint
app.post('/api/tasks/debug', upload.single('file'), (req, res) => {
  console.log('=== TASK DEBUG ENDPOINT ===');
  console.log('Body:', req.body);
  console.log('File:', req.file);
  
  res.json({
    success: true,
    body: req.body,
    file: req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : null
  });
});

app.listen(3001, () => {
  console.log('🚀 Debug server running on port 3001');
  console.log('Test with: http://localhost:3001/api/tasks/debug');
});
