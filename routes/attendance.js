const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Submit class attendance (teachers only)
router.post('/submit', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin'),
  body('class_id').isInt().withMessage('Class ID is required'),
  body('grade_id').isInt().withMessage('Grade ID is required'),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('attendance').isArray().withMessage('Attendance array is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { class_id, grade_id, date, attendance } = req.body;
    const user = req.user;

    console.log('=== SUBMIT ATTENDANCE ===');
    console.log('Class:', class_id, 'Grade:', grade_id, 'Date:', date);
    console.log('Attendance records:', attendance.length);

    // Check if teacher has access to this class (skip for admin)
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, grade_id, class_id]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied. You are not assigned to this class.' 
        });
      }
    }

    // Get all students in this class for validation
    const studentsResult = await db.query(`
      SELECT id FROM users 
      WHERE role = 'student' AND grade_id = $1 AND class_id = $2 AND is_active = true
    `, [grade_id, class_id]);

    const validStudentIds = new Set(studentsResult.rows.map(s => s.id));

    // Begin transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing attendance for this class and date (to allow updates)
      await client.query(`
        DELETE FROM attendance 
        WHERE class_id = $1 AND date = $2
      `, [class_id, date]);

      // Insert all attendance records
      let insertedCount = 0;
      for (const record of attendance) {
        if (!validStudentIds.has(record.student_id)) {
          console.log('Skipping invalid student:', record.student_id);
          continue;
        }

        await client.query(`
          INSERT INTO attendance (student_id, class_id, grade_id, date, status, time_in, notes, recorded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          record.student_id,
          class_id,
          grade_id,
          date,
          record.status || 'present',
          record.status === 'late' ? new Date() : null,
          record.notes || null,
          user.id
        ]);
        insertedCount++;
      }

      await client.query('COMMIT');

      console.log('✅ Attendance submitted:', insertedCount, 'records');

      res.json({
        success: true,
        message: `Attendance recorded for ${insertedCount} students`,
        recorded_at: new Date().toISOString(),
        recorded_by: `${user.first_name} ${user.last_name}`
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Submit attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error submitting attendance' });
  }
});

// Get attendance for a class on a specific date
router.get('/class/:classId/:date', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { classId, date } = req.params;
    const user = req.user;

    // Get class info
    const classResult = await db.query(`
      SELECT c.id, c.name, c.grade_id, g.name as grade_name
      FROM classes c
      JOIN grades g ON c.grade_id = g.id
      WHERE c.id = $1
    `, [classId]);

    if (classResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    const classInfo = classResult.rows[0];

    // Check access for teachers
    if (user.role === 'teacher') {
      const assignmentCheck = await db.query(`
        SELECT 1 FROM teacher_assignments 
        WHERE teacher_id = $1 AND grade_id = $2 AND class_id = $3
      `, [user.id, classInfo.grade_id, classId]);

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied. You are not assigned to this class.' 
        });
      }
    }

    // Get all students in the class with their attendance status for the date
    const studentsResult = await db.query(`
      SELECT 
        u.id as student_id,
        u.student_number,
        u.first_name,
        u.last_name,
        COALESCE(a.status, 'present') as status,
        a.time_in,
        a.notes,
        a.recorded_at,
        a.recorded_by,
        ru.first_name as recorded_by_first_name,
        ru.last_name as recorded_by_last_name
      FROM users u
      LEFT JOIN attendance a ON u.id = a.student_id AND a.date = $2
      LEFT JOIN users ru ON a.recorded_by = ru.id
      WHERE u.role = 'student' AND u.grade_id = $3 AND u.class_id = $1 AND u.is_active = true
      ORDER BY u.last_name, u.first_name
    `, [classId, date, classInfo.grade_id]);

    // Check if attendance was already recorded for this date
    const recordedCheck = await db.query(`
      SELECT recorded_at, recorded_by, 
             u.first_name as recorded_by_first_name, 
             u.last_name as recorded_by_last_name
      FROM attendance a
      JOIN users u ON a.recorded_by = u.id
      WHERE a.class_id = $1 AND a.date = $2
      LIMIT 1
    `, [classId, date]);

    res.json({
      success: true,
      class_info: classInfo,
      date: date,
      students: studentsResult.rows,
      total_students: studentsResult.rows.length,
      already_recorded: recordedCheck.rows.length > 0,
      recorded_info: recordedCheck.rows[0] || null
    });

  } catch (error) {
    console.error('Get class attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching attendance' });
  }
});

// Get student attendance history (students can view own, teachers/admins can view all)
router.get('/student/:studentId', [
  authenticate,
  authorize('student', 'teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const { studentId } = req.params;
    const { start_date, end_date } = req.query;
    const user = req.user;

    // Students can only view their own attendance
    if (user.role === 'student' && user.id !== parseInt(studentId)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Get student info
    const studentResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number, 
             u.grade_id, u.class_id, g.name as grade_name, c.name as class_name
      FROM users u
      JOIN grades g ON u.grade_id = g.id
      JOIN classes c ON u.class_id = c.id
      WHERE u.id = $1 AND u.role = 'student'
    `, [studentId]);

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = studentResult.rows[0];

    // Build date filter
    let dateFilter = '';
    const params = [studentId];
    
    if (start_date) {
      params.push(start_date);
      dateFilter += ` AND a.date >= $${params.length}`;
    }
    if (end_date) {
      params.push(end_date);
      dateFilter += ` AND a.date <= $${params.length}`;
    }

    // Get attendance records
    const attendanceResult = await db.query(`
      SELECT a.date, a.status, a.time_in, a.notes, a.recorded_at,
             u.first_name as recorded_by_first_name, u.last_name as recorded_by_last_name
      FROM attendance a
      LEFT JOIN users u ON a.recorded_by = u.id
      WHERE a.student_id = $1 ${dateFilter}
      ORDER BY a.date DESC
    `, params);

    // Calculate statistics
    const stats = {
      total_days: attendanceResult.rows.length,
      present: attendanceResult.rows.filter(r => r.status === 'present').length,
      absent: attendanceResult.rows.filter(r => r.status === 'absent').length,
      late: attendanceResult.rows.filter(r => r.status === 'late').length,
      excused: attendanceResult.rows.filter(r => r.status === 'excused').length
    };
    stats.attendance_rate = stats.total_days > 0 
      ? Math.round(((stats.present + stats.late + stats.excused) / stats.total_days) * 100) 
      : 100;

    res.json({
      success: true,
      student: student,
      attendance: attendanceResult.rows,
      stats: stats
    });

  } catch (error) {
    console.error('Get student attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching student attendance' });
  }
});

