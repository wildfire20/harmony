const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess, authorizeTeacherAssignment, requireTeacherAssignment } = require('../middleware/auth');

const router = express.Router();

// Get all tasks for a grade/class
router.get('/grade/:gradeId/class/:classId', authenticate, async (req, res) => {
  try {
    const { gradeId, classId } = req.params;
    const user = req.user;

    console.log('=== TASKS ENDPOINT DEBUG ===');
    console.log('Requested gradeId:', gradeId, 'classId:', classId);
    console.log('User:', JSON.stringify(user, null, 2));

    // Convert parameters to integers
    const requestedGradeId = parseInt(gradeId, 10);
    const requestedClassId = parseInt(classId, 10);

    if (isNaN(requestedGradeId) || isNaN(requestedClassId)) {
      console.error('❌ Invalid grade or class ID parameters');
      return res.status(400).json({ 
        success: false,
        message: 'Invalid grade or class ID parameters',
        debug: { gradeId, classId }
      });
    }

    // Check access permissions
    if (user.role === 'student') {
      const userGradeId = parseInt(user.grade_id, 10);
      const userClassId = parseInt(user.class_id, 10);
      
      console.log('Student access check:');
      console.log('User grade_id:', userGradeId, 'Requested:', requestedGradeId);
      console.log('User class_id:', userClassId, 'Requested:', requestedClassId);
      
      if (userGradeId !== requestedGradeId || userClassId !== requestedClassId) {
        console.error('❌ Student access denied - grade/class mismatch');
        return res.status(403).json({ 
          success: false,
          message: 'Access denied - you can only view tasks for your assigned grade and class',
          debug: {
            user_grade: userGradeId,
            user_class: userClassId,
            requested_grade: requestedGradeId,
            requested_class: requestedClassId
          }
        });
      }
    }

    if (user.role === 'teacher') {
      console.log('Checking teacher assignment...');
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
    }

    console.log('✅ Access granted, fetching tasks...');

    let query = `
      SELECT t.id, t.title, t.description, t.instructions, t.due_date, t.max_points,
             t.task_type, t.created_at, t.updated_at,
             u.first_name as teacher_first_name, u.last_name as teacher_last_name,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      JOIN users u ON t.created_by = u.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE t.grade_id = $1 AND t.class_id = $2 AND t.is_active = true
    `;

    const params = [requestedGradeId, requestedClassId];

    // If student, also get their submission status
    if (user.role === 'student') {
      query = `
        SELECT t.id, t.title, t.description, t.instructions, t.due_date, t.max_points,
               t.task_type, t.created_at, t.updated_at,
               u.first_name as teacher_first_name, u.last_name as teacher_last_name,
               g.name as grade_name, c.name as class_name,
               s.id as submission_id, s.status as submission_status, s.score, s.submitted_at
        FROM tasks t
        JOIN users u ON t.created_by = u.id
        JOIN grades g ON t.grade_id = g.id
        JOIN classes c ON t.class_id = c.id
        LEFT JOIN submissions s ON t.id = s.task_id AND s.student_id = $3
        WHERE t.grade_id = $1 AND t.class_id = $2 AND t.is_active = true
      `;
      params.push(user.id);
    }

    query += ' ORDER BY t.due_date ASC, t.created_at DESC';

    console.log('Executing query:', query);
    console.log('Query parameters:', params);

    const result = await db.query(query, params);

    console.log('=== QUERY RESULTS ===');
    console.log('Rows returned:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('Sample task:', JSON.stringify(result.rows[0], null, 2));
    }

    console.log('✅ Returning tasks:', result.rows.length);

    res.json({ 
      success: true,
      tasks: result.rows,
      total: result.rows.length,
      grade_id: requestedGradeId,
      class_id: requestedClassId
    });

  } catch (error) {
    console.error('❌ TASKS ENDPOINT ERROR:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error stack:', error.stack);

    res.status(500).json({ 
      success: false,
      message: 'Server error fetching tasks',
      error_details: {
        name: error.name,
        message: error.message,
        code: error.code,
        detail: error.detail
      }
    });
  }
});

