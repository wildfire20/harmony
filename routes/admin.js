const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { Parser } = require('json2csv');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Add student (bulk import via CSV or individual)
router.post('/students/bulk', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('students').isArray().withMessage('Students must be an array'),
  body('students.*.student_number').notEmpty().withMessage('Student number is required'),
  body('students.*.first_name').notEmpty().withMessage('First name is required'),
  body('students.*.last_name').notEmpty().withMessage('Last name is required'),
  body('students.*.grade_id').isInt().withMessage('Grade ID must be an integer'),
  body('students.*.class_id').isInt().withMessage('Class ID must be an integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { students } = req.body;
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      const addedStudents = [];
      const failedStudents = [];

      for (const student of students) {
        try {
          // Check if student number already exists
          const existingStudent = await client.query(
            'SELECT id FROM users WHERE student_number = $1',
            [student.student_number]
          );

          if (existingStudent.rows.length > 0) {
            failedStudents.push({
              student_number: student.student_number,
              error: 'Student number already exists'
            });
            continue;
          }

          // Generate password (hashed version of student number)
          const password = await bcrypt.hash(student.student_number, parseInt(process.env.BCRYPT_ROUNDS) || 12);

          // Insert student
          const result = await client.query(`
            INSERT INTO users (student_number, first_name, last_name, grade_id, class_id, password, role, email) 
            VALUES ($1, $2, $3, $4, $5, $6, 'student', $7)
            RETURNING id, student_number, first_name, last_name, grade_id, class_id
          `, [
            student.student_number,
            student.first_name,
            student.last_name,
            student.grade_id,
            student.class_id,
            password,
            student.email || `${student.student_number}@harmonylearning.edu`
          ]);

          addedStudents.push({
            ...result.rows[0],
            generated_password: student.student_number // For admin reference
          });

        } catch (error) {
          failedStudents.push({
            student_number: student.student_number,
            error: error.message
          });
        }
      }

      await client.query('COMMIT');

      res.json({
        message: 'Bulk student addition completed',
        added: addedStudents.length,
        failed: failedStudents.length,
        added_students: addedStudents,
        failed_students: failedStudents
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Bulk student addition error:', error);
    res.status(500).json({ message: 'Server error during bulk student addition' });
  }
});

// Add individual student
router.post('/students', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').notEmpty().withMessage('Last name is required'),
  body('grade_id').isInt().withMessage('Grade ID must be an integer'),
  body('class_id').optional().isInt().withMessage('Class ID must be an integer'),
  body('student_number').optional().notEmpty().withMessage('Student number cannot be empty if provided')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let { student_number, first_name, last_name, grade_id, class_id, email } = req.body;

    // Auto-generate student number if not provided
    if (!student_number) {
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      student_number = `STU${timestamp}${random}`;
      
      // Ensure uniqueness
      const existing = await db.query(
        'SELECT id FROM users WHERE student_number = $1',
        [student_number]
      );
      
      if (existing.rows.length > 0) {
        // Try with additional random suffix
        student_number = `STU${timestamp}${random}${Math.floor(Math.random() * 100)}`;
      }
    } else {
      // Check if provided student number already exists
      const existing = await db.query(
        'SELECT id FROM users WHERE student_number = $1',
        [student_number]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ message: 'Student number already exists' });
      }
    }

    // Generate password (hashed version of student number)
    const password = await bcrypt.hash(student_number, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Insert student
    const result = await db.query(`
      INSERT INTO users (student_number, first_name, last_name, grade_id, class_id, password, role, email) 
      VALUES ($1, $2, $3, $4, $5, $6, 'student', $7)
      RETURNING id, student_number, first_name, last_name, grade_id, class_id, email
    `, [
      student_number,
      first_name,
      last_name,
      grade_id,
      class_id || null, // Allow null class_id
      password,
      email || `${student_number}@harmonylearning.edu`
    ]);

    res.status(201).json({
      message: 'Student added successfully',
      student: result.rows[0],
      generated_password: student_number // For admin reference
    });

  } catch (error) {
    console.error('Add student error:', error);
    res.status(500).json({ message: 'Server error adding student' });
  }
});