// Get attendance statistics (admin view)
router.get('/stats', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { date, grade_id, class_id } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Build filters
    let gradeFilter = '';
    let classFilter = '';
    const params = [targetDate];

    if (grade_id) {
      params.push(grade_id);
      gradeFilter = ` AND a.grade_id = $${params.length}`;
    }
    if (class_id) {
      params.push(class_id);
      classFilter = ` AND a.class_id = $${params.length}`;
    }

    // Get overall stats for the date
    const overallStats = await db.query(`
      SELECT 
        COUNT(DISTINCT a.student_id) as total_recorded,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late,
        COUNT(CASE WHEN a.status = 'excused' THEN 1 END) as excused
      FROM attendance a
      WHERE a.date = $1 ${gradeFilter} ${classFilter}
    `, params);

    // Get total active students count
    let studentParams = [];
    let studentFilters = '';
    if (grade_id) {
      studentParams.push(grade_id);
      studentFilters += ` AND grade_id = $${studentParams.length}`;
    }
    if (class_id) {
      studentParams.push(class_id);
      studentFilters += ` AND class_id = $${studentParams.length}`;
    }

    const totalStudents = await db.query(`
      SELECT COUNT(*) as total
      FROM users 
      WHERE role = 'student' AND is_active = true ${studentFilters}
    `, studentParams);

    // Get stats by grade
    const gradeStats = await db.query(`
      SELECT 
        g.id as grade_id,
        g.name as grade_name,
        COUNT(DISTINCT a.student_id) as recorded,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late
      FROM grades g
      LEFT JOIN attendance a ON g.id = a.grade_id AND a.date = $1
      GROUP BY g.id, g.name
      ORDER BY g.name
    `, [targetDate]);

    // Get classes that haven't submitted attendance yet
    const missingClasses = await db.query(`
      SELECT c.id, c.name, g.name as grade_name
      FROM classes c
      JOIN grades g ON c.grade_id = g.id
      WHERE c.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM attendance a 
        WHERE a.class_id = c.id AND a.date = $1
      )
      ORDER BY g.name, c.name
    `, [targetDate]);

    res.json({
      success: true,
      date: targetDate,
      overall: {
        ...overallStats.rows[0],
        total_students: parseInt(totalStudents.rows[0].total)
      },
      by_grade: gradeStats.rows,
      missing_classes: missingClasses.rows
    });

  } catch (error) {
    console.error('Get attendance stats error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching attendance stats' });
  }
});

