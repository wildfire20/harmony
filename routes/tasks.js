const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess } = require('../middleware/auth');

const router = express.Router();

// Get all tasks for a grade/class
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

    const params = [gradeId, classId];

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

    const result = await db.query(query, params);

    res.json({ tasks: result.rows });

  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Server error fetching tasks' });
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

    let query = `
      SELECT t.id, t.title, t.description, t.instructions, t.due_date, t.max_points,
             t.task_type, t.created_at, t.updated_at, t.grade_id, t.class_id,
             u.first_name as teacher_first_name, u.last_name as teacher_last_name,
             g.name as grade_name, c.name as class_name
      FROM tasks t
      JOIN users u ON t.created_by = u.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      WHERE t.id = $1 AND t.is_active = true
    `;

    const params = [id];

    const result = await db.query(query, params);

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
  body('task_type').isIn(['assignment', 'quiz']).withMessage('Task type must be assignment or quiz')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, instructions, due_date, max_points, grade_id, class_id, task_type } = req.body;
    const user = req.user;

    // Check if teacher has access to this grade/class
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, grade_id, class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied to this grade/class' });
      }
    }

    const result = await db.query(`
      INSERT INTO tasks (title, description, instructions, due_date, max_points, grade_id, class_id, created_by, task_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, title, description, instructions, due_date, max_points, grade_id, class_id, task_type, created_at
    `, [title, description, instructions, due_date, max_points || 100, grade_id, class_id, user.id, task_type]);

    res.status(201).json({
      message: 'Task created successfully',
      task: result.rows[0]
    });

  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Server error creating task' });
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

module.exports = router;