// Add teacher
router.post('/teachers', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').notEmpty().withMessage('Last name is required'),
  body('grade_ids').optional().isArray().withMessage('Grade IDs must be an array'),
  body('class_ids').optional().isArray().withMessage('Class IDs must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let { email, password, first_name, last_name, grade_ids, class_ids } = req.body;

    // Check if email already exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    // Auto-generate password if not provided
    if (!password) {
      const randomPassword = Math.random().toString(36).slice(-8);
      password = randomPassword;
    }

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Hash password
      const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

      // Insert teacher
      const result = await client.query(`
        INSERT INTO users (email, password, first_name, last_name, role) 
        VALUES ($1, $2, $3, $4, 'teacher')
        RETURNING id, email, first_name, last_name, role
      `, [email, hashedPassword, first_name, last_name]);

      const teacherId = result.rows[0].id;

      // Assign teacher to grades and classes (only if provided)
      if (grade_ids && grade_ids.length > 0 && class_ids && class_ids.length > 0) {
        for (let i = 0; i < Math.min(grade_ids.length, class_ids.length); i++) {
          await client.query(`
            INSERT INTO teacher_assignments (teacher_id, grade_id, class_id) 
            VALUES ($1, $2, $3)
          `, [teacherId, grade_ids[i], class_ids[i]]);
        }
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Teacher added successfully',
        teacher: result.rows[0]
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Add teacher error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      email,
      first_name,
      last_name,
      grade_ids,
      class_ids
    });
    res.status(500).json({ message: 'Server error adding teacher' });
  }
});

// Update teacher
router.put('/teachers/:id', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('first_name').optional().notEmpty().withMessage('First name is required'),
  body('last_name').optional().notEmpty().withMessage('Last name is required'),
  body('role').optional().isIn(['teacher', 'admin']).withMessage('Invalid role'),
  body('grade_ids').optional().isArray().withMessage('Grade IDs must be an array'),
  body('class_ids').optional().isArray().withMessage('Class IDs must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    let { email, password, first_name, last_name, role, grade_ids, class_ids } = req.body;

    // Check if teacher exists
    const existingTeacher = await db.query('SELECT * FROM users WHERE id = $1 AND role IN ($2, $3)', [id, 'teacher', 'admin']);
    if (existingTeacher.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Check if email already exists for another user
    if (email) {
      const emailCheck = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];
      let paramCount = 0;

      if (first_name) {
        paramCount++;
        updateFields.push(`first_name = $${paramCount}`);
        updateValues.push(first_name);
      }

      if (last_name) {
        paramCount++;
        updateFields.push(`last_name = $${paramCount}`);
        updateValues.push(last_name);
      }

      if (email) {
        paramCount++;
        updateFields.push(`email = $${paramCount}`);
        updateValues.push(email);
      }

      if (role) {
        paramCount++;
        updateFields.push(`role = $${paramCount}`);
        updateValues.push(role);
      }

      if (password) {
        const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
        paramCount++;
        updateFields.push(`password = $${paramCount}`);
        updateValues.push(hashedPassword);
      }

      // Add updated_at
      paramCount++;
      updateFields.push(`updated_at = $${paramCount}`);
      updateValues.push(new Date());

      // Add id for WHERE clause
      paramCount++;
      updateValues.push(id);

      // Update teacher if there are fields to update
      let result;
      if (updateFields.length > 0) {
        const updateQuery = `
          UPDATE users 
          SET ${updateFields.join(', ')} 
          WHERE id = $${paramCount}
          RETURNING id, email, first_name, last_name, role
        `;
        result = await client.query(updateQuery, updateValues);
      } else {
        result = await client.query('SELECT id, email, first_name, last_name, role FROM users WHERE id = $1', [id]);
      }

      // Update teacher assignments if provided
      if (grade_ids !== undefined || class_ids !== undefined) {
        // Delete existing assignments
        await client.query('DELETE FROM teacher_assignments WHERE teacher_id = $1', [id]);

        // Add new assignments if provided
        if (grade_ids && grade_ids.length > 0 && class_ids && class_ids.length > 0) {
          for (let i = 0; i < Math.min(grade_ids.length, class_ids.length); i++) {
            await client.query(`
              INSERT INTO teacher_assignments (teacher_id, grade_id, class_id) 
              VALUES ($1, $2, $3)
            `, [id, grade_ids[i], class_ids[i]]);
          }
        }
      }

      await client.query('COMMIT');

      res.json({
        message: 'Teacher updated successfully',
        teacher: result.rows[0]
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Update teacher error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      id,
      email,
      first_name,
      last_name,
      grade_ids,
      class_ids
    });
    res.status(500).json({ message: 'Server error updating teacher' });
  }
});