// Get single task details
router.get('/:id', [
  authenticate,
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // First try with submission_type column, if it fails, try without it
    let query = `
      SELECT t.id, t.title, t.description, t.instructions, t.due_date, t.max_points,
             t.task_type, t.submission_type, t.created_at, t.updated_at, t.grade_id, t.class_id,
             u.first_name as teacher_first_name, u.last_name as teacher_last_name,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      JOIN users u ON t.created_by = u.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1 AND t.is_active = true
    `;

    const params = [id];
    let result;

    try {
      result = await db.query(query, params);
    } catch (columnError) {
      console.log('submission_type column might not exist, trying fallback query');
      // Fallback query without submission_type column
      query = `
        SELECT t.id, t.title, t.description, t.instructions, t.due_date, t.max_points,
               t.task_type, 'online' as submission_type, t.created_at, t.updated_at, t.grade_id, t.class_id,
               u.first_name as teacher_first_name, u.last_name as teacher_last_name,
               g.name as grade_name, c.name as class_name
        FROM tasks t
        JOIN users u ON t.created_by = u.id
        JOIN grades g ON t.grade_id = g.id
        JOIN classes c ON t.class_id = c.id
        WHERE t.id = $1 AND t.is_active = true
      `;
      result = await db.query(query, params);
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const task = result.rows[0];

    // If it's a quiz, get quiz details
    if (task.task_type === 'quiz') {
      const quizResult = await db.query(`
        SELECT questions, time_limit, attempts_allowed, show_results, randomize_questions
        FROM quizzes WHERE task_id = $1
      `, [id]);

      if (quizResult.rows.length > 0) {
        task.quiz_details = quizResult.rows[0];
      }
    }

    // If student, get their submission
    if (user.role === 'student') {
      const submissionResult = await db.query(`
        SELECT id, content, file_path, quiz_answers, score, max_score, feedback,
               status, submitted_at, graded_at, attempt_number
        FROM submissions 
        WHERE task_id = $1 AND student_id = $2
        ORDER BY attempt_number DESC
        LIMIT 1
      `, [id, user.id]);

      if (submissionResult.rows.length > 0) {
        task.submission = submissionResult.rows[0];
      }
    }

    // If teacher, get submission statistics
    if (user.role === 'teacher' || user.role === 'admin' || user.role === 'super_admin') {
      const statsResult = await db.query(`
        SELECT 
          COUNT(*) as total_submissions,
          COUNT(CASE WHEN status = 'graded' THEN 1 END) as graded_submissions,
          AVG(score) as average_score,
          MIN(score) as min_score,
          MAX(score) as max_score
        FROM submissions 
        WHERE task_id = $1
      `, [id]);

      task.submission_stats = statsResult.rows[0];
    }

    res.json({ task });

  } catch (error) {
    console.error('Get task details error:', error);
    res.status(500).json({ message: 'Server error fetching task details' });
  }
});

