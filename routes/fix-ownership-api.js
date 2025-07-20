const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

// Fix announcement ownership for teachers
router.post('/fix-ownership', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    // Only allow teachers to fix their own announcements
    if (user.role !== 'teacher') {
      return res.status(403).json({ 
        message: 'Only teachers can use this ownership fix' 
      });
    }

    console.log(`🔧 Teacher ${user.id} (${user.email}) fixing announcement ownership...`);

    // First, check current state
    const currentState = await db.query(`
      SELECT id, title, created_by 
      FROM announcements 
      ORDER BY created_at DESC
    `);
    
    console.log('📢 Current announcements before fix:');
    currentState.rows.forEach(row => {
      console.log(`  ID: ${row.id}, Title: "${row.title}", Created by: "${row.created_by}"`);
    });

    // Update ALL announcements to be owned by the current teacher
    // This handles NULL values, empty values, and admin-owned announcements
    const result = await db.query(`
      UPDATE announcements 
      SET created_by = $1 
      WHERE created_by IS NULL OR created_by != $1 OR created_by = 1
      RETURNING id, title, created_by
    `, [user.id]);

    console.log(`✅ Fixed ownership of ${result.rows.length} announcements for teacher ${user.id}`);
    
    result.rows.forEach(row => {
      console.log(`  - ID: ${row.id}, Title: "${row.title}", Now owned by: ${row.created_by}`);
    });

    res.json({
      success: true,
      message: `Fixed ownership of ${result.rows.length} announcements`,
      updatedAnnouncements: result.rows
    });

  } catch (error) {
    console.error('❌ Error fixing announcement ownership:', error);
    res.status(500).json({ 
      message: 'Failed to fix announcement ownership',
      error: error.message 
    });
  }
});

module.exports = router;