// Get all students with pagination and filters
router.get('/students', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const { page = 1, limit = 50, grade_id, class_id, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE u.role = 'student'";
    const params = [];
    let paramCount = 0;

    if (grade_id) {
      paramCount++;
      whereClause += ` AND u.grade_id = $${paramCount}`;
      params.push(grade_id);
    }

    if (class_id) {
      paramCount++;
      whereClause += ` AND u.class_id = $${paramCount}`;
      params.push(class_id);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount} OR u.student_number ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Get total count
    const countResult = await db.query(`
      SELECT COUNT(*) 
      FROM users u
      ${whereClause}
    `, params);

    const totalCount = parseInt(countResult.rows[0].count);

    // Get students
    params.push(limit, offset);
    const result = await db.query(`
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, 
             u.grade_id, u.class_id, u.is_active, u.created_at,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      students: result.rows,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalCount / limit),
        total_count: totalCount,
        per_page: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ message: 'Server error fetching students' });
  }
});

// Get all teachers
router.get('/teachers', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active, u.created_at,
             COALESCE(
               json_agg(
                 json_build_object(
                   'grade_id', ta.grade_id,
                   'class_id', ta.class_id,
                   'grade_name', g.name,
                   'class_name', c.name
                 )
               ) FILTER (WHERE ta.id IS NOT NULL), 
               '[]'::json
             ) as assignments
      FROM users u
      LEFT JOIN teacher_assignments ta ON u.id = ta.teacher_id
      LEFT JOIN grades g ON ta.grade_id = g.id
      LEFT JOIN classes c ON ta.class_id = c.id
      WHERE u.role IN ('teacher', 'admin')
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    res.json({ teachers: result.rows });

  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ message: 'Server error fetching teachers' });
  }
});

// Export student credentials
router.get('/students/export-credentials', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { grade_id, class_id } = req.query;

    let whereClause = "WHERE u.role = 'student'";
    const params = [];
    let paramCount = 0;

    if (grade_id) {
      paramCount++;
      whereClause += ` AND u.grade_id = $${paramCount}`;
      params.push(grade_id);
    }

    if (class_id) {
      paramCount++;
      whereClause += ` AND u.class_id = $${paramCount}`;
      params.push(class_id);
    }

    const result = await db.query(`
      SELECT u.student_number, u.first_name, u.last_name, 
             g.name as grade_name, c.name as class_name,
             u.student_number as password
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      ${whereClause}
      ORDER BY g.name, c.name, u.last_name, u.first_name
    `, params);

    // Convert to CSV
    const fields = ['student_number', 'first_name', 'last_name', 'grade_name', 'class_name', 'password'];
    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="student_credentials.csv"');
    res.send(csv);

  } catch (error) {
    console.error('Export credentials error:', error);
    res.status(500).json({ message: 'Server error exporting credentials' });
  }
});

// Get system statistics
router.get('/statistics', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const stats = await Promise.all([
      db.query("SELECT COUNT(*) as total_students FROM users WHERE role = 'student'"),
      db.query("SELECT COUNT(*) as total_teachers FROM users WHERE role = 'teacher'"),
      db.query("SELECT COUNT(*) as total_classes FROM classes WHERE is_active = true"),
      db.query("SELECT COUNT(*) as total_tasks FROM tasks WHERE is_active = true"),
      db.query("SELECT COUNT(*) as total_announcements FROM announcements WHERE is_active = true"),
      db.query("SELECT COUNT(*) as total_submissions FROM submissions"),
      db.query(`
        SELECT g.name as grade_name, COUNT(u.id) as student_count
        FROM grades g
        LEFT JOIN users u ON g.id = u.grade_id AND u.role = 'student'
        GROUP BY g.id, g.name
        ORDER BY g.name
      `),
      db.query(`
        SELECT DATE_TRUNC('month', submitted_at) as month, COUNT(*) as count
        FROM submissions
        WHERE submitted_at >= NOW() - INTERVAL '6 months'
        GROUP BY month
        ORDER BY month
      `)
    ]);

    res.json({
      overview: {
        total_students: parseInt(stats[0].rows[0].total_students),
        total_teachers: parseInt(stats[1].rows[0].total_teachers),
        total_classes: parseInt(stats[2].rows[0].total_classes),
        total_tasks: parseInt(stats[3].rows[0].total_tasks),
        total_announcements: parseInt(stats[4].rows[0].total_announcements),
        total_submissions: parseInt(stats[5].rows[0].total_submissions)
      },
      students_by_grade: stats[6].rows,
      submissions_by_month: stats[7].rows
    });

  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({ message: 'Server error fetching statistics' });
  }
});

// Update student
router.put('/students/:id', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('first_name').optional().notEmpty().withMessage('First name cannot be empty'),
  body('last_name').optional().notEmpty().withMessage('Last name cannot be empty'),
  body('grade_id').optional().isInt().withMessage('Grade ID must be an integer'),
  body('class_id').optional().isInt().withMessage('Class ID must be an integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { first_name, last_name, grade_id, class_id, is_active } = req.body;

    const updateFields = [];
    const params = [];
    let paramCount = 0;

    if (first_name !== undefined) {
      paramCount++;
      updateFields.push(`first_name = $${paramCount}`);
      params.push(first_name);
    }

    if (last_name !== undefined) {
      paramCount++;
      updateFields.push(`last_name = $${paramCount}`);
      params.push(last_name);
    }

    if (grade_id !== undefined) {
      paramCount++;
      updateFields.push(`grade_id = $${paramCount}`);
      params.push(grade_id);
    }

    if (class_id !== undefined) {
      paramCount++;
      updateFields.push(`class_id = $${paramCount}`);
      params.push(class_id);
    }

    if (is_active !== undefined) {
      paramCount++;
      updateFields.push(`is_active = $${paramCount}`);
      params.push(is_active);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    paramCount++;
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const result = await db.query(`
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} AND role = 'student'
      RETURNING id, student_number, first_name, last_name, grade_id, class_id, is_active
    `, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json({
      message: 'Student updated successfully',
      student: result.rows[0]
    });

  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ message: 'Server error updating student' });
  }
});

// Delete student
router.delete('/students/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      DELETE FROM users 
      WHERE id = $1 AND role = 'student'
      RETURNING id, student_number, first_name, last_name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json({
      message: 'Student deleted successfully',
      student: result.rows[0]
    });

  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ message: 'Server error deleting student' });
  }
});

// Update submission grade (admin can edit any grade)
router.put('/submissions/:id/grade', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('score').isInt({ min: 0 }).withMessage('Score must be a non-negative integer'),
  body('feedback').optional().isString().withMessage('Feedback must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { score, feedback } = req.body;
    const user = req.user;

    // Get submission information
    const submissionResult = await db.query(`
      SELECT s.*, t.max_points, t.title, u.first_name, u.last_name, u.student_number
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN users u ON s.student_id = u.id
      WHERE s.id = $1
    `, [id]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];

    // Validate score doesn't exceed max points
    if (score > submission.max_points) {
      return res.status(400).json({ 
        message: `Score cannot exceed maximum points (${submission.max_points})` 
      });
    }

    // Update submission
    const result = await db.query(`
      UPDATE submissions 
      SET score = $1, feedback = $2, graded_at = CURRENT_TIMESTAMP, graded_by = $3, status = 'graded'
      WHERE id = $4
      RETURNING *
    `, [score, feedback, user.id, id]);

    res.json({
      message: 'Grade updated successfully',
      submission: {
        ...result.rows[0],
        percentage: submission.max_points > 0 ? Math.round((score / submission.max_points) * 100) : 0,
        student_name: `${submission.first_name} ${submission.last_name}`,
        student_number: submission.student_number,
        task_title: submission.title
      }
    });

  } catch (error) {
    console.error('Update submission grade error:', error);
    res.status(500).json({ message: 'Server error updating grade' });
  }
});

// Get all submissions for grading oversight
router.get('/submissions/all', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { grade_id, class_id, task_id, status } = req.query;

    let query = `
      SELECT s.*, t.title as task_title, t.max_points, t.task_type,
             u.first_name, u.last_name, u.student_number,
             g.name as grade_name, c.name as class_name,
             grader.first_name as grader_first_name, grader.last_name as grader_last_name
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      JOIN users u ON s.student_id = u.id
      JOIN grades g ON u.grade_id = g.id
      JOIN classes c ON u.class_id = c.id
      LEFT JOIN users grader ON s.graded_by = grader.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (grade_id) {
      paramCount++;
      query += ` AND u.grade_id = $${paramCount}`;
      params.push(grade_id);
    }

    if (class_id) {
      paramCount++;
      query += ` AND u.class_id = $${paramCount}`;
      params.push(class_id);
    }

    if (task_id) {
      paramCount++;
      query += ` AND s.task_id = $${paramCount}`;
      params.push(task_id);
    }

    if (status) {
      paramCount++;
      query += ` AND s.status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY s.submitted_at DESC`;

    const result = await db.query(query, params);

    const submissions = result.rows.map(sub => ({
      ...sub,
      percentage: sub.max_points > 0 ? Math.round((sub.score / sub.max_points) * 100) : 0,
      student_name: `${sub.first_name} ${sub.last_name}`,
      grader_name: sub.grader_first_name ? `${sub.grader_first_name} ${sub.grader_last_name}` : null
    }));

    res.json({ 
      submissions,
      total: submissions.length
    });

  } catch (error) {
    console.error('Get all submissions error:', error);
    res.status(500).json({ message: 'Server error fetching submissions' });
  }
});