// Create new task
router.post('/', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('title').notEmpty().withMessage('Title is required'),
  body('description').optional(),
  body('instructions').optional(),
  body('due_date').optional().isISO8601().withMessage('Due date must be a valid date'),
  body('max_points').optional().isInt({ min: 1 }).withMessage('Max points must be a positive integer'),
  body('grade_id').isInt().withMessage('Grade ID is required'),
  body('class_id').isInt().withMessage('Class ID is required'),
  body('task_type').isIn(['assignment', 'quiz']).withMessage('Task type must be assignment or quiz'),
  body('submission_type').optional().isIn(['online', 'physical']).withMessage('Submission type must be online or physical')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }

    const { 
      title, 
      description, 
      instructions, 
      due_date, 
      max_points, 
      grade_id, 
      class_id, 
      task_type,
      submission_type 
    } = req.body;
    const user = req.user;

    console.log('=== CREATE TASK DEBUG ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Convert grade_id and class_id to integers
    const gradeId = parseInt(grade_id, 10);
    const classId = parseInt(class_id, 10);

    if (isNaN(gradeId) || isNaN(classId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid grade or class ID' 
      });
    }

    // Check if teacher has access to this grade/class - MANDATORY CHECK
    // (Admins and super_admins can create tasks for any grade/class)
    if (user.role === 'teacher') {
      console.log('Checking teacher assignment for grade:', gradeId, 'class:', classId);
      
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      console.log('Teacher assignment check result:', assignmentCheck.rows);

      if (assignmentCheck.rows.length === 0) {
        console.error('❌ Teacher access denied - no assignment found');
        return res.status(403).json({ 
          success: false,
          message: 'Access denied. You are not assigned to this grade/class. Please contact an administrator to assign you to this grade/class.',
          debug: {
            teacher_id: user.id,
            requested_grade: gradeId,
            requested_class: classId
          }
        });
      }
      console.log('✅ Teacher assignment verified');
    } else if (user.role === 'admin' || user.role === 'super_admin') {
      console.log('✅ Admin access granted - can create tasks for any grade/class');
    }

    // Set default submission type for assignments
    const finalSubmissionType = submission_type || (task_type === 'assignment' ? 'online' : null);

    console.log('Creating task with submission_type:', finalSubmissionType);

    // Try to insert with submission_type first, fall back to without if column doesn't exist
    let result;
    try {
      result = await db.query(`
        INSERT INTO tasks (title, description, instructions, due_date, max_points, grade_id, class_id, created_by, task_type, submission_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, title, description, instructions, due_date, max_points, grade_id, class_id, task_type, submission_type, created_at
      `, [
        title, 
        description, 
        instructions, 
        due_date, 
        max_points || 100, 
        gradeId, 
        classId, 
        user.id, 
        task_type,
        finalSubmissionType
      ]);
    } catch (columnError) {
      if (columnError.code === '42703') { // Column doesn't exist
        console.log('submission_type column not found, creating task without it');
        result = await db.query(`
          INSERT INTO tasks (title, description, instructions, due_date, max_points, grade_id, class_id, created_by, task_type)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, title, description, instructions, due_date, max_points, grade_id, class_id, task_type, created_at
        `, [
          title, 
          description, 
          instructions, 
          due_date, 
          max_points || 100, 
          gradeId, 
          classId, 
          user.id, 
          task_type
        ]);
      } else {
        throw columnError;
      }
    }

    console.log('✅ Task created successfully:', result.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      task: result.rows[0]
    });

  } catch (error) {
    console.error('❌ CREATE TASK ERROR:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    
    res.status(500).json({ 
      success: false,
      message: 'Server error creating task',
      error_details: {
        name: error.name,
        message: error.message,
        code: error.code
      }
    });
  }
});

// Update task
router.put('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task'),
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('description').optional(),
  body('instructions').optional(),
  body('due_date').optional().isISO8601().withMessage('Due date must be a valid date'),
  body('max_points').optional().isInt({ min: 1 }).withMessage('Max points must be a positive integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, description, instructions, due_date, max_points } = req.body;

    const updateFields = [];
    const params = [];
    let paramCount = 0;

    if (title !== undefined) {
      paramCount++;
      updateFields.push(`title = $${paramCount}`);
      params.push(title);
    }

    if (description !== undefined) {
      paramCount++;
      updateFields.push(`description = $${paramCount}`);
      params.push(description);
    }

    if (instructions !== undefined) {
      paramCount++;
      updateFields.push(`instructions = $${paramCount}`);
      params.push(instructions);
    }

    if (due_date !== undefined) {
      paramCount++;
      updateFields.push(`due_date = $${paramCount}`);
      params.push(due_date);
    }

    if (max_points !== undefined) {
      paramCount++;
      updateFields.push(`max_points = $${paramCount}`);
      params.push(max_points);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    paramCount++;
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await db.query(`
      UPDATE tasks 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, title, description, instructions, due_date, max_points, updated_at
    `, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({
      message: 'Task updated successfully',
      task: result.rows[0]
    });

  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Server error updating task' });
  }
});

// Delete task
router.delete('/:id', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      UPDATE tasks 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({
      message: 'Task deleted successfully',
      task: result.rows[0]
    });

  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Server error deleting task' });
  }
});

