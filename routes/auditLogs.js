const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Friendly labels shown in the UI
const ACTION_LABELS = {
  manual_payment_add:         'Manual payment added',
  manual_payment_edit:        'Manual payment edited',
  manual_payment_delete:      'Manual payment deleted',
  manual_payment_arrears:     'Arrears payment applied (manual)',
  bank_statement_upload:      'Bank statement uploaded',
  invoice_generate:           'Invoices generated',
  invoice_delete:             'Invoice deleted',
  invoice_carry_forward:      'Arrears carried forward',
  manual_arrears_created:     'Manual arrears invoice created',
  payment_proof_approve:      'Payment proof approved',
  payment_proof_reject:       'Payment proof rejected',
  payment_proof_delete:       'Payment proof deleted',
  student_create:             'Student created',
  student_update:             'Student updated',
  student_delete:             'Student deleted',
  password_reset:             'Password reset',
};

// GET /api/audit-logs
router.get('/', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const {
      page      = 1,
      limit     = 50,
      action    = '',
      entityType = '',
      dateFrom  = '',
      dateTo    = '',
      search    = ''
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params     = [];
    let   p          = 1;

    if (action) {
      conditions.push(`a.action = $${p++}`);
      params.push(action);
    }
    if (entityType) {
      conditions.push(`a.entity_type = $${p++}`);
      params.push(entityType);
    }
    if (dateFrom) {
      conditions.push(`a.created_at >= $${p++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`a.created_at <= $${p++} + INTERVAL '1 day'`);
      params.push(dateTo);
    }
    if (search) {
      conditions.push(`(a.user_name ILIKE $${p} OR a.action ILIKE $${p} OR a.details::text ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM audit_logs a ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const logsResult = await db.query(
      `SELECT a.id, a.user_id, a.user_name, a.user_role, a.action, a.entity_type,
              a.entity_id, a.details, a.ip_address, a.created_at
       FROM audit_logs a
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${p} OFFSET $${p+1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      logs: logsResult.rows.map(r => ({
        ...r,
        action_label: ACTION_LABELS[r.action] || r.action,
        details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details
      })),
      pagination: {
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Audit logs fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: error.message });
  }
});

// GET /api/audit-logs/actions — distinct action types for the filter dropdown
router.get('/actions', [authenticate, authorize('admin', 'super_admin')], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action`
    );
    res.json({
      success: true,
      actions: result.rows.map(r => ({
        value: r.action,
        label: ACTION_LABELS[r.action] || r.action
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch actions' });
  }
});

module.exports = router;
