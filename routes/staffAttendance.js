const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// POST /api/staff-attendance/scan — PUBLIC (kiosk use)
router.post('/scan', async (req, res) => {
  try {
    const { card_id } = req.body;
    if (!card_id || !card_id.trim()) {
      return res.status(400).json({ success: false, message: 'No card ID received' });
    }

    const trimmed = card_id.trim();

    // Look up which staff member owns this card
    const cardResult = await db.query(
      `SELECT sc.user_id, u.first_name, u.last_name, u.role
       FROM staff_cards sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.card_id = $1 AND u.is_active = true`,
      [trimmed]
    );

    if (cardResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Card not recognised. Please contact the administrator.' });
    }

    const staff = cardResult.rows[0];
    const today = new Date().toISOString().split('T')[0];

    // Fetch today's log
    const logResult = await db.query(
      `SELECT id, time_in, time_out FROM staff_attendance_logs WHERE user_id = $1 AND log_date = $2`,
      [staff.user_id, today]
    );

    let action, message;

    if (logResult.rows.length === 0) {
      // First scan of the day — log Time In
      await db.query(
        `INSERT INTO staff_attendance_logs (user_id, log_date, time_in) VALUES ($1, $2, NOW())`,
        [staff.user_id, today]
      );
      action = 'in';
      message = `Welcome, ${staff.first_name} ${staff.last_name}!`;
    } else {
      const log = logResult.rows[0];
      if (!log.time_out) {
        // Second scan — log Time Out
        await db.query(
          `UPDATE staff_attendance_logs SET time_out = NOW() WHERE id = $1`,
          [log.id]
        );
        action = 'out';
        message = `Goodbye, ${staff.first_name} ${staff.last_name}!`;
      } else {
        // Already signed out — allow re-entry (overwrite time_out)
        await db.query(
          `UPDATE staff_attendance_logs SET time_out = NULL, time_in = NOW() WHERE id = $1`,
          [log.id]
        );
        action = 'in';
        message = `Welcome back, ${staff.first_name} ${staff.last_name}!`;
      }
    }

    return res.json({
      success: true,
      action,
      message,
      staff: {
        name: `${staff.first_name} ${staff.last_name}`,
        role: staff.role,
      },
    });
  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ success: false, message: 'Server error processing scan' });
  }
});

// GET /api/staff-attendance/today — Admin daily report
router.get('/today', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await db.query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.role,
         u.email,
         sc.card_id,
         sal.time_in,
         sal.time_out,
         CASE
           WHEN sal.time_in IS NOT NULL AND sal.time_out IS NULL THEN 'on-site'
           WHEN sal.time_in IS NOT NULL AND sal.time_out IS NOT NULL THEN 'signed-out'
           ELSE 'not-arrived'
         END AS status
       FROM users u
       LEFT JOIN staff_cards sc ON sc.user_id = u.id
       LEFT JOIN staff_attendance_logs sal ON sal.user_id = u.id AND sal.log_date = $1
       WHERE u.role IN ('teacher', 'admin', 'super_admin') AND u.is_active = true
       ORDER BY
         CASE
           WHEN sal.time_in IS NOT NULL AND sal.time_out IS NULL THEN 1
           WHEN sal.time_in IS NOT NULL AND sal.time_out IS NOT NULL THEN 2
           ELSE 3
         END,
         u.last_name, u.first_name`,
      [today]
    );

    const rows = result.rows;
    const onSite = rows.filter(r => r.status === 'on-site').length;
    const signedOut = rows.filter(r => r.status === 'signed-out').length;
    const notArrived = rows.filter(r => r.status === 'not-arrived').length;

    return res.json({
      success: true,
      date: today,
      summary: { on_site: onSite, signed_out: signedOut, not_arrived: notArrived, total: rows.length },
      staff: rows,
    });
  } catch (err) {
    console.error('Today report error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching report' });
  }
});

// GET /api/staff-attendance/cards — list all card assignments
router.get('/cards', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sc.id, sc.card_id, sc.assigned_at,
              u.id AS user_id, u.first_name, u.last_name, u.role, u.email
       FROM staff_cards sc
       JOIN users u ON u.id = sc.user_id
       ORDER BY u.last_name, u.first_name`
    );
    return res.json({ success: true, cards: result.rows });
  } catch (err) {
    console.error('List cards error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching cards' });
  }
});

// POST /api/staff-attendance/assign-card — assign or reassign a card
router.post('/assign-card', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const { user_id, card_id } = req.body;
    if (!user_id || !card_id || !card_id.trim()) {
      return res.status(400).json({ success: false, message: 'user_id and card_id are required' });
    }

    const trimmed = card_id.trim();

    // Check card not already assigned to someone else
    const conflict = await db.query(
      `SELECT sc.user_id, u.first_name, u.last_name FROM staff_cards sc JOIN users u ON u.id = sc.user_id WHERE sc.card_id = $1 AND sc.user_id != $2`,
      [trimmed, user_id]
    );
    if (conflict.rows.length > 0) {
      const c = conflict.rows[0];
      return res.status(409).json({
        success: false,
        message: `Card is already assigned to ${c.first_name} ${c.last_name}. Remove it first.`,
      });
    }

    // Upsert
    await db.query(
      `INSERT INTO staff_cards (card_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET card_id = EXCLUDED.card_id, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW()`,
      [trimmed, user_id, req.user.id]
    );

    return res.json({ success: true, message: 'Card assigned successfully' });
  } catch (err) {
    console.error('Assign card error:', err);
    return res.status(500).json({ success: false, message: 'Server error assigning card' });
  }
});

// DELETE /api/staff-attendance/cards/:userId — remove card from a staff member
router.delete('/cards/:userId', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const { userId } = req.params;
    await db.query(`DELETE FROM staff_cards WHERE user_id = $1`, [userId]);
    return res.json({ success: true, message: 'Card removed' });
  } catch (err) {
    console.error('Remove card error:', err);
    return res.status(500).json({ success: false, message: 'Server error removing card' });
  }
});

// GET /api/staff-attendance/unassigned — staff without a card
router.get('/unassigned', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.role, u.email
       FROM users u
       LEFT JOIN staff_cards sc ON sc.user_id = u.id
       WHERE u.role IN ('teacher', 'admin', 'super_admin') AND u.is_active = true AND sc.user_id IS NULL
       ORDER BY u.last_name, u.first_name`
    );
    return res.json({ success: true, staff: result.rows });
  } catch (err) {
    console.error('Unassigned error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
