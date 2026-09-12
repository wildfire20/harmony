const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { isStudentPortalEnabled } = require('../config/features');
const {
  hashToken, randomToken, accessToken, setRefreshCookie, authenticateSession, revokeUserSessions, secureCookie,
  withTransaction, NORMAL_DAYS, REMEMBERED_DAYS,
} = require('../services/parentAuth');

const router = express.Router();

const logParentSession = (event, details = {}) => {
  console.info('Parent session lifecycle', {
    event,
    ...details,
  });
};

const createAuthLimiter = (max, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message },
});

const loginLimiter = createAuthLimiter(10, 'Too many login attempts. Please try again later.');

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      student_number: user.student_number 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRE || '12h' }
  );
};

// Student login
router.post('/login/student', loginLimiter, (req, res, next) => {
  if (!isStudentPortalEnabled()) {
    return res.status(403).json({ message: 'Student Portal access is currently unavailable.' });
  }
  next();
}, [
  body('student_number').notEmpty().withMessage('Student number is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { student_number, password } = req.body;

    // Find student by student number
    const result = await db.query(`
      SELECT u.id, u.student_number, u.email, u.password, u.first_name, u.last_name, 
             u.role, u.grade_id, u.class_id, u.is_active,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.student_number = $1 AND u.role = 'student'
    `, [student_number]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      message: 'Login successful',
      token,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Teacher/Admin login
router.post('/login/staff', loginLimiter, [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find staff member by email
    const result = await db.query(`
      SELECT u.id, u.student_number, u.email, u.password, u.first_name, u.last_name, 
             u.role, u.grade_id, u.class_id, u.is_active,
             g.name as grade_name, c.name as class_name
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.email = $1 AND u.role IN ('teacher', 'admin', 'super_admin')
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    // Get teacher assignments if user is a teacher
    let assignments = [];
    if (user.role === 'teacher') {
      const assignmentResult = await db.query(`
        SELECT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
      `, [user.id]);
      assignments = assignmentResult.rows;
    }

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      message: 'Login successful',
      token,
      user: { ...userWithoutPassword, assignments }
    });

  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get current user profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    // Get additional user information
    let additionalInfo = {};
    
    if (user.role === 'teacher') {
      const assignmentResult = await db.query(`
        SELECT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
      `, [user.id]);
      additionalInfo.assignments = assignmentResult.rows;
    }
    
    if (user.role === 'student') {
      // Get student's recent submissions
      const submissionResult = await db.query(`
        SELECT s.id, s.score, s.max_score, s.status, s.submitted_at, t.title as task_title
        FROM submissions s
        JOIN tasks t ON s.task_id = t.id
        WHERE s.student_id = $1
        ORDER BY s.submitted_at DESC
        LIMIT 5
      `, [user.id]);
      additionalInfo.recent_submissions = submissionResult.rows;
    }

    res.json({
      user: { ...user, ...additionalInfo }
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

// Change password
router.put('/change-password', [
  authenticate,
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    // Get current password hash
    const result = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Update password
    await db.query(
      'UPDATE users SET password = $1, password_changed_at=NOW(), auth_revoked_at=NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, userId]
    );
    await revokeUserSessions(userId);

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Server error changing password' });
  }
});

// ─── Parent login (phone number based) ───────────────────────────────────────
router.post('/login/parent', loginLimiter, [
  body('phone_number').notEmpty().withMessage('Phone number is required'),
  body('password').notEmpty().withMessage('Password is required'),
  body('rememberMe').optional().isBoolean().withMessage('rememberMe must be a boolean'),
  body('remember').optional().isBoolean().withMessage('remember must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const rawPhone = req.body.phone_number || '';
    const normalized = rawPhone.replace(/[\s\-().+]/g, '').replace(/^0/, '27');

    // Try both normalized and raw forms
    const result = await db.query(`
      SELECT u.id, u.phone_number, u.email, u.password, u.first_name, u.last_name,
             u.role, u.is_active, u.must_change_password
      FROM users u
      WHERE (u.phone_number = $1 OR u.phone_number = $2) AND u.role = 'parent'
      LIMIT 1
    `, [normalized, rawPhone]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Incorrect phone number or password' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated. Please contact the school.' });
    }

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect phone number or password' });
    }

    // Fetch all linked children
    const childrenResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number,
             g.name AS grade_name, c.name AS class_name
      FROM parent_students ps
      JOIN users u ON u.id = ps.student_id
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE ps.parent_id = $1
      ORDER BY g.name, u.last_name
    `, [user.id]);

    // `remember` remains accepted during rollout so an older cached frontend
    // cannot silently downgrade a requested persistent session.
    const rememberRequested = req.body.rememberMe === true || req.body.remember === true;
    const session = await authenticateSession(req, res, user, rememberRequested);
    logParentSession('login_cookie_issued', {
      rememberMe: rememberRequested,
      sessionType: rememberRequested ? 'remembered' : 'browser',
      persistentCookieAttempted: rememberRequested,
      secureRequest: session.refresh ? secureCookie(req) : false,
    });
    await db.query('UPDATE users SET last_login_at=NOW() WHERE id=$1 AND role=$2', [user.id, 'parent']);
    const token = session.token;
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      token,
      user: userWithoutPassword,
      children: childrenResult.rows,
      child: childrenResult.rows[0] || null,
      must_change_password: user.must_change_password || false,
      sessionMode: rememberRequested ? 'remembered' : 'browser',
    });

  } catch (error) {
    console.error('Parent login error:', error);
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(503).json({ message: 'Parent authentication is not yet available.' });
    }
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Logout (client-side token removal)
router.post('/logout', async (req, res) => {
  const raw = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('parent_refresh='));
  if (raw) {
    try {
      await db.query('UPDATE parent_sessions SET revoked_at=NOW(),last_used_at=NOW() WHERE refresh_token_hash=$1 AND revoked_at IS NULL',
        [hashToken(decodeURIComponent(raw.slice('parent_refresh='.length)))]);
    } catch (error) {
      if (error.code !== '42P01') console.error('Logout session revoke error:', error.message);
    }
  }
  res.clearCookie('parent_refresh', { path: '/api/auth' });
  res.json({ message: 'Logout successful' });
});

// Rotate a parent refresh token. Reuse of a rotated token revokes its family.
router.post('/refresh', async (req, res) => {
  let client;
  try {
    const pair = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('parent_refresh='));
    if (!pair) {
      logParentSession('refresh_rejected', { refreshRequestReceived: true, sessionFound: false, rejectionCategory: 'cookie_missing' });
      return res.status(401).json({ message: 'Session expired' });
    }
    const raw = decodeURIComponent(pair.slice('parent_refresh='.length));
    client = await db.pool.connect();
    await client.query('BEGIN');
    const found = await client.query(`SELECT s.id AS session_id, s.user_id AS session_user_id,
      s.refresh_token_hash, s.family_id, s.family_expires_at, s.expires_at, s.revoked_at, s.replaced_by_hash, s.created_at,
      (SELECT MIN(origin.created_at) FROM parent_sessions origin
       WHERE origin.family_id=s.family_id) AS family_created_at,
      u.id AS user_id, u.email, u.role, u.student_number, u.is_active, u.auth_revoked_at
      FROM parent_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.refresh_token_hash=$1 AND u.role='parent' AND u.is_active=true
        AND (u.auth_revoked_at IS NULL OR s.created_at > u.auth_revoked_at) FOR UPDATE`, [hashToken(raw)]);
    if (!found.rows.length) {
      await client.query('ROLLBACK'); client.release();
      logParentSession('refresh_rejected', { refreshRequestReceived: true, sessionFound: false, rejectionCategory: 'session_not_found' });
      return res.status(401).json({ message: 'Session expired' });
    }
    const old = found.rows[0];
    if (old.revoked_at || old.replaced_by_hash || new Date(old.expires_at) <= new Date()) {
      await client.query('UPDATE parent_sessions SET revoked_at=NOW() WHERE family_id=$1 AND revoked_at IS NULL', [old.family_id]);
      await client.query('COMMIT'); client.release();
      logParentSession('refresh_rejected', { refreshRequestReceived: true, sessionFound: true, rejectionCategory: 'expired_or_replayed' });
      return res.status(401).json({ message: 'Session expired' });
    }
    const familyRemaining = new Date(old.family_expires_at).getTime() - Date.now();
    if (familyRemaining <= 0) {
      await client.query('UPDATE parent_sessions SET revoked_at=NOW() WHERE family_id=$1', [old.family_id]);
      await client.query('COMMIT'); client.release();
      logParentSession('refresh_rejected', { refreshRequestReceived: true, sessionFound: true, rejectionCategory: 'family_expired' });
      return res.status(401).json({ message: 'Session expired' });
    }
    // Do not infer persistence from the remaining token TTL. A remembered
    // family can be near its 30-day boundary and a normal family can be
    // freshly rotated. The family origin is selected from the immutable
    // earliest row, rather than inferred from this row's rotation timestamp.
    const familyLifetime = new Date(old.family_expires_at).getTime() - new Date(old.family_created_at).getTime();
    const remember = familyLifetime > (NORMAL_DAYS + 1) * 86400000;
    const successor = randomToken();
    const inserted = await client.query(`INSERT INTO parent_sessions
      (user_id,refresh_token_hash,family_id,family_expires_at,expires_at,user_agent,ip_address)
      VALUES ($1,$2,$3,$4,LEAST($4,NOW()+($5 * INTERVAL '1 day')),$6,$7) RETURNING id`,
      [old.user_id, hashToken(successor), old.family_id, old.family_expires_at,
        remember ? REMEMBERED_DAYS : NORMAL_DAYS,
        req.get('user-agent') || null, req.ip || null]);
    const consumed = await client.query(`UPDATE parent_sessions SET revoked_at=NOW(),last_used_at=NOW(),replaced_by_hash=$1
      WHERE id=$2 AND revoked_at IS NULL AND replaced_by_hash IS NULL RETURNING id`,
      [hashToken(successor), old.session_id]);
    if (!consumed.rows.length) {
      await client.query('UPDATE parent_sessions SET revoked_at=NOW() WHERE family_id=$1', [old.family_id]);
      await client.query('COMMIT'); client.release();
      logParentSession('refresh_rejected', { refreshRequestReceived: true, sessionFound: true, rejectionCategory: 'rotation_conflict' });
      return res.status(401).json({ message: 'Session expired' });
    }
    await client.query('COMMIT'); client.release(); client = null;
    setRefreshCookie(req, res, successor,
      remember ? Math.max(1, Math.ceil(familyRemaining / 1000)) : undefined);
    logParentSession('refresh_rotated', {
      refreshRequestReceived: true,
      sessionFound: true,
      sessionType: remember ? 'remembered' : 'browser',
      persistentCookieAttempted: remember,
      rotationSuccess: true,
    });
    const refreshedUser = {
      id: old.user_id,
      email: old.email,
      role: old.role,
    };
    res.json({ token: accessToken(refreshedUser, inserted.rows[0].id), sessionMode: remember ? 'remembered' : 'browser' });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} client.release(); }
    console.error('Parent refresh error category:', error?.code || 'unclassified');
    logParentSession('refresh_rejected', { refreshRequestReceived: true, sessionFound: false, rejectionCategory: 'server_error' });
    res.status(401).json({ message: 'Session expired' });
  }
});