// ==================== GRADES MANAGEMENT ====================

// Get all grades
router.get('/grades', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const result = await db.query(`
      SELECT g.*, 
        COUNT(DISTINCT u.id) as student_count,
        COUNT(DISTINCT c.id) as class_count
      FROM grades g
      LEFT JOIN users u ON g.id = u.grade_id AND u.role = 'student'
      LEFT JOIN classes c ON g.id = c.grade_id
      GROUP BY g.id
      ORDER BY g.name
    `);

    res.json({
      grades: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Get grades error:', error);
    res.status(500).json({ message: 'Server error fetching grades' });
  }
});

// Add grade
router.post('/grades', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('name').notEmpty().withMessage('Grade name is required'),
  body('description').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description } = req.body;

    // Check if grade already exists
    const existingGrade = await db.query(
      'SELECT id FROM grades WHERE name = $1',
      [name]
    );

    if (existingGrade.rows.length > 0) {
      return res.status(400).json({ message: 'Grade with this name already exists' });
    }

    const result = await db.query(`
      INSERT INTO grades (name, description) 
      VALUES ($1, $2) 
      RETURNING *
    `, [name, description]);

    res.status(201).json({
      message: 'Grade added successfully',
      grade: result.rows[0]
    });
  } catch (error) {
    console.error('Add grade error:', error);
    res.status(500).json({ message: 'Server error adding grade' });
  }
});