// Get late tracking report (habitually late students)
router.get('/late-report', [
  authenticate,
  authorize('admin', 'super_admin', 'teacher')
], async (req, res) => {
  try {
    const { days = 30, min_late_count = 3, grade_id, class_id } = req.query;
    const user = req.user;

    // Build filters
    let filters = '';
    const params = [days, min_late_count];

    if (user.role === 'teacher') {
      // Teachers can only see their assigned classes
      filters += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $${params.length + 1} 
        AND ta.grade_id = a.grade_id 
        AND ta.class_id = a.class_id
      )`;
      params.push(user.id);
    }

    if (grade_id) {
      params.push(grade_id);
      filters += ` AND a.grade_id = $${params.length}`;
    }
    if (class_id) {
      params.push(class_id);
      filters += ` AND a.class_id = $${params.length}`;
    }

    const lateReport = await db.query(`
      SELECT 
        u.id as student_id,
        u.student_number,
        u.first_name,
        u.last_name,
        g.name as grade_name,
        c.name as class_name,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_count,
        COUNT(*) as total_records,
        ARRAY_AGG(DISTINCT a.date ORDER BY a.date DESC) FILTER (WHERE a.status = 'late') as late_dates
      FROM users u
      JOIN grades g ON u.grade_id = g.id
      JOIN classes c ON u.class_id = c.id
      JOIN attendance a ON u.id = a.student_id
      WHERE u.role = 'student' 
        AND u.is_active = true
        AND a.date >= CURRENT_DATE - $1::integer ${filters}
      GROUP BY u.id, u.student_number, u.first_name, u.last_name, g.name, c.name
      HAVING COUNT(CASE WHEN a.status = 'late' THEN 1 END) >= $2
      ORDER BY late_count DESC, u.last_name, u.first_name
    `, params);

    res.json({
      success: true,
      period_days: parseInt(days),
      min_late_threshold: parseInt(min_late_count),
      students: lateReport.rows
    });

  } catch (error) {
    console.error('Get late report error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching late report' });
  }
});

// Get today's real-time attendance status (who is in school)
router.get('/today', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get overall counts
    const stats = await db.query(`
      SELECT 
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late,
        COUNT(CASE WHEN a.status = 'excused' THEN 1 END) as excused
      FROM attendance a
      WHERE a.date = $1
    `, [today]);

    // Get total students
    const totalStudents = await db.query(`
      SELECT COUNT(*) as total FROM users WHERE role = 'student' AND is_active = true
    `);

    // Get recently recorded attendance (last hour)
    const recentRecords = await db.query(`
      SELECT 
        u.first_name, u.last_name, u.student_number,
        g.name as grade_name, c.name as class_name,
        a.status, a.recorded_at
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      JOIN grades g ON a.grade_id = g.id
      JOIN classes c ON a.class_id = c.id
      WHERE a.date = $1 AND a.recorded_at >= NOW() - INTERVAL '1 hour'
      ORDER BY a.recorded_at DESC
      LIMIT 20
    `, [today]);

    const total = parseInt(totalStudents.rows[0].total);
    const recorded = parseInt(stats.rows[0].present) + 
                     parseInt(stats.rows[0].absent) + 
                     parseInt(stats.rows[0].late) + 
                     parseInt(stats.rows[0].excused);

    res.json({
      success: true,
      date: today,
      total_students: total,
      recorded: recorded,
      not_recorded: total - recorded,
      stats: stats.rows[0],
      recent_records: recentRecords.rows
    });

  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching today attendance' });
  }
});

module.exports = router;
