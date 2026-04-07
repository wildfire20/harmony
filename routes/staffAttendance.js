const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const STAFF_ROLES = `'teacher','admin','super_admin','non_teaching_staff'`;

const roleLabel = (role) => {
  if (role === 'non_teaching_staff') return 'Support Staff';
  if (role === 'super_admin') return 'Super Admin';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

const generatePassword = () => {
  const adj = ['Happy','Brave','Swift','Bright','Calm','Kind','Bold','Wise'];
  const nouns = ['Lion','Eagle','River','Stone','Tree','Star','Moon','Wind'];
  const num = Math.floor(10 + Math.random() * 90);
  return adj[Math.floor(Math.random() * adj.length)] + nouns[Math.floor(Math.random() * nouns.length)] + num;
};

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
       WHERE u.role IN ('teacher', 'admin', 'super_admin', 'non_teaching_staff') AND u.is_active = true
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

// GET /api/staff-attendance/all-staff — every active staff member (any card status)
router.get('/all-staff', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.role, u.job_title, u.email, sc.card_id
       FROM users u
       LEFT JOIN staff_cards sc ON sc.user_id = u.id
       WHERE u.role IN ('teacher', 'admin', 'super_admin', 'non_teaching_staff') AND u.is_active = true
       ORDER BY u.role, u.last_name, u.first_name`
    );
    return res.json({ success: true, staff: result.rows });
  } catch (err) {
    console.error('All-staff error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/staff-attendance/unassigned — staff without a card
router.get('/unassigned', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.role, u.email
       FROM users u
       LEFT JOIN staff_cards sc ON sc.user_id = u.id
       WHERE u.role IN ('teacher', 'admin', 'super_admin', 'non_teaching_staff') AND u.is_active = true AND sc.user_id IS NULL
       ORDER BY u.last_name, u.first_name`
    );
    return res.json({ success: true, staff: result.rows });
  } catch (err) {
    console.error('Unassigned error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/staff-attendance/export — weekly Excel export
router.get('/export', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'start_date and end_date are required' });
    }

    // Fetch all staff
    const staffResult = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.role, u.email, sc.card_id
       FROM users u
       LEFT JOIN staff_cards sc ON sc.user_id = u.id
       WHERE u.role IN ('teacher', 'admin', 'super_admin', 'non_teaching_staff') AND u.is_active = true
       ORDER BY u.last_name, u.first_name`
    );

    // Fetch all attendance logs in range
    const logsResult = await db.query(
      `SELECT user_id, log_date, time_in, time_out
       FROM staff_attendance_logs
       WHERE log_date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    // Build a lookup map: userId -> date -> log
    const logMap = {};
    for (const log of logsResult.rows) {
      const uid = log.user_id;
      const d = new Date(log.log_date).toISOString().split('T')[0];
      if (!logMap[uid]) logMap[uid] = {};
      logMap[uid][d] = log;
    }

    // Build list of days in range
    const days = [];
    const cursor = new Date(start_date);
    const end = new Date(end_date);
    while (cursor <= end) {
      days.push(new Date(cursor).toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }

    const fmtTime = (ts) => {
      if (!ts) return '';
      return new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const fmtDayHeader = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Harmony Learning Institute';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Staff Attendance', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    });

    // ── Title rows ──────────────────────────────────────────────────────────
    const totalCols = 4 + days.length * 2 + 2; // Name, Role, Card + day pairs + Days Present + Hours

    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell('A1');
    titleCell.value = 'HARMONY LEARNING INSTITUTE';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFDC2626' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.mergeCells(2, 1, 2, totalCols);
    const subtitleCell = ws.getCell('A2');
    subtitleCell.value = 'STAFF ATTENDANCE REPORT';
    subtitleCell.font = { bold: true, size: 13, color: { argb: 'FF1E40AF' } };
    subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 22;

    ws.mergeCells(3, 1, 3, totalCols);
    const rangeCell = ws.getCell('A3');
    const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    rangeCell.value = `Period: ${fmtDate(start_date)} — ${fmtDate(end_date)}`;
    rangeCell.font = { size: 11, italic: true };
    rangeCell.alignment = { horizontal: 'center' };
    ws.getRow(3).height = 18;

    ws.mergeCells(4, 1, 4, totalCols);
    ws.getCell('A4').value = `Generated: ${new Date().toLocaleString('en-ZA')}`;
    ws.getCell('A4').font = { size: 10, color: { argb: 'FF6B7280' } };
    ws.getCell('A4').alignment = { horizontal: 'center' };
    ws.getRow(4).height = 16;

    // ── Column headers ───────────────────────────────────────────────────────
    const HEADER_ROW = 6;
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const dayFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

    // Static columns: Name, Role, Card ID
    const staticHeaders = ['Name', 'Role', 'Card'];
    staticHeaders.forEach((h, i) => {
      const cell = ws.getCell(HEADER_ROW, i + 1);
      cell.value = h;
      cell.font = headerFont;
      cell.fill = headerFill;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });

    // Day columns (Time In / Time Out pair per day)
    let col = 4;
    for (const day of days) {
      // Merge header for the day
      ws.mergeCells(HEADER_ROW, col, HEADER_ROW, col + 1);
      const dayCell = ws.getCell(HEADER_ROW, col);
      dayCell.value = fmtDayHeader(day);
      dayCell.font = headerFont;
      dayCell.fill = dayFill;
      dayCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      col += 2;
    }

    // Summary columns
    ['Days\nPresent', 'Total\nHours'].forEach((h) => {
      const cell = ws.getCell(HEADER_ROW, col);
      cell.value = h;
      cell.font = headerFont;
      cell.fill = headerFill;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      col++;
    });
    ws.getRow(HEADER_ROW).height = 30;

    // Sub-headers row (In / Out for each day)
    const SUB_ROW = HEADER_ROW + 1;
    for (let i = 0; i < 3; i++) {
      const cell = ws.getCell(SUB_ROW, i + 1);
      cell.fill = headerFill;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      ws.mergeCells(HEADER_ROW, i + 1, SUB_ROW, i + 1); // merge static cols across both rows
    }

    col = 4;
    for (const day of days) {
      ['In', 'Out'].forEach((lbl) => {
        const cell = ws.getCell(SUB_ROW, col);
        cell.value = lbl;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.fill = dayFill;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        col++;
      });
    }
    ['', ''].forEach(() => {
      const cell = ws.getCell(SUB_ROW, col);
      cell.fill = headerFill;
      col++;
    });
    ws.getRow(SUB_ROW).height = 18;

    // ── Data rows ────────────────────────────────────────────────────────────
    const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    const redFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    const altFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    const thinBorder = { style: 'thin', color: { argb: 'FFE5E7EB' } };

    staffResult.rows.forEach((staff, idx) => {
      const dataRow = SUB_ROW + 1 + idx;
      const rowBg = idx % 2 === 0
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
        : altFill;

      // Name
      const nameCell = ws.getCell(dataRow, 1);
      nameCell.value = `${staff.first_name} ${staff.last_name}`;
      nameCell.font = { bold: true, size: 10 };
      nameCell.fill = rowBg;
      nameCell.border = { right: thinBorder, bottom: thinBorder };

      // Role
      const roleCell = ws.getCell(dataRow, 2);
      roleCell.value = roleLabel(staff.role);
      roleCell.font = { size: 10 };
      roleCell.fill = rowBg;
      roleCell.alignment = { horizontal: 'center' };
      roleCell.border = { right: thinBorder, bottom: thinBorder };

      // Card
      const cardCell = ws.getCell(dataRow, 3);
      cardCell.value = staff.card_id || '—';
      cardCell.font = { size: 9, italic: !staff.card_id };
      cardCell.fill = rowBg;
      cardCell.alignment = { horizontal: 'center' };
      cardCell.border = { right: thinBorder, bottom: thinBorder };

      let daysPresent = 0;
      let totalMinutes = 0;
      col = 4;

      for (const day of days) {
        const log = (logMap[staff.id] || {})[day];
        const inCell  = ws.getCell(dataRow, col);
        const outCell = ws.getCell(dataRow, col + 1);

        if (log && log.time_in) {
          daysPresent++;
          inCell.value  = fmtTime(log.time_in);
          outCell.value = log.time_out ? fmtTime(log.time_out) : 'On site';
          inCell.fill  = greenFill;
          outCell.fill = greenFill;

          if (log.time_out) {
            const mins = (new Date(log.time_out) - new Date(log.time_in)) / 60000;
            if (mins > 0) totalMinutes += mins;
          }
        } else {
          inCell.fill  = redFill;
          outCell.fill = redFill;
        }

        [inCell, outCell].forEach(c => {
          c.font = { size: 9 };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = { right: thinBorder, bottom: thinBorder };
        });
        col += 2;
      }

      // Days Present
      const dpCell = ws.getCell(dataRow, col);
      dpCell.value = daysPresent;
      dpCell.font = { bold: true, size: 10 };
      dpCell.fill = daysPresent === days.length
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22C55E' }, ...{ font: { color: { argb: 'FFFFFFFF' } } } }
        : rowBg;
      dpCell.alignment = { horizontal: 'center' };
      dpCell.border = { right: thinBorder, bottom: thinBorder };
      col++;

      // Total Hours
      const hoursCell = ws.getCell(dataRow, col);
      hoursCell.value = totalMinutes > 0 ? `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m` : '—';
      hoursCell.font = { size: 10 };
      hoursCell.fill = rowBg;
      hoursCell.alignment = { horizontal: 'center' };
      hoursCell.border = { bottom: thinBorder };
    });

    // ── Column widths ────────────────────────────────────────────────────────
    ws.getColumn(1).width = 22; // Name
    ws.getColumn(2).width = 12; // Role
    ws.getColumn(3).width = 14; // Card
    for (let i = 0; i < days.length * 2; i++) {
      ws.getColumn(4 + i).width = 8;
    }
    ws.getColumn(4 + days.length * 2).width = 10;     // Days Present
    ws.getColumn(4 + days.length * 2 + 1).width = 12; // Total Hours

    // ── Summary footer ───────────────────────────────────────────────────────
    const footerRow = SUB_ROW + 1 + staffResult.rows.length + 1;
    ws.mergeCells(footerRow, 1, footerRow, totalCols);
    const footerCell = ws.getCell(footerRow, 1);
    footerCell.value = `Total Staff: ${staffResult.rows.length}  |  Days in Period: ${days.length}  |  Green = Present  |  Red = Absent`;
    footerCell.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
    footerCell.alignment = { horizontal: 'center' };

    // Freeze header rows
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: SUB_ROW, activeCell: 'D8' }];

    // ── Stream response ──────────────────────────────────────────────────────
    const safeStart = start_date.replace(/-/g, '');
    const safeEnd   = end_date.replace(/-/g, '');
    const filename  = `Staff_Attendance_${safeStart}_to_${safeEnd}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Server error generating export' });
    }
  }
});

// ─── Non-Teaching Staff Management ───────────────────────────────────────────

// GET /api/staff-attendance/non-teaching — list all non-teaching staff
router.get('/non-teaching', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.job_title, u.phone_number, u.email, u.is_active,
              sc.card_id, u.created_at
       FROM users u
       LEFT JOIN staff_cards sc ON sc.user_id = u.id
       WHERE u.role = 'non_teaching_staff'
       ORDER BY u.is_active DESC, u.last_name, u.first_name`
    );
    return res.json({ success: true, staff: result.rows });
  } catch (err) {
    console.error('Non-teaching list error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/staff-attendance/non-teaching — create a non-teaching staff member
router.post('/non-teaching', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const { first_name, last_name, job_title, phone_number, email } = req.body;
    if (!first_name || !last_name || !job_title) {
      return res.status(400).json({ success: false, message: 'First name, last name, and job title are required' });
    }

    // Check email uniqueness if provided
    if (email) {
      const emailCheck = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'A user with this email already exists' });
      }
    }

    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Build a unique username-style email if none provided
    const resolvedEmail = email
      ? email.toLowerCase().trim()
      : `${first_name.toLowerCase()}.${last_name.toLowerCase()}.${Date.now()}@staff.harmonylearning.internal`;

    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, password, role, job_title, phone_number, is_active)
       VALUES ($1, $2, $3, $4, 'non_teaching_staff', $5, $6, true)
       RETURNING id, first_name, last_name, job_title, phone_number, email, is_active, created_at`,
      [first_name.trim(), last_name.trim(), resolvedEmail, hashedPassword, job_title.trim(), phone_number || null]
    );

    return res.json({
      success: true,
      message: `${first_name} ${last_name} created successfully`,
      staff: result.rows[0],
      temp_password: plainPassword,
    });
  } catch (err) {
    console.error('Create non-teaching staff error:', err);
    return res.status(500).json({ success: false, message: 'Server error creating staff member' });
  }
});

// PUT /api/staff-attendance/non-teaching/:id — update a non-teaching staff member
router.put('/non-teaching/:id', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, job_title, phone_number, email } = req.body;
    if (!first_name || !last_name || !job_title) {
      return res.status(400).json({ success: false, message: 'First name, last name, and job title are required' });
    }

    // Verify target is non_teaching_staff
    const check = await db.query(`SELECT id FROM users WHERE id=$1 AND role='non_teaching_staff'`, [id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: 'Staff member not found' });

    const result = await db.query(
      `UPDATE users SET first_name=$1, last_name=$2, job_title=$3, phone_number=$4, updated_at=CURRENT_TIMESTAMP
       WHERE id=$5
       RETURNING id, first_name, last_name, job_title, phone_number, email, is_active`,
      [first_name.trim(), last_name.trim(), job_title.trim(), phone_number || null, id]
    );
    return res.json({ success: true, message: 'Staff member updated', staff: result.rows[0] });
  } catch (err) {
    console.error('Update non-teaching staff error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PATCH /api/staff-attendance/non-teaching/:id/toggle — activate/deactivate
router.patch('/non-teaching/:id/toggle', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const { id } = req.params;
    const check = await db.query(`SELECT id, is_active FROM users WHERE id=$1 AND role='non_teaching_staff'`, [id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: 'Staff member not found' });

    const newActive = !check.rows[0].is_active;
    await db.query(`UPDATE users SET is_active=$1 WHERE id=$2`, [newActive, id]);
    return res.json({ success: true, is_active: newActive, message: newActive ? 'Staff member activated' : 'Staff member deactivated' });
  } catch (err) {
    console.error('Toggle non-teaching staff error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