// Update grade
router.put('/grades/:id', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('name').notEmpty().withMessage('Grade name is required'),
  body('description').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name, description } = req.body;

    const result = await db.query(`
      UPDATE grades 
      SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 
      RETURNING *
    `, [name, description, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Grade not found' });
    }

    res.json({
      message: 'Grade updated successfully',
      grade: result.rows[0]
    });
  } catch (error) {
    console.error('Update grade error:', error);
    res.status(500).json({ message: 'Server error updating grade' });
  }
});

// Delete grade
router.delete('/grades/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if grade has students or classes
    const dependencies = await db.query(`
      SELECT 
        COUNT(DISTINCT u.id) as student_count,
        COUNT(DISTINCT c.id) as class_count
      FROM grades g
      LEFT JOIN users u ON g.id = u.grade_id AND u.role = 'student'
      LEFT JOIN classes c ON g.id = c.grade_id
      WHERE g.id = $1
    `, [id]);

    const deps = dependencies.rows[0];
    if (deps.student_count > 0 || deps.class_count > 0) {
      return res.status(400).json({ 
        message: `Cannot delete grade. It has ${deps.student_count} students and ${deps.class_count} classes assigned.`
      });
    }

    const result = await db.query('DELETE FROM grades WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Grade not found' });
    }

    res.json({
      message: 'Grade deleted successfully',
      grade: result.rows[0]
    });
  } catch (error) {
    console.error('Delete grade error:', error);
    res.status(500).json({ message: 'Server error deleting grade' });
  }
});

