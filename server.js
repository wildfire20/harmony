const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Updated with clickable links functionality - v1.0.1
// Validate environment in production
if (process.env.NODE_ENV === 'production') {
  const { validateProductionEnvironment } = require('./validate-env');
  validateProductionEnvironment();
}

// S3 Configuration validation on startup
console.log('🔍 Validating S3 configuration...');
const { isS3ConfigValid } = require('./config/s3');

if (isS3ConfigValid) {
  console.log('✅ S3 configuration is valid');
} else {
  console.error('❌ S3 configuration is invalid - file uploads will fail');
  console.error('📋 Please check AWS environment variables in Railway dashboard');
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
const calendarRoutes = require('./routes/calendar');
const analyticsRoutes = require('./routes/analytics');
const s3HealthRoutes = require('./routes/s3-health');
const invoiceRoutes = require('./routes/invoices');

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
    
    // Check if target_audience column exists and add it if missing
    const columnCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND column_name = 'target_audience'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('Adding target_audience column to documents table...');
      
      // Add the column
      await db.query(`ALTER TABLE documents ADD COLUMN target_audience VARCHAR(20) DEFAULT NULL`);
      
      // Add constraint
      await db.query(`
        ALTER TABLE documents ADD CONSTRAINT check_target_audience 
        CHECK (target_audience IS NULL OR target_audience IN ('everyone', 'student', 'staff'))
      `);
      
      // Add index
      await db.query(`CREATE INDEX idx_documents_target_audience ON documents(target_audience)`);
      
      console.log('✅ Target audience column added to documents table');
    } else {
      console.log('✅ Target audience column already exists');
    }
    
    console.log('Documents table initialized successfully');
  } catch (error) {
    console.log('Documents table initialization skipped or already exists:', error.message);
  }
};

// Initialize target_audience column for announcements
const initializeTargetAudienceColumn = async () => {
  try {
    // Check if column exists
    const columnCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'announcements' AND column_name = 'target_audience';
    `);
    
    if (columnCheck.rows.length === 0) {
      console.log('Adding target_audience column to announcements table...');
      
      // Add target_audience column
      await db.query(`
        ALTER TABLE announcements 
        ADD COLUMN target_audience VARCHAR(20) DEFAULT 'everyone' 
        CHECK (target_audience IN ('everyone', 'staff', 'students'));
      `);
      
      // Update existing records
      await db.query(`
        UPDATE announcements 
        SET target_audience = 'everyone' 
        WHERE target_audience IS NULL;
      `);
      
      // Create index
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_announcements_target_audience 
        ON announcements(target_audience);
      `);
      
      console.log('✅ Target audience column added successfully');
    } else {
      console.log('✅ Target audience column already exists');
    }

    // Allow null values for grade_id and class_id for admin announcements
    await db.query(`
      ALTER TABLE announcements 
      ALTER COLUMN grade_id DROP NOT NULL,
      ALTER COLUMN class_id DROP NOT NULL;
    `);
    
    console.log('✅ Updated announcements table to allow null grade/class for admin announcements');
    
  } catch (error) {
    console.log('❌ Target audience column initialization failed:', error.message);
  }
};