// Get submissions for a task (teacher only)
router.get('/:id/submissions', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  authorizeResourceAccess('task')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    let query = `
      SELECT s.id, s.content, s.file_path, s.score, s.max_score, s.feedback,
             s.status, s.submitted_at, s.graded_at, s.attempt_number,
             u.id as student_id, u.student_number, u.first_name, u.last_name
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      WHERE s.task_id = $1
    `;

    const params = [id];

    if (status) {
      query += ' AND s.status = $2';
      params.push(status);
    }

    query += ' ORDER BY s.submitted_at DESC';

    const result = await db.query(query, params);

    res.json({ submissions: result.rows });

  } catch (error) {
    console.error('Get task submissions error:', error);
    res.status(500).json({ message: 'Server error fetching submissions' });
  }
});

// Debug endpoint to check tasks table and create sample data
router.get('/debug-tasks', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    console.log('=== DEBUGGING TASKS TABLE ===');
    
    // Check if tasks table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'tasks'
      );
    `);
    
    console.log('Tasks table exists:', tableCheck.rows[0].exists);
    
    if (!tableCheck.rows[0].exists) {
      return res.json({
        message: 'Tasks table does not exist',
        table_exists: false
      });
    }
    
    // Check table structure
    const schemaQuery = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'tasks' 
      ORDER BY ordinal_position
    `);
    
    // Get existing tasks
    const tasksQuery = await db.query(`
      SELECT t.*, u.first_name, u.last_name, g.name as grade_name, c.name as class_name
      FROM tasks t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN grades g ON t.grade_id = g.id
      LEFT JOIN classes c ON t.class_id = c.id
      ORDER BY t.id
    `);
    
    // Get grades and classes for reference
    const gradesQuery = await db.query('SELECT * FROM grades ORDER BY id');
    const classesQuery = await db.query('SELECT * FROM classes ORDER BY id');
    const teachersQuery = await db.query("SELECT id, first_name, last_name FROM users WHERE role = 'teacher' OR role = 'admin' ORDER BY id");
    
    res.json({
      message: 'Tasks debug information',
      table_exists: true,
      table_schema: schemaQuery.rows,
      existing_tasks: tasksQuery.rows,
      available_grades: gradesQuery.rows,
      available_classes: classesQuery.rows,
      available_teachers: teachersQuery.rows
    });
    
  } catch (error) {
    console.error('Debug tasks error:', error);
    res.status(500).json({ 
      message: 'Error debugging tasks',
      error: error.message 
    });
  }
});

// Create sample tasks for testing
router.post('/create-sample-tasks', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    console.log('Creating sample tasks...');
    console.log('User creating tasks:', req.user);
    
    // Get available grades and classes
    const gradesResult = await db.query('SELECT * FROM grades ORDER BY id LIMIT 3');
    const classesResult = await db.query('SELECT * FROM classes ORDER BY id LIMIT 3');
    
    if (gradesResult.rows.length === 0 || classesResult.rows.length === 0) {
      return res.status(400).json({
        message: 'No grades or classes available to create tasks for',
        grades_count: gradesResult.rows.length,
        classes_count: classesResult.rows.length
      });
    }
    
    const sampleTasks = [
      {
        title: 'Mathematics Assignment 1',
        description: 'Complete exercises 1-10 from Chapter 3',
        instructions: 'Show all your work and write clearly. Submit by the due date.',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        max_points: 100,
        task_type: 'assignment'
      },
      {
        title: 'Science Quiz - Plants',
        description: 'Quiz on plant biology and photosynthesis',
        instructions: 'This is a timed quiz. You will have 30 minutes to complete.',
        due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        max_points: 50,
        task_type: 'quiz'
      },
      {
        title: 'English Essay',
        description: 'Write a 500-word essay on your favorite book',
        instructions: 'Use proper grammar and cite your sources.',
        due_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
        max_points: 75,
        task_type: 'assignment'
      }
    ];
    
    const createdTasks = [];
    
    // Create tasks for each grade/class combination
    for (const grade of gradesResult.rows) {
      for (const cls of classesResult.rows.filter(c => c.grade_id === grade.id)) {
        for (const taskTemplate of sampleTasks) {
          try {
            const result = await db.query(`
              INSERT INTO tasks (title, description, instructions, due_date, max_points, grade_id, class_id, created_by, task_type)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING *
            `, [
              `${taskTemplate.title} - ${grade.name} ${cls.name}`,
              taskTemplate.description,
              taskTemplate.instructions,
              taskTemplate.due_date,
              taskTemplate.max_points,
              grade.id,
              cls.id,
              req.user.id,
              taskTemplate.task_type
            ]);
            
            createdTasks.push(result.rows[0]);
          } catch (taskError) {
            console.error('Error creating task:', taskError);
          }
        }
      }
    }
    
    console.log('Sample tasks created:', createdTasks.length);
    
    res.json({
      message: `Successfully created ${createdTasks.length} sample tasks`,
      created_tasks: createdTasks
    });
    
  } catch (error) {
    console.error('Create sample tasks error:', error);
    res.status(500).json({ 
      message: 'Server error creating sample tasks',
      error: error.message 
    });
  }
});

