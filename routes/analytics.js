const express = require('express');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Get analytics dashboard data
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { period = '30' } = req.query; // Default to last 30 days

    console.log('=== ANALYTICS DASHBOARD DEBUG ===');
    console.log('User:', JSON.stringify(user, null, 2));
    console.log('Period:', period);

    let analytics = {};

    // Common date filter
    const dateFilter = `AND created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'`;

    if (user.role === 'student') {
      // Student analytics - personal progress
      const studentAnalytics = await getStudentAnalytics(user.id, dateFilter);
      analytics = { ...studentAnalytics, role: 'student' };

    } else if (user.role === 'teacher') {
      // Teacher analytics - for their assigned classes
      const teacherAnalytics = await getTeacherAnalytics(user.id, dateFilter);
      analytics = { ...teacherAnalytics, role: 'teacher' };

    } else if (user.role === 'admin' || user.role === 'super_admin') {
      // Admin analytics - full platform overview
      const adminAnalytics = await getAdminAnalytics(dateFilter);
      analytics = { ...adminAnalytics, role: 'admin' };
    }

    res.json({
      success: true,
      analytics: analytics,
      period: parseInt(period)
    });

  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching analytics data' 
    });
  }
});

// Get student performance analytics (teachers and admins)
router.get('/student-performance', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const user = req.user;
    const { gradeId, classId, period = '30' } = req.query;

    let query = `
      SELECT 
        u.id, u.first_name, u.last_name, u.student_number,
        g.name as grade_name, c.name as class_name,
        COUNT(s.id) as total_submissions,
        COUNT(CASE WHEN s.status = 'graded' THEN 1 END) as graded_submissions,
        AVG(s.score) as average_score,
        COUNT(CASE WHEN s.submitted_at > t.due_date THEN 1 END) as late_submissions,
        COUNT(CASE WHEN s.submitted_at IS NULL AND t.due_date < CURRENT_DATE THEN 1 END) as missing_submissions
      FROM users u
      JOIN grades g ON u.grade_id = g.id
      JOIN classes c ON u.class_id = c.id
      LEFT JOIN submissions s ON u.id = s.student_id
      LEFT JOIN tasks t ON s.task_id = t.id
      WHERE u.role = 'student' AND u.is_active = true
    `;

    let params = [];
    let paramIndex = 1;

    // Filter by teacher assignments if user is teacher
    if (user.role === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $${paramIndex} 
        AND ta.grade_id = u.grade_id 
        AND ta.class_id = u.class_id
      )`;
      params.push(user.id);
      paramIndex++;
    }

    // Filter by specific grade/class if provided
    if (gradeId) {
      query += ` AND u.grade_id = $${paramIndex}`;
      params.push(parseInt(gradeId));
      paramIndex++;
    }

    if (classId) {
      query += ` AND u.class_id = $${paramIndex}`;
      params.push(parseInt(classId));
      paramIndex++;
    }

    // Add date filter
    if (period) {
      query += ` AND (s.created_at IS NULL OR s.created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days')`;
    }

    query += ` GROUP BY u.id, u.first_name, u.last_name, u.student_number, g.name, c.name
               ORDER BY u.grade_id, u.class_id, u.last_name, u.first_name`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      students: result.rows,
      period: parseInt(period)
    });

  } catch (error) {
    console.error('Student performance analytics error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching student performance data' 
    });
  }
});

// Get task/assignment analytics (teachers and admins)
router.get('/task-performance', [
  authenticate,
  authorize('teacher', 'admin', 'super_admin')
], async (req, res) => {
  try {
    const user = req.user;
    const { period = '30' } = req.query;

    let query = `
      SELECT 
        t.id, t.title, t.task_type, t.due_date, t.max_points,
        g.name as grade_name, c.name as class_name,
        u.first_name as teacher_first_name, u.last_name as teacher_last_name,
        COUNT(s.id) as total_submissions,
        COUNT(CASE WHEN s.status = 'graded' THEN 1 END) as graded_submissions,
        COUNT(CASE WHEN s.submitted_at <= t.due_date THEN 1 END) as on_time_submissions,
        COUNT(CASE WHEN s.submitted_at > t.due_date THEN 1 END) as late_submissions,
        AVG(s.score) as average_score,
        MIN(s.score) as min_score,
        MAX(s.score) as max_score,
        -- Count total students who should have submitted
        (SELECT COUNT(*) FROM users WHERE role = 'student' AND grade_id = t.grade_id AND class_id = t.class_id AND is_active = true) as total_students
      FROM tasks t
      JOIN users u ON t.created_by = u.id
      JOIN grades g ON t.grade_id = g.id
      JOIN classes c ON t.class_id = c.id
      LEFT JOIN submissions s ON t.id = s.task_id
      WHERE t.is_active = true
    `;

    let params = [];
    let paramIndex = 1;

    // Filter by teacher if user is teacher
    if (user.role === 'teacher') {
      query += ` AND (t.created_by = $${paramIndex} OR EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = $${paramIndex} 
        AND ta.grade_id = t.grade_id 
        AND ta.class_id = t.class_id
      ))`;
      params.push(user.id);
      paramIndex++;
    }

    // Add date filter
    if (period) {
      query += ` AND t.created_at >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'`;
    }

    query += ` GROUP BY t.id, t.title, t.task_type, t.due_date, t.max_points, g.name, c.name, u.first_name, u.last_name
               ORDER BY t.due_date DESC, t.created_at DESC`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      tasks: result.rows,
      period: parseInt(period)
    });

  } catch (error) {
    console.error('Task performance analytics error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error fetching task performance data' 
    });
  }
});