// Initialize graded document columns
const initializeGradedDocumentColumns = async () => {
  try {
    console.log('🔄 Adding graded document columns to submissions table...');
    
    // Check if columns already exist
    const checkColumns = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'submissions' 
      AND column_name IN ('graded_document_s3_key', 'graded_document_s3_url', 'graded_document_original_name', 'graded_document_file_size', 'graded_document_file_type', 'graded_document_uploaded_at')
    `);

    const existingColumns = checkColumns.rows.map(row => row.column_name);
    console.log('Existing graded document columns:', existingColumns);

    const columnsToAdd = [
      { name: 'graded_document_s3_key', definition: 'graded_document_s3_key TEXT' },
      { name: 'graded_document_s3_url', definition: 'graded_document_s3_url TEXT' },
      { name: 'graded_document_original_name', definition: 'graded_document_original_name TEXT' },
      { name: 'graded_document_file_size', definition: 'graded_document_file_size INTEGER' },
      { name: 'graded_document_file_type', definition: 'graded_document_file_type TEXT' },
      { name: 'graded_document_uploaded_at', definition: 'graded_document_uploaded_at TIMESTAMP' }
    ];

    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        await db.query(`ALTER TABLE submissions ADD COLUMN ${column.definition}`);
        console.log(`✅ Added column: ${column.name}`);
      } else {
        console.log(`⚠️ Column already exists: ${column.name}`);
      }
    }

    console.log('✅ Graded document columns initialized successfully');

  } catch (error) {
    console.log('❌ Graded document columns initialization failed:', error.message);
  }
};

// Initialize invoice and payment tables
const initializeInvoiceSystem = async () => {
  try {
    console.log('🔄 Initializing invoice and payment system...');
    
    // Create invoices table
    await db.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_number VARCHAR(50) NOT NULL,
        amount_due DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        outstanding_balance DECIMAL(10, 2) GENERATED ALWAYS AS (amount_due - amount_paid) STORED,
        overpaid_amount DECIMAL(10, 2) GENERATED ALWAYS AS (
          CASE 
            WHEN amount_paid > amount_due THEN amount_paid - amount_due 
            ELSE 0 
          END
        ) STORED,
        due_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Partial', 'Paid', 'Overpaid')),
        reference_number VARCHAR(100) NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create payment_transactions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_number VARCHAR(50) NOT NULL,
        reference_number VARCHAR(100) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        transaction_date DATE NOT NULL,
        description TEXT,
        matched_by INTEGER REFERENCES users(id),
        matched_at TIMESTAMP,
        bank_statement_upload_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create payment_upload_logs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_upload_logs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        file_hash VARCHAR(64) NOT NULL UNIQUE,
        total_transactions INTEGER NOT NULL,
        matched_transactions INTEGER NOT NULL DEFAULT 0,
        total_amount DECIMAL(12, 2) NOT NULL,
        matched_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        uploaded_by INTEGER NOT NULL REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('processing', 'completed', 'failed'))
      )
    `);

    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
      CREATE INDEX IF NOT EXISTS idx_invoices_reference ON invoices(reference_number);
      
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice ON payment_transactions(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_student ON payment_transactions(student_id);
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_reference ON payment_transactions(reference_number);
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_date ON payment_transactions(transaction_date);
      
      CREATE INDEX IF NOT EXISTS idx_payment_upload_logs_hash ON payment_upload_logs(file_hash);
      CREATE INDEX IF NOT EXISTS idx_payment_upload_logs_date ON payment_upload_logs(upload_date);
    `);

    // Create triggers for automatic status updates
    await db.query(`
      CREATE OR REPLACE FUNCTION update_invoice_status()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE invoices SET status = 
          CASE 
            WHEN amount_paid = 0 THEN 'Unpaid'
            WHEN amount_paid < amount_due THEN 'Partial'
            WHEN amount_paid = amount_due THEN 'Paid'
            WHEN amount_paid > amount_due THEN 'Overpaid'
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.invoice_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await db.query(`
      DROP TRIGGER IF EXISTS payment_transaction_status_update ON payment_transactions;
      CREATE TRIGGER payment_transaction_status_update
        AFTER INSERT OR UPDATE OR DELETE ON payment_transactions
        FOR EACH ROW EXECUTE FUNCTION update_invoice_status();
    `);

    console.log('✅ Invoice and payment system initialized successfully');

  } catch (error) {
    console.log('❌ Invoice system initialization failed:', error.message);
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
// Only parse urlencoded for non-multipart requests to avoid conflicts with multer
app.use((req, res, next) => {
  if (req.get('content-type') && req.get('content-type').includes('multipart/form-data')) {
    return next();
  }
  express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

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
app.use('/api/calendar', calendarRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/s3-health', s3HealthRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/fix', fixOwnershipRoutes);
app.use('/api/downloads', require('./routes/downloads'));
app.use('/api', s3HealthRoutes);

// Add migration endpoint for database setup
const { createMigrationEndpoint } = require('./migration-endpoint');
createMigrationEndpoint(app);

// Health check endpoint (before static files)
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Harmony Learning Institute API',
    environment: process.env.NODE_ENV || 'development',
    database: 'unknown'
  };
  
  try {
    await db.query('SELECT 1');
    health.database = 'connected';
    health.status = 'HEALTHY';
  } catch (error) {
    health.database = 'disconnected';
    health.database_error = error.message;
    health.status = 'DEGRADED';
  }
  
  res.json(health);
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
    console.log('Running database schema updates...');
    
    // Create documents table if not exists
    await db.query(`CREATE TABLE IF NOT EXISTS documents (
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
    )`);
    
    // Create tasks table if not exists
    await db.query(`CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      instructions TEXT,
      due_date TIMESTAMP,
      max_points INTEGER DEFAULT 100,
      task_type VARCHAR(50) DEFAULT 'assignment' CHECK (task_type IN ('assignment', 'quiz')),
      grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Create submissions table if not exists
    await db.query(`CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      file_path VARCHAR(500),
      quiz_answers JSONB,
      score DECIMAL(5,2),
      max_score DECIMAL(5,2),
      feedback TEXT,
      status VARCHAR(50) DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned')),
      attempt_number INTEGER DEFAULT 1,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      graded_at TIMESTAMP,
      UNIQUE(task_id, student_id, attempt_number)
    )`);
    
    // Add submission_type column to tasks table if not exists
    await db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submission_type VARCHAR(20) DEFAULT 'online'`);
    
    // Add submission_type column to submissions table
    await db.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submission_type VARCHAR(20) DEFAULT 'online'`);
    
    // Add file_name column to submissions table
    await db.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)`);
    
    // Update existing tasks to have submission_type 'online' for assignments
    await db.query(`UPDATE tasks SET submission_type = 'online' WHERE task_type = 'assignment' AND (submission_type IS NULL OR submission_type = '')`);
    
    // Create indexes for better performance
    await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_grade_class ON documents(grade_id, class_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(is_active)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_tasks_submission_type ON tasks(submission_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_submissions_submission_type ON submissions(submission_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_submissions_task_student ON submissions(task_id, student_id)`);
    
    console.log('✅ Database schema updated successfully');
    
    res.json({ 
      success: true, 
      message: 'Database schema updated successfully for all tables (documents, tasks, submissions)',
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

// Debug endpoint to check database schema
app.get('/api/debug/check-schema', async (req, res) => {
  try {
    console.log('Checking database schema...');
    
    // Check if tables exist
    const tablesResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('documents', 'tasks', 'submissions', 'users', 'grades', 'classes')
      ORDER BY table_name
    `);
    
    // Check documents table columns
    const documentsColumns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    // Check tasks table columns
    const tasksColumns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'tasks' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    // Check submissions table columns
    const submissionsColumns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'submissions' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      tables: tablesResult.rows.map(row => row.table_name),
      schema: {
        documents: documentsColumns.rows,
        tasks: tasksColumns.rows,
        submissions: submissionsColumns.rows
      }
    });
  } catch (error) {
    console.error('Schema check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check database schema',
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

// Initialize database and start server with resilient error handling
const startServer = async () => {
  // Start the HTTP server first
  const server = app.listen(PORT, () => {
    console.log(`🚀 Harmony Learning Institute server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
    console.log(`🔗 Server URL: ${process.env.NODE_ENV === 'production' ? 'https://web-production-618c0.up.railway.app' : `http://localhost:${PORT}`}`);
  });

  // Initialize database asynchronously after server starts
  try {
    console.log('🔄 Initializing database connection...');
    await db.initialize();
    console.log('✅ Database connected successfully');
    
    try {
      await initializeDocumentsTable();
      console.log('✅ Documents table initialized');
    } catch (docError) {
      console.warn('⚠️ Documents table initialization failed:', docError.message);
    }
    
    try {
      await initializeTargetAudienceColumn();
      console.log('✅ Target audience column initialized');
    } catch (targetError) {
      console.warn('⚠️ Target audience column initialization failed:', targetError.message);
    }
    
    try {
      await initializeGradedDocumentColumns();
      console.log('✅ Graded document columns initialized');
    } catch (gradedDocError) {
      console.warn('⚠️ Graded document columns initialization failed:', gradedDocError.message);
    }
    
    try {
      await initializeInvoiceSystem();
      console.log('✅ Invoice system initialized');
    } catch (invoiceError) {
      console.warn('⚠️ Invoice system initialization failed:', invoiceError.message);
    }
    
    try {
      const quickDatabaseFix = require('./quick-db-fix');
      await quickDatabaseFix();
      console.log('✅ Quick database fix applied successfully');
    } catch (quickFixError) {
      console.warn('⚠️ Quick database fix failed:', quickFixError.message);
      
      // Fallback to original fix
      try {
        const fixDatabaseSchema = require('./fix-database-schema');
        await fixDatabaseSchema();
        console.log('✅ Fallback database schema fix applied successfully');
      } catch (schemaError) {
        console.warn('⚠️ Fallback database schema fix failed:', schemaError.message);
      }
    }
    
    console.log('🎉 Server fully initialized and ready!');
    
  } catch (error) {
    console.error('❌ Database initialization failed, but server is still running:', error.message);
    console.log('🔧 Server will continue to serve static files. Database features will be unavailable until connection is restored.');
    console.log('📋 Check your DATABASE_URL environment variable and database availability.');
    
    // Don't exit - let the server continue running for static file serving
    // This allows the React app to load even if the database is down
  }
  
  return server;
};

startServer().catch(error => {
  console.error('❌ Critical server startup error:', error);
  process.exit(1);
});

module.exports = app;