router.post('/forgot-password', loginLimiter, [body('email').optional().isEmail()], async (req, res) => {
  const safe = { message: 'If an account matches, password recovery instructions will be sent.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.json(safe);
    const result = await db.query(`SELECT id, first_name, email FROM users
      WHERE lower(email)=lower($1) AND role='parent' AND is_active=true LIMIT 1`, [email]);
    if (result.rows.length) {
      const { issueAuthToken, sendParentAuthEmail } = require('../services/parentAuth');
      const token = await issueAuthToken(result.rows[0].id, 'reset');
      await sendParentAuthEmail(email, token, 'reset', result.rows[0].first_name);
    }
    return res.json(safe);
  } catch (error) { console.error('Forgot password error:', error); return res.json(safe); }
});

router.post('/reset-password', [
  body('token').isString().isLength({ min: 20 }),
  body('new_password').isString().isLength({ min: 8 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const found = await db.query(`SELECT t.id, t.user_id FROM parent_auth_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=$1 AND t.token_type='reset' AND t.used_at IS NULL AND t.revoked_at IS NULL
      AND t.expires_at>NOW() AND u.role='parent' AND u.is_active=true`, [hashToken(req.body.token)]);
    if (!found.rows.length) return res.status(400).json({ message: 'Invalid or expired reset link' });
    const hashed = await bcrypt.hash(req.body.new_password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    await withTransaction(async (client) => {
      const consumed = await client.query(`UPDATE parent_auth_tokens SET used_at=NOW()
        WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() RETURNING user_id`, [found.rows[0].id]);
      if (!consumed.rows.length) throw Object.assign(new Error('used'), { status: 400 });
      await client.query('UPDATE users SET password=$1, must_change_password=false, password_changed_at=NOW(), auth_revoked_at=NOW() WHERE id=$2',
        [hashed, found.rows[0].user_id]);
      await client.query('UPDATE parent_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [found.rows[0].user_id]);
    });
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: 'Invalid or expired reset link' });
    console.error('Reset password error:', error); res.status(500).json({ message: 'Server error' });
  }
});

// Verify token
router.get('/verify', authenticate, async (req, res) => {
  try {
    let userData = { ...req.user };
    
    // Get teacher assignments if user is a teacher
    if (userData.role === 'teacher') {
      const assignmentResult = await db.query(`
        SELECT ta.grade_id, ta.class_id, g.name as grade_name, c.name as class_name
        FROM teacher_assignments ta
        JOIN grades g ON ta.grade_id = g.id
        JOIN classes c ON ta.class_id = c.id
        WHERE ta.teacher_id = $1
      `, [userData.id]);
      userData.assignments = assignmentResult.rows;
    }

    res.json({ 
      valid: true, 
      user: userData 
    });
  } catch (error) {
    console.error('Error fetching teacher assignments in verify:', error);
    res.json({ 
      valid: true, 
      user: req.user 
    });
  }
});

module.exports = router;
