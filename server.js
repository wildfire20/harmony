const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Validate environment in production
if (process.env.NODE_ENV === 'production') {
  const { validateProductionEnvironment } = require('./validate-env');
  validateProductionEnvironment();
}

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');
const taskRoutes = require('./routes/tasks');
const quizRoutes = require('./routes/quizzes');
const announcementRoutes = require('./routes/announcements');
const submissionRoutes = require('./routes/submissions');
const adminRoutes = require('./routes/admin');
const documentRoutes = require('./routes/documents');

// Import database
const db = require('./config/database');

// Initialize documents table on startup
const initializeDocumentsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS documents (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          document_type VARCHAR(50) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_path VARCHAR(500) NOT NULL,
          file_size BIGINT NOT NULL,
          grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
          class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
          uploaded_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
          is_active BOOLEAN DEFAULT true,
          uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_grade_class ON documents(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
      CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(is_active);
    `);
    
    console.log('Documents table initialized successfully');
  } catch (error) {
    console.log('Documents table initialization skipped or already exists:', error.message);
  }
};

const app = express();

// Production security enhancements
if (process.env.NODE_ENV === 'production') {
  // Trust proxy for Heroku/Railway/Render
  app.set('trust proxy', 1);
  
  // Enhanced security headers for production
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));
}

// Security middleware
app.use(helmet());

// Rate limiting - more generous limits for better user experience
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // increased from 100 to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  // More detailed error message
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  }
});
app.use('/api/', limiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.CORS_ORIGIN || 'http://localhost:3000',
      'http://localhost:3000', // Development
      'http://localhost:3001'  // Alternative development port
    ];
    
    // In production, allow Railway domains and common deployment platforms
    if (process.env.NODE_ENV === 'production') {
      // Allow same-origin requests (when frontend and backend are served from same domain)
      if (!origin) return callback(null, true);
      
      // Allow Railway.app domains
      if (origin.includes('.railway.app')) {
        return callback(null, true);
      }
      
      // Allow custom domains if configured
      if (process.env.ALLOWED_ORIGINS) {
        const customOrigins = process.env.ALLOWED_ORIGINS.split(',');
        allowedOrigins.push(...customOrigins);
      }
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // In production, be more permissive for same-origin requests
      if (process.env.NODE_ENV === 'production') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  optionsSuccessStatus: 200 // Support legacy browsers
};

app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/documents', documentRoutes);

// Health check endpoint (before static files)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Harmony Learning Institute API'
  });
});

// API info endpoint (for debugging)
app.get('/api', (req, res) => {
  res.json({
    message: 'Harmony Learning Institute API',
    version: '1.0.0',
    status: 'Running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      classes: '/api/classes',
      tasks: '/api/tasks',
      quizzes: '/api/quizzes',
      announcements: '/api/announcements',
      submissions: '/api/submissions',
      admin: '/api/admin',
      documents: '/api/documents'
    }
  });
});

// Serve static files from React app in production
if (process.env.NODE_ENV === 'production') {
  // Serve static files from the React app
  app.use(express.static(path.join(__dirname, 'client/build')));
  
  // Catch-all handler: send back React's index.html file for any non-API routes
  app.get('*', (req, res) => {
    // Don't serve React for API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ message: 'API route not found' });
    }
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
  });
} else {
  // Development mode - serve API info at root
  app.get('/', (req, res) => {
    res.json({
      message: 'Harmony Learning Institute API - Development Mode',
      version: '1.0.0',
      status: 'Running',
      timestamp: new Date().toISOString(),
      note: 'In development, frontend runs on port 3000',
      endpoints: {
        health: '/api/health',
        auth: '/api/auth',
        users: '/api/users',
        classes: '/api/classes',
        tasks: '/api/tasks',
        quizzes: '/api/quizzes',
        announcements: '/api/announcements',
        submissions: '/api/submissions',
        admin: '/api/admin',
        documents: '/api/documents'
      }
    });
  });
}

// Debug endpoint to run SQL schema updates
app.post('/api/debug/run-sql', async (req, res) => {
  try {
    // Add submission_type column to tasks table if not exists
    await db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submission_type VARCHAR(20) DEFAULT 'online'`);
    
    // Add submission_type column to submissions table
    await db.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submission_type VARCHAR(20) DEFAULT 'online'`);
    
    // Add file_name column to submissions table
    await db.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)`);
    
    // Update existing tasks to have submission_type 'online' for assignments
    await db.query(`UPDATE tasks SET submission_type = 'online' WHERE task_type = 'assignment' AND submission_type IS NULL`);
    
    // Create indexes for better performance
    await db.query(`CREATE INDEX IF NOT EXISTS idx_tasks_submission_type ON tasks(submission_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_submissions_submission_type ON submissions(submission_type)`);
    
    res.json({ 
      success: true, 
      message: 'Database schema updated successfully for submissions',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('SQL update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update database schema',
      error: error.message
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!', 
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

const PORT = process.env.PORT || 5000;

// Initialize database and start server
const startServer = async () => {
  try {
    await db.initialize();
    await initializeDocumentsTable();
    app.listen(PORT, () => {
      console.log(`🚀 Harmony Learning Institute server running on port ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
