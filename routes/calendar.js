const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize, authorizeResourceAccess } = require('../middleware/auth');

const router = express.Router();

// Get calendar events for a user
router.get('/', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { month, year } = req.query;

    console.log('=== CALENDAR ENDPOINT DEBUG ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Query params:', { month, year });

    let events = [];

    // Get tasks/assignments deadlines
    let taskQuery = '';
    let taskParams = [];

    if (user.role === 'student') {
      taskQuery = `
        SELECT t.id, t.title, t.due_date, t.task_type, 'task' as event_type,
               g.name as grade_name, c.name as class_name
        FROM tasks t
        JOIN grades g ON t.grade_id = g.id
        JOIN classes c ON t.class_id = c.id
        WHERE t.grade_id = $1 AND t.class_id = $2 AND t.is_active = true
        AND t.due_date IS NOT NULL
      `;
      taskParams = [user.grade_id, user.class_id];
    } else if (user.role === 'teacher') {
      taskQuery = `
        SELECT t.id, t.title, t.due_date, t.task_type, 'task' as event_type,
               g.name as grade_name, c.name as class_name
        FROM tasks t
        JOIN grades g ON t.grade_id = g.id
        JOIN classes c ON t.class_id = c.id
        JOIN teacher_assignments ta ON t.grade_id = ta.grade_id AND t.class_id = ta.class_id
        WHERE ta.teacher_id = $1 AND t.is_active = true
        AND t.due_date IS NOT NULL
      `;
      taskParams = [user.id];
    } else if (user.role === 'admin' || user.role === 'super_admin') {
      taskQuery = `
        SELECT t.id, t.title, t.due_date, t.task_type, 'task' as event_type,
               g.name as grade_name, c.name as class_name
        FROM tasks t
        JOIN grades g ON t.grade_id = g.id
        JOIN classes c ON t.class_id = c.id
        WHERE t.is_active = true AND t.due_date IS NOT NULL
      `;
      taskParams = [];
    }

    // Add month/year filter if provided
    if (month && year) {
      const monthInt = parseInt(month);
      const yearInt = parseInt(year);
      taskQuery += ` AND EXTRACT(MONTH FROM t.due_date) = $${taskParams.length + 1} AND EXTRACT(YEAR FROM t.due_date) = $${taskParams.length + 2}`;
      taskParams.push(monthInt, yearInt);
    }

    const taskResult = await db.query(taskQuery, taskParams);
    events = events.concat(taskResult.rows);

    // Get school events
    let eventQuery = `
      SELECT id, title, description, start_date as due_date, end_date, 'school_event' as event_type,
             event_type as category, created_by
      FROM school_events
      WHERE is_active = true
    `;
    let eventParams = [];

    if (user.role === 'student') {
      eventQuery += ` AND (target_audience = 'all' OR target_audience = 'students' OR grade_id = $1)`;
      eventParams = [user.grade_id];
    } else if (user.role === 'teacher') {
      eventQuery += ` AND (target_audience = 'all' OR target_audience = 'teachers')`;
    }

    // Add month/year filter for events
    if (month && year) {
      const monthInt = parseInt(month);
      const yearInt = parseInt(year);
      eventQuery += ` AND EXTRACT(MONTH FROM start_date) = $${eventParams.length + 1} AND EXTRACT(YEAR FROM start_date) = $${eventParams.length + 2}`;
      eventParams.push(monthInt, yearInt);
    }

    try {
      const eventResult = await db.query(eventQuery, eventParams);
      events = events.concat(eventResult.rows);
      console.log('School events loaded:', eventResult.rows.length);
    } catch (error) {
      console.log('School events table may not exist yet, creating it...', error.message);
      // Try to create the table
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS school_events (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            start_date DATE NOT NULL,
            end_date DATE,
            event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('holiday', 'exam', 'meeting', 'deadline', 'other')),
            target_audience VARCHAR(50) NOT NULL CHECK (target_audience IN ('all', 'students', 'teachers', 'staff')),
            grade_id INTEGER REFERENCES grades(id),
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT true
          )
        `);
        console.log('School events table created successfully');
      } catch (createError) {
        console.error('Failed to create school events table:', createError);
      }
    }

    // Sort events by date
    events.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    res.json({
      success: true,
      events: events
    });

  } catch (error) {
    console.error('Calendar fetch error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching calendar events' 
    });
  }
});

// Create school event (admin only)
router.post('/events', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('title').notEmpty().withMessage('Title is required'),
  body('description').optional(),
  body('start_date').isISO8601().withMessage('Start date must be a valid date'),
  body('end_date').optional().isISO8601().withMessage('End date must be a valid date'),
  body('event_type').isIn(['holiday', 'exam', 'meeting', 'deadline', 'other']).withMessage('Invalid event type'),
  body('target_audience').isIn(['all', 'students', 'teachers', 'staff']).withMessage('Invalid target audience'),
  body('grade_id').optional().isInt().withMessage('Grade ID must be an integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Validation errors',
        errors: errors.array() 
      });
    }

    const { title, description, start_date, end_date, event_type, target_audience, grade_id } = req.body;
    const user = req.user;

    // Create school_events table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_events (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_date DATE NOT NULL,
        end_date DATE,
        event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('holiday', 'exam', 'meeting', 'deadline', 'other')),
        target_audience VARCHAR(50) NOT NULL CHECK (target_audience IN ('all', 'students', 'teachers', 'staff')),
        grade_id INTEGER REFERENCES grades(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `);

    const result = await db.query(`
      INSERT INTO school_events (title, description, start_date, end_date, event_type, target_audience, grade_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, title, description, start_date, end_date, event_type, target_audience, grade_id, created_at
    `, [title, description, start_date, end_date, event_type, target_audience, grade_id, user.id]);

    res.status(201).json({
      success: true,
      message: 'School event created successfully',
      event: result.rows[0]
    });

  } catch (error) {
    console.error('Create school event error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error creating school event' 
    });
  }
});

// Update school event (admin only)
router.put('/events/:id', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('title').optional().notEmpty().withMessage('Title cannot be empty'),
  body('description').optional(),
  body('start_date').optional().isISO8601().withMessage('Start date must be a valid date'),
  body('end_date').optional().isISO8601().withMessage('End date must be a valid date'),
  body('event_type').optional().isIn(['holiday', 'exam', 'meeting', 'deadline', 'other']).withMessage('Invalid event type'),
  body('target_audience').optional().isIn(['all', 'students', 'teachers', 'staff']).withMessage('Invalid target audience')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Validation errors',
        errors: errors.array() 
      });
    }

    const { id } = req.params;
    const updateFields = req.body;
    
    // Build dynamic update query
    const fields = Object.keys(updateFields);
    const values = Object.values(updateFields);
    const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    
    const result = await db.query(`
      UPDATE school_events 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${fields.length + 1}
      RETURNING *
    `, [...values, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'School event not found' 
      });
    }

    res.json({
      success: true,
      message: 'School event updated successfully',
      event: result.rows[0]
    });

  } catch (error) {
    console.error('Update school event error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error updating school event' 
    });
  }
});

// Delete school event (admin only)
router.delete('/events/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      UPDATE school_events 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'School event not found' 
      });
    }

    res.json({
      success: true,
      message: 'School event deleted successfully',
      event: result.rows[0]
    });

  } catch (error) {
    console.error('Delete school event error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error deleting school event' 
    });
  }
});

module.exports = router;
