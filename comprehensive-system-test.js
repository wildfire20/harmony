const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

// Test configuration
const API_BASE_URL = 'http://localhost:5000/api';
const FRONTEND_URL = 'http://localhost:3000';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

class SystemTester {
  constructor() {
    this.testResults = {
      backend: [],
      frontend: [],
      database: [],
      features: [],
      issues: []
    };
  }

  async runAllTests() {
    console.log('🚀 Starting Harmony Learning Institute System Tests\n');
    
    try {
      await this.testBackendConnectivity();
      await this.testDatabaseTables();
      await this.testDefaultData();
      await this.testAuthenticationEndpoints();
      await this.testPermissionSystem();
      await this.testTeacherAssignments();
      await this.testTaskManagement();
      await this.testSubmissionSystem();
      await this.testQuizSystem();
      await this.testAnnouncementSystem();
      await this.testDocumentSystem();
      await this.testUserManagement();
      
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      this.testResults.issues.push({
        area: 'Test Suite',
        issue: 'Test suite execution failed',
        details: error.message,
        severity: 'critical'
      });
    }
  }

  async testBackendConnectivity() {
    console.log('🔍 Testing Backend Connectivity...');
    
    try {
      // Test health endpoint
      const healthResponse = await axios.get(`${API_BASE_URL}/health`);
      if (healthResponse.status === 200) {
        this.testResults.backend.push('✅ Health endpoint working');
      }
      
      // Test API info endpoint
      const infoResponse = await axios.get(`${API_BASE_URL}`);
      if (infoResponse.status === 200) {
        this.testResults.backend.push('✅ API info endpoint working');
      }
      
    } catch (error) {
      this.testResults.backend.push('❌ Backend connectivity failed');
      this.testResults.issues.push({
        area: 'Backend',
        issue: 'Server not responding',
        details: error.message,
        severity: 'critical'
      });
    }
  }