// Initialize tasks tables (admin only)
router.post('/init-tables', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    console.log('Initializing tasks tables via API...');
    
    // Create tasks table
    await db.query(`
      CREATE TABLE IF NOT EXISTS tasks (
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
      )
    `);
    
    // Create submissions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS submissions (
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
      )
    `);
    
    // Create quizzes table
    await db.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
          id SERIAL PRIMARY KEY,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          questions JSONB NOT NULL,
          time_limit INTEGER,
          attempts_allowed INTEGER DEFAULT 1,
          show_results BOOLEAN DEFAULT true,
          randomize_questions BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_grade_class ON tasks(grade_id, class_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_submissions_task_student ON submissions(task_id, student_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
      CREATE INDEX IF NOT EXISTS idx_quizzes_task ON quizzes(task_id);
    `);
    
    console.log('✅ Tasks tables initialized successfully');
    
    // Verify tables exist
    const tablesCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('tasks', 'submissions', 'quizzes')
      ORDER BY table_name
    `);
    
    res.json({
      message: 'Tasks tables initialized successfully',
      created_tables: tablesCheck.rows.map(row => row.table_name)
    });
    
  } catch (error) {
    console.error('Error initializing tasks tables:', error);
    res.status(500).json({ 
      message: 'Error initializing tasks tables',
      error: error.message 
    });
  }
});

// Public debug endpoint (no auth required) - for testing only
router.get('/public-debug', async (req, res) => {
  try {
    console.log('=== PUBLIC DEBUG ENDPOINT ===');
    
    // Check if tasks table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'tasks'
      );
    `);
    
    res.json({
      message: 'Public debug endpoint working',
      tasks_table_exists: tableCheck.rows[0].exists,
      timestamp: new Date().toISOString(),
      server_status: 'Running'
    });
    
  } catch (error) {
    console.error('Public debug error:', error);
    res.status(500).json({ 
      message: 'Public debug endpoint error',
      error: error.message 
    });
  }
});

// Debug endpoint to check student access to specific task
router.get('/debug-student-access/:taskId', [
  authenticate
], async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    // Get task data
    const taskResult = await db.query(`
      SELECT t.*, g.name as grade_name, c.name as class_name, u.first_name as teacher_first_name, u.last_name as teacher_last_name
      FROM tasks t
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      JOIN users u ON t.created_by = u.id
      WHERE t.id = $1
    `, [taskId]);

    // Get user data
    const userResult = await db.query(`
      SELECT u.*, g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id = $1
    `, [user.id]);

    res.json({
      task_id: taskId,
      task_exists: taskResult.rows.length > 0,
      task_data: taskResult.rows[0] || null,
      user_data: userResult.rows[0] || null,
      access_check: {
        user_grade: parseInt(user.grade_id),
        user_class: parseInt(user.class_id),
        task_grade: taskResult.rows[0] ? parseInt(taskResult.rows[0].grade_id) : null,
        task_class: taskResult.rows[0] ? parseInt(taskResult.rows[0].class_id) : null,
        grade_match: taskResult.rows[0] ? parseInt(user.grade_id) === parseInt(taskResult.rows[0].grade_id) : false,
        class_match: taskResult.rows[0] ? parseInt(user.class_id) === parseInt(taskResult.rows[0].class_id) : false
      }
    });

  } catch (error) {
    console.error('Debug student access error:', error);
    res.status(500).json({ 
      message: 'Error debugging student access',
      error: error.message 
    });
  }
});

module.exports = router;