// Helper function for student analytics
async function getStudentAnalytics(studentId, dateFilter) {
  try {
    // Personal submission stats
    const submissionStats = await db.query(`
      SELECT 
        COUNT(*) as total_submissions,
        COUNT(CASE WHEN status = 'graded' THEN 1 END) as graded_submissions,
        AVG(score) as average_score,
        COUNT(CASE WHEN submitted_at > (SELECT due_date FROM tasks WHERE id = submissions.task_id) THEN 1 END) as late_submissions
      FROM submissions 
      WHERE student_id = $1 ${dateFilter.replace('created_at', 'submitted_at')}
    `, [studentId]);

    // Recent tasks
    const recentTasks = await db.query(`
      SELECT t.id, t.title, t.task_type, t.due_date, s.score, s.max_score, s.status
      FROM tasks t
      LEFT JOIN submissions s ON t.id = s.task_id AND s.student_id = $1
      WHERE t.is_active = true ${dateFilter.replace('created_at', 't.created_at')}
      ORDER BY t.due_date DESC
      LIMIT 10
    `, [studentId]);

    return {
      submission_stats: submissionStats.rows[0],
      recent_tasks: recentTasks.rows
    };
  } catch (error) {
    console.error('Student analytics error:', error);
    return {};
  }
}

// Helper function for teacher analytics
async function getTeacherAnalytics(teacherId, dateFilter) {
  try {
    // Tasks created by teacher
    const taskStats = await db.query(`
      SELECT 
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN task_type = 'assignment' THEN 1 END) as assignments,
        COUNT(CASE WHEN task_type = 'quiz' THEN 1 END) as quizzes
      FROM tasks 
      WHERE created_by = $1 AND is_active = true ${dateFilter}
    `, [teacherId]);

    // Submission stats for teacher's tasks
    const submissionStats = await db.query(`
      SELECT 
        COUNT(s.id) as total_submissions,
        COUNT(CASE WHEN s.status = 'graded' THEN 1 END) as graded_submissions,
        COUNT(CASE WHEN s.status = 'submitted' THEN 1 END) as pending_grading,
        AVG(s.score) as average_score
      FROM submissions s
      JOIN tasks t ON s.task_id = t.id
      WHERE t.created_by = $1 ${dateFilter.replace('created_at', 's.created_at')}
    `, [teacherId]);

    // Classes taught
    const classStats = await db.query(`
      SELECT 
        COUNT(DISTINCT ta.grade_id) as grades_taught,
        COUNT(DISTINCT ta.class_id) as classes_taught,
        COUNT(DISTINCT u.id) as total_students
      FROM teacher_assignments ta
      LEFT JOIN users u ON u.grade_id = ta.grade_id AND u.class_id = ta.class_id AND u.role = 'student'
      WHERE ta.teacher_id = $1
    `, [teacherId]);

    return {
      task_stats: taskStats.rows[0],
      submission_stats: submissionStats.rows[0],
      class_stats: classStats.rows[0]
    };
  } catch (error) {
    console.error('Teacher analytics error:', error);
    return {};
  }
}

// Helper function for admin analytics
async function getAdminAnalytics(dateFilter) {
  try {
    // Overall platform stats
    const platformStats = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'student' AND is_active = true) as total_students,
        (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND is_active = true) as total_teachers,
        (SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = true) as total_admins,
        (SELECT COUNT(*) FROM grades WHERE is_active = true) as total_grades,
        (SELECT COUNT(*) FROM classes WHERE is_active = true) as total_classes
    `);

    // Task and submission stats
    const contentStats = await db.query(`
      SELECT 
        COUNT(DISTINCT t.id) as total_tasks,
        COUNT(DISTINCT CASE WHEN t.task_type = 'assignment' THEN t.id END) as assignments,
        COUNT(DISTINCT CASE WHEN t.task_type = 'quiz' THEN t.id END) as quizzes,
        COUNT(s.id) as total_submissions,
        COUNT(CASE WHEN s.status = 'graded' THEN 1 END) as graded_submissions,
        AVG(s.score) as platform_average_score
      FROM tasks t
      LEFT JOIN submissions s ON t.id = s.task_id
      WHERE t.is_active = true ${dateFilter.replace('created_at', 't.created_at')}
    `);

    // Login activity (if we had a login_logs table)
    const activityStats = await db.query(`
      SELECT 
        COUNT(DISTINCT u.id) as active_users,
        COUNT(DISTINCT CASE WHEN u.role = 'student' THEN u.id END) as active_students,
        COUNT(DISTINCT CASE WHEN u.role = 'teacher' THEN u.id END) as active_teachers
      FROM users u
      WHERE u.is_active = true
    `);

    return {
      platform_stats: platformStats.rows[0],
      content_stats: contentStats.rows[0],
      activity_stats: activityStats.rows[0]
    };
  } catch (error) {
    console.error('Admin analytics error:', error);
    return {};
  }
}

module.exports = router;
