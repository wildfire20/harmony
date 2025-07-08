const express = require('express');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Get all grades
router.get('/grades', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, description, is_active, created_at
      FROM grades
      WHERE is_active = true
      ORDER BY name
    `);

    res.json({ grades: result.rows });

  } catch (error) {
    console.error('Get grades error:', error);
    res.status(500).json({ message: 'Server error fetching grades' });
  }
});

// Get all classes
router.get('/classes', authenticate, async (req, res) => {
  try {
    const { grade_id } = req.query;
    
    let query = `
      SELECT c.id, c.name, c.grade_id, c.teacher_id, c.is_active, c.created_at,
             g.name as grade_name,
             u.first_name as teacher_first_name, u.last_name as teacher_last_name
      FROM classes c
      LEFT JOIN grades g ON c.grade_id = g.id
      LEFT JOIN users u ON c.teacher_id = u.id
      WHERE c.is_active = true
    `;
    
    const params = [];
    
    if (grade_id) {
      query += ' AND c.grade_id = $1';
      params.push(grade_id);
    }
    
    query += ' ORDER BY g.name, c.name';

    const result = await db.query(query, params);

    res.json({ classes: result.rows });

  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ message: 'Server error fetching classes' });
  }
});

// Get classes by grade
router.get('/grades/:gradeId/classes', authenticate, async (req, res) => {
  try {
    const { gradeId } = req.params;

    const result = await db.query(`
      SELECT c.id, c.name, c.grade_id, c.teacher_id, c.is_active, c.created_at,
             g.name as grade_name,
             u.first_name as teacher_first_name, u.last_name as teacher_last_name,
             COUNT(s.id) as student_count
      FROM classes c
      LEFT JOIN grades g ON c.grade_id = g.id
      LEFT JOIN users u ON c.teacher_id = u.id
      LEFT JOIN users s ON c.id = s.class_id AND s.role = 'student'
      WHERE c.grade_id = $1 AND c.is_active = true
      GROUP BY c.id, c.name, c.grade_id, c.teacher_id, c.is_active, c.created_at, g.name, u.first_name, u.last_name
      ORDER BY c.name
    `, [gradeId]);

    res.json({ classes: result.rows });

  } catch (error) {
    console.error('Get classes by grade error:', error);
    res.status(500).json({ message: 'Server error fetching classes' });
  }
});

// Get students in a class
router.get('/classes/:classId/students', authenticate, async (req, res) => {
  try {
    const { classId } = req.params;
    const user = req.user;

    // Check if user has access to this class
    if (user.role === 'student' && user.class_id != classId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments ta
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1 AND c.id = $2
      `, [user.id, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const result = await db.query(`
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, u.is_active,
             g.name as grade_name, c.name as class_name,
             COUNT(s.id) as submission_count,
             AVG(s.score) as average_score
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      LEFT JOIN submissions s ON u.id = s.student_id
      WHERE u.class_id = $1 AND u.role = 'student'
      GROUP BY u.id, u.student_number, u.first_name, u.last_name, u.email, u.is_active, g.name, c.name
      ORDER BY u.last_name, u.first_name
    `, [classId]);

    res.json({ students: result.rows });

  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).json({ message: 'Server error fetching class students' });
  }
});

// Create new grade (admin only)
router.post('/grades', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Grade name is required' });
    }

    const result = await db.query(`
      INSERT INTO grades (name, description)
      VALUES ($1, $2)
      RETURNING id, name, description, is_active, created_at
    `, [name, description]);

    res.status(201).json({
      message: 'Grade created successfully',
      grade: result.rows[0]
    });

  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ message: 'Grade name already exists' });
    }
    console.error('Create grade error:', error);
    res.status(500).json({ message: 'Server error creating grade' });
  }
});

// Create new class (admin only)
router.post('/classes', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { name, grade_id, teacher_id } = req.body;

    if (!name || !grade_id) {
      return res.status(400).json({ message: 'Class name and grade ID are required' });
    }

    const result = await db.query(`
      INSERT INTO classes (name, grade_id, teacher_id)
      VALUES ($1, $2, $3)
      RETURNING id, name, grade_id, teacher_id, is_active, created_at
    `, [name, grade_id, teacher_id || null]);

    res.status(201).json({
      message: 'Class created successfully',
      class: result.rows[0]
    });

  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ message: 'Class name already exists for this grade' });
    }
    console.error('Create class error:', error);
    res.status(500).json({ message: 'Server error creating class' });
  }
});

// Update class (admin only)
router.put('/classes/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { name, teacher_id, is_active } = req.body;

    const updateFields = [];
    const params = [];
    let paramCount = 0;

    if (name !== undefined) {
      paramCount++;
      updateFields.push(`name = $${paramCount}`);
      params.push(name);
    }

    if (teacher_id !== undefined) {
      paramCount++;
      updateFields.push(`teacher_id = $${paramCount}`);
      params.push(teacher_id);
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
    params.push(id);

    const result = await db.query(`
      UPDATE classes 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, name, grade_id, teacher_id, is_active, created_at
    `, params);

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

// Delete class (admin only)
router.delete('/classes/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;

    // Check if class has students
    const studentCheck = await db.query(`
      SELECT COUNT(*) as student_count FROM users WHERE class_id = $1 AND role = 'student'
    `, [id]);

    if (parseInt(studentCheck.rows[0].student_count) > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete class with students. Please reassign students first.' 
      });
    }

    const result = await db.query(`
      DELETE FROM classes 
      WHERE id = $1
      RETURNING id, name, grade_id
    `, [id]);

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

// Get specific class information by grade and class ID
router.get('/:gradeId/:classId', authenticate, async (req, res) => {
  try {
    const { gradeId, classId } = req.params;
    const user = req.user;

    // Check if user has access to this class
    if (user.role === 'student' && (user.grade_id != gradeId || user.class_id != classId)) {
      return res.status(403).json({ message: 'Access denied - you can only view your assigned class' });
    }

    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, gradeId, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ message: 'Access denied - you are not assigned to this class' });
      }
    }

    const result = await db.query(`
      SELECT c.id, c.name, c.grade_id, c.teacher_id, c.is_active, c.created_at,
             g.name as grade_name,
             u.first_name as teacher_first_name, u.last_name as teacher_last_name,
             COUNT(s.id) as student_count
      FROM classes c
      LEFT JOIN grades g ON c.grade_id = g.id
      LEFT JOIN users u ON c.teacher_id = u.id
      LEFT JOIN users s ON c.id = s.class_id AND s.role = 'student'
      WHERE c.grade_id = $1 AND c.id = $2 AND c.is_active = true
      GROUP BY c.id, c.name, c.grade_id, c.teacher_id, c.is_active, c.created_at, g.name, u.first_name, u.last_name
    `, [gradeId, classId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json({ class: result.rows[0] });

  } catch (error) {
    console.error('Get class info error:', error);
    res.status(500).json({ message: 'Server error fetching class information' });
  }
});

module.exports = router;
