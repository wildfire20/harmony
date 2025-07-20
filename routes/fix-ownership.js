const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

// Fix announcement ownership endpoint (admin only)
router.post('/fix-announcement-ownership', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    console.log('🔧 Fixing announcement ownership...');
    
    // Find the teacher "ove ove"
    const teacherResult = await db.query(`
      SELECT id, first_name, last_name, email 
      FROM users 
      WHERE role = 'teacher' 
      AND LOWER(first_name) = 'ove' 
      AND LOWER(last_name) = 'ove'
    `);
    
    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Teacher "ove ove" not found' });
    }
    
    const teacher = teacherResult.rows[0];
    console.log(`✅ Found teacher: ${teacher.first_name} ${teacher.last_name} (ID: ${teacher.id})`);
    
    // Get all announcements
    const announcementsResult = await db.query(`
      SELECT a.id, a.title, a.created_by, u.first_name, u.last_name
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY a.created_at DESC
    `);
    
    // Find announcements that need ownership fix
    // Assuming the visible announcements in the screenshot should belong to "ove ove"
    const announcementsToFix = announcementsResult.rows.filter(ann => 
      ann.created_by !== teacher.id && 
      ann.created_by === 1 // Based on debug info showing ID: 1
    );
    
    let fixedCount = 0;
    
    if (announcementsToFix.length > 0) {
      console.log(`🔧 Fixing ownership of ${announcementsToFix.length} announcements...`);
      
      for (const ann of announcementsToFix) {
        await db.query(`
          UPDATE announcements 
          SET created_by = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [teacher.id, ann.id]);
        
        console.log(`✅ Fixed: "${ann.title}" (ID: ${ann.id}) now owned by user ${teacher.id}`);
        fixedCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Fixed ownership of ${fixedCount} announcements`,
      teacherId: teacher.id,
      fixedCount
    });
    
  } catch (error) {
    console.error('Error fixing ownership:', error);
    res.status(500).json({ success: false, message: 'Error fixing ownership' });
  }
});

module.exports = router;