  async testDatabaseTables() {
    console.log('🔍 Testing Database Tables...');
    
    const requiredTables = [
      'users', 'grades', 'classes', 'tasks', 'quizzes', 'quiz_questions',
      'announcements', 'submissions', 'teacher_assignments', 'documents'
    ];
    
    try {
      for (const table of requiredTables) {
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [table]);
        
        if (result.rows[0].exists) {
          this.testResults.database.push(`✅ Table '${table}' exists`);
        } else {
          this.testResults.database.push(`❌ Table '${table}' missing`);
          this.testResults.issues.push({
            area: 'Database',
            issue: `Missing table: ${table}`,
            details: 'Required table not found in database',
            severity: 'high'
          });
        }
      }
    } catch (error) {
      this.testResults.database.push('❌ Database table check failed');
      this.testResults.issues.push({
        area: 'Database',
        issue: 'Cannot check database tables',
        details: error.message,
        severity: 'critical'
      });
    }
  }

  async testDefaultData() {
    console.log('🔍 Testing Default Data...');
    
    try {
      // Check grades
      const gradesResult = await pool.query('SELECT COUNT(*) FROM grades');
      const gradeCount = parseInt(gradesResult.rows[0].count);
      if (gradeCount > 0) {
        this.testResults.database.push(`✅ Default grades loaded (${gradeCount} grades)`);
      } else {
        this.testResults.database.push('❌ No default grades found');
        this.testResults.issues.push({
          area: 'Database',
          issue: 'Missing default grades',
          details: 'No grades found in the database',
          severity: 'high'
        });
      }
      
      // Check classes
      const classesResult = await pool.query('SELECT COUNT(*) FROM classes');
      const classCount = parseInt(classesResult.rows[0].count);
      if (classCount > 0) {
        this.testResults.database.push(`✅ Default classes loaded (${classCount} classes)`);
      } else {
        this.testResults.database.push('❌ No default classes found');
        this.testResults.issues.push({
          area: 'Database',
          issue: 'Missing default classes',
          details: 'No classes found in the database',
          severity: 'high'
        });
      }
      
      // Check admin user
      const adminResult = await pool.query("SELECT COUNT(*) FROM users WHERE role IN ('admin', 'super_admin')");
      const adminCount = parseInt(adminResult.rows[0].count);
      if (adminCount > 0) {
        this.testResults.database.push(`✅ Admin user exists (${adminCount} admin(s))`);
      } else {
        this.testResults.database.push('❌ No admin user found');
        this.testResults.issues.push({
          area: 'Database',
          issue: 'Missing admin user',
          details: 'No admin user found in the database',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.database.push('❌ Default data check failed');
      this.testResults.issues.push({
        area: 'Database',
        issue: 'Cannot check default data',
        details: error.message,
        severity: 'high'
      });
    }
  }

  async testAuthenticationEndpoints() {
    console.log('🔍 Testing Authentication Endpoints...');
    
    try {
      // Test student login endpoint exists
      const studentLoginResponse = await axios.post(`${API_BASE_URL}/auth/login/student`, {
        student_number: 'nonexistent',
        password: 'wrong'
      }).catch(err => err.response);
      
      if (studentLoginResponse && studentLoginResponse.status === 401) {
        this.testResults.backend.push('✅ Student login endpoint working');
      } else {
        this.testResults.backend.push('❌ Student login endpoint issue');
        this.testResults.issues.push({
          area: 'Authentication',
          issue: 'Student login endpoint not responding correctly',
          details: 'Expected 401 for invalid credentials',
          severity: 'high'
        });
      }
      
      // Test staff login endpoint exists
      const staffLoginResponse = await axios.post(`${API_BASE_URL}/auth/login/staff`, {
        email: 'nonexistent@test.com',
        password: 'wrong'
      }).catch(err => err.response);
      
      if (staffLoginResponse && staffLoginResponse.status === 401) {
        this.testResults.backend.push('✅ Staff login endpoint working');
      } else {
        this.testResults.backend.push('❌ Staff login endpoint issue');
        this.testResults.issues.push({
          area: 'Authentication',
          issue: 'Staff login endpoint not responding correctly',
          details: 'Expected 401 for invalid credentials',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.backend.push('❌ Authentication endpoint test failed');
      this.testResults.issues.push({
        area: 'Authentication',
        issue: 'Cannot test authentication endpoints',
        details: error.message,
        severity: 'high'
      });
    }
  }

  async testPermissionSystem() {
    console.log('🔍 Testing Permission System...');
    
    try {
      // Test that protected endpoints require authentication
      const protectedEndpoints = [
        '/users/profile',
        '/classes/1/1',
        '/tasks/grade/1/class/1',
        '/announcements/grade/1/class/1'
      ];
      
      for (const endpoint of protectedEndpoints) {
        const response = await axios.get(`${API_BASE_URL}${endpoint}`).catch(err => err.response);
        
        if (response && response.status === 401) {
          this.testResults.backend.push(`✅ Protected endpoint ${endpoint} requires auth`);
        } else {
          this.testResults.backend.push(`❌ Protected endpoint ${endpoint} accessible without auth`);
          this.testResults.issues.push({
            area: 'Security',
            issue: `Unprotected endpoint: ${endpoint}`,
            details: 'Endpoint accessible without authentication',
            severity: 'critical'
          });
        }
      }
      
    } catch (error) {
      this.testResults.backend.push('❌ Permission system test failed');
      this.testResults.issues.push({
        area: 'Security',
        issue: 'Cannot test permission system',
        details: error.message,
        severity: 'high'
      });
    }
  }

  async testTeacherAssignments() {
    console.log('🔍 Testing Teacher Assignment System...');
    
    try {
      // Check if teacher_assignments table has proper structure
      const columnsResult = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'teacher_assignments'
      `);
      
      const requiredColumns = ['teacher_id', 'grade_id', 'class_id'];
      const existingColumns = columnsResult.rows.map(row => row.column_name);
      
      let allColumnsExist = true;
      for (const col of requiredColumns) {
        if (existingColumns.includes(col)) {
          this.testResults.features.push(`✅ Teacher assignments has ${col} column`);
        } else {
          this.testResults.features.push(`❌ Teacher assignments missing ${col} column`);
          allColumnsExist = false;
        }
      }
      
      if (allColumnsExist) {
        this.testResults.features.push('✅ Teacher assignment system structure correct');
      } else {
        this.testResults.issues.push({
          area: 'Features',
          issue: 'Teacher assignment system incomplete',
          details: 'Missing required columns in teacher_assignments table',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ Teacher assignment system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test teacher assignment system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  async testTaskManagement() {
    console.log('🔍 Testing Task Management System...');
    
    try {
      // Check tasks table structure
      const tasksCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'tasks'
      `);
      
      const requiredTaskColumns = ['title', 'description', 'due_date', 'grade_id', 'class_id', 'created_by', 'task_type'];
      const existingTaskColumns = tasksCheck.rows.map(row => row.column_name);
      
      let taskSystemComplete = true;
      for (const col of requiredTaskColumns) {
        if (existingTaskColumns.includes(col)) {
          this.testResults.features.push(`✅ Tasks table has ${col} column`);
        } else {
          this.testResults.features.push(`❌ Tasks table missing ${col} column`);
          taskSystemComplete = false;
        }
      }
      
      if (taskSystemComplete) {
        this.testResults.features.push('✅ Task management system structure correct');
      } else {
        this.testResults.issues.push({
          area: 'Features',
          issue: 'Task management system incomplete',
          details: 'Missing required columns in tasks table',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ Task management system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test task management system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  async testSubmissionSystem() {
    console.log('🔍 Testing Submission System...');
    
    try {
      // Check submissions table
      const submissionsCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'submissions'
      `);
      
      const requiredSubmissionColumns = ['task_id', 'student_id', 'file_path', 'status', 'score'];
      const existingSubmissionColumns = submissionsCheck.rows.map(row => row.column_name);
      
      let submissionSystemComplete = true;
      for (const col of requiredSubmissionColumns) {
        if (existingSubmissionColumns.includes(col)) {
          this.testResults.features.push(`✅ Submissions table has ${col} column`);
        } else {
          this.testResults.features.push(`❌ Submissions table missing ${col} column`);
          submissionSystemComplete = false;
        }
      }
      
      if (submissionSystemComplete) {
        this.testResults.features.push('✅ Submission system structure correct');
      } else {
        this.testResults.issues.push({
          area: 'Features',
          issue: 'Submission system incomplete',
          details: 'Missing required columns in submissions table',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ Submission system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test submission system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  async testQuizSystem() {
    console.log('🔍 Testing Quiz System...');
    
    try {
      // Check quiz tables
      const quizCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'quizzes'
      `);
      
      const questionCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'quiz_questions'
      `);
      
      if (quizCheck.rows.length > 0 && questionCheck.rows.length > 0) {
        this.testResults.features.push('✅ Quiz system tables exist');
        
        // Check for auto-grading capabilities
        const questionColumns = questionCheck.rows.map(row => row.column_name);
        if (questionColumns.includes('correct_answer')) {
          this.testResults.features.push('✅ Quiz auto-grading capability present');
        } else {
          this.testResults.features.push('❌ Quiz auto-grading capability missing');
          this.testResults.issues.push({
            area: 'Features',
            issue: 'Quiz auto-grading incomplete',
            details: 'Missing correct_answer column in quiz_questions table',
            severity: 'medium'
          });
        }
      } else {
        this.testResults.features.push('❌ Quiz system tables missing');
        this.testResults.issues.push({
          area: 'Features',
          issue: 'Quiz system incomplete',
          details: 'Missing quiz tables',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ Quiz system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test quiz system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  async testAnnouncementSystem() {
    console.log('🔍 Testing Announcement System...');
    
    try {
      // Check announcements table
      const announcementsCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'announcements'
      `);
      
      const requiredAnnouncementColumns = ['title', 'content', 'grade_id', 'class_id', 'created_by', 'priority'];
      const existingAnnouncementColumns = announcementsCheck.rows.map(row => row.column_name);
      
      let announcementSystemComplete = true;
      for (const col of requiredAnnouncementColumns) {
        if (existingAnnouncementColumns.includes(col)) {
          this.testResults.features.push(`✅ Announcements table has ${col} column`);
        } else {
          this.testResults.features.push(`❌ Announcements table missing ${col} column`);
          announcementSystemComplete = false;
        }
      }
      
      if (announcementSystemComplete) {
        this.testResults.features.push('✅ Announcement system structure correct');
      } else {
        this.testResults.issues.push({
          area: 'Features',
          issue: 'Announcement system incomplete',
          details: 'Missing required columns in announcements table',
          severity: 'medium'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ Announcement system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test announcement system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  async testDocumentSystem() {
    console.log('🔍 Testing Document System...');
    
    try {
      // Check documents table
      const documentsCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'documents'
      `);
      
      const requiredDocumentColumns = ['title', 'file_path', 'document_type', 'grade_id', 'class_id', 'uploaded_by'];
      const existingDocumentColumns = documentsCheck.rows.map(row => row.column_name);
      
      let documentSystemComplete = true;
      for (const col of requiredDocumentColumns) {
        if (existingDocumentColumns.includes(col)) {
          this.testResults.features.push(`✅ Documents table has ${col} column`);
        } else {
          this.testResults.features.push(`❌ Documents table missing ${col} column`);
          documentSystemComplete = false;
        }
      }
      
      if (documentSystemComplete) {
        this.testResults.features.push('✅ Document system structure correct');
      } else {
        this.testResults.issues.push({
          area: 'Features',
          issue: 'Document system incomplete',
          details: 'Missing required columns in documents table',
          severity: 'medium'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ Document system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test document system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  async testUserManagement() {
    console.log('🔍 Testing User Management System...');
    
    try {
      // Check users table structure
      const usersCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users'
      `);
      
      const requiredUserColumns = ['student_number', 'email', 'password', 'role', 'grade_id', 'class_id'];
      const existingUserColumns = usersCheck.rows.map(row => row.column_name);
      
      let userSystemComplete = true;
      for (const col of requiredUserColumns) {
        if (existingUserColumns.includes(col)) {
          this.testResults.features.push(`✅ Users table has ${col} column`);
        } else {
          this.testResults.features.push(`❌ Users table missing ${col} column`);
          userSystemComplete = false;
        }
      }
      
      if (userSystemComplete) {
        this.testResults.features.push('✅ User management system structure correct');
      } else {
        this.testResults.issues.push({
          area: 'Features',
          issue: 'User management system incomplete',
          details: 'Missing required columns in users table',
          severity: 'high'
        });
      }
      
    } catch (error) {
      this.testResults.features.push('❌ User management system test failed');
      this.testResults.issues.push({
        area: 'Features',
        issue: 'Cannot test user management system',
        details: error.message,
        severity: 'medium'
      });
    }
  }

  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 HARMONY LEARNING INSTITUTE - SYSTEM TEST REPORT');
    console.log('='.repeat(60));
    
    console.log('\n🔧 BACKEND TESTS:');
    this.testResults.backend.forEach(result => console.log('  ' + result));
    
    console.log('\n🗄️  DATABASE TESTS:');
    this.testResults.database.forEach(result => console.log('  ' + result));
    
    console.log('\n⚙️  FEATURE TESTS:');
    this.testResults.features.forEach(result => console.log('  ' + result));
    
    if (this.testResults.issues.length > 0) {
      console.log('\n❌ ISSUES FOUND:');
      this.testResults.issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.area}: ${issue.issue}`);
        console.log(`     Details: ${issue.details}`);
      });
    }
    
    // Summary
    const totalTests = this.testResults.backend.length + this.testResults.database.length + this.testResults.features.length;
    const passedTests = (this.testResults.backend.filter(r => r.includes('✅')).length + 
                        this.testResults.database.filter(r => r.includes('✅')).length + 
                        this.testResults.features.filter(r => r.includes('✅')).length);
    const failedTests = totalTests - passedTests;
    
    console.log('\n📈 SUMMARY:');
    console.log(`  Total Tests: ${totalTests}`);
    console.log(`  Passed: ${passedTests}`);
    console.log(`  Failed: ${failedTests}`);
    console.log(`  Issues: ${this.testResults.issues.length}`);
    
    if (failedTests === 0 && this.testResults.issues.length === 0) {
      console.log('\n🎉 ALL TESTS PASSED - SYSTEM IS READY!');
    } else {
      console.log('\n⚠️  SYSTEM NEEDS ATTENTION - See issues above');
    }
    
    console.log('\n' + '='.repeat(60));
  }
}

// Run the tests
const tester = new SystemTester();
tester.runAllTests()
  .then(() => {
    console.log('\n✅ Test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