// ==================== CLASSES MANAGEMENT ====================

// Get all classes
router.get('/classes', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, 
        g.name as grade_name,
        CONCAT(t.first_name, ' ', t.last_name) as teacher_name,
        COUNT(DISTINCT s.id) as student_count
      FROM classes c
      LEFT JOIN grades g ON c.grade_id = g.id
      LEFT JOIN users t ON c.teacher_id = t.id
      LEFT JOIN users s ON c.id = s.class_id AND s.role = 'student'
      GROUP BY c.id, g.name, t.first_name, t.last_name
      ORDER BY g.name, c.name
    `);

    res.json({
      classes: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ message: 'Server error fetching classes' });
  }
});

// Add class
router.post('/classes', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('name').notEmpty().withMessage('Class name is required'),
  body('grade_id').isInt().withMessage('Grade ID is required'),
  body('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, grade_id, teacher_id } = req.body;

    // Check if class already exists in this grade
    const existingClass = await db.query(
      'SELECT id FROM classes WHERE name = $1 AND grade_id = $2',
      [name, grade_id]
    );

    if (existingClass.rows.length > 0) {
      return res.status(400).json({ message: 'Class with this name already exists in this grade' });
    }

    const result = await db.query(`
      INSERT INTO classes (name, grade_id, teacher_id) 
      VALUES ($1, $2, $3) 
      RETURNING *
    `, [name, grade_id, teacher_id || null]);

    res.status(201).json({
      message: 'Class added successfully',
      class: result.rows[0]
    });
  } catch (error) {
    console.error('Add class error:', error);
    res.status(500).json({ message: 'Server error adding class' });
  }
});

// Update class
router.put('/classes/:id', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('name').notEmpty().withMessage('Class name is required'),
  body('grade_id').isInt().withMessage('Grade ID is required'),
  body('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name, grade_id, teacher_id } = req.body;

    const result = await db.query(`
      UPDATE classes 
      SET name = $1, grade_id = $2, teacher_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 
      RETURNING *
    `, [name, grade_id, teacher_id || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json({
      message: 'Class updated successfully',
      class: result.rows[0]
    });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ message: 'Server error updating class' });
  }
});

// Delete class
router.delete('/classes/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if class has students
    const studentCount = await db.query(
      'SELECT COUNT(*) as count FROM users WHERE class_id = $1 AND role = $2',
      [id, 'student']
    );

    if (parseInt(studentCount.rows[0].count) > 0) {
      return res.status(400).json({ 
        message: `Cannot delete class. It has ${studentCount.rows[0].count} students assigned.`
      });
    }

    const result = await db.query('DELETE FROM classes WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json({
      message: 'Class deleted successfully',
      class: result.rows[0]
    });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ message: 'Server error deleting class' });
  }
});

module.exports = router;
