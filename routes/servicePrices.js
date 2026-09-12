const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const requireAdmin = [authenticate, authorize('admin', 'super_admin')];
const BILLING_MODES = new Set(['standalone', 'bundle_component', 'informational']);
const KNOWN_SERVICE_KEYS = new Set(['tuition', 'boarding', 'transport', 'aftercare']);

function validateBillingMetadata({ billing_mode: billingMode, included_service_keys: includedKeys }) {
  if (billingMode !== undefined && !BILLING_MODES.has(billingMode)) {
    return 'billing_mode must be standalone, bundle_component, or informational';
  }
  if (includedKeys !== undefined && (
    !Array.isArray(includedKeys) ||
    includedKeys.length === 0 ||
    includedKeys.some((key) => typeof key !== 'string' || !key.trim() || !KNOWN_SERVICE_KEYS.has(key))
  )) {
    return 'included_service_keys must be a non-empty array of known service keys';
  }
  return null;
}

// ─── GET /api/service-prices  (admin + parent: read all prices) ───────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT sp.*, u.first_name AS updated_by_first_name, u.last_name AS updated_by_last_name
      FROM service_prices sp
      LEFT JOIN users u ON u.id = sp.updated_by
      ORDER BY sp.display_order ASC
    `);
    res.json({ prices: result.rows });
  } catch (err) {
    console.error('Get service prices error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── PUT /api/service-prices  (admin: bulk update prices) ────────────────────
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { prices } = req.body;
    if (!Array.isArray(prices) || prices.length === 0) {
      return res.status(400).json({ message: 'No prices provided' });
    }

    const updated = [];
    for (const item of prices) {
      const {
        service_key, amount, label, description, billing_group, bundle_key,
        included_service_keys, billing_mode,
      } = item;
      if (!service_key || amount === undefined || amount === null) continue;
      if (!Number.isFinite(Number(amount)) || Number(amount) < 0) continue;
      const metadataError = validateBillingMetadata(item);
      if (metadataError) return res.status(400).json({ message: metadataError });

      const result = await db.query(`
        UPDATE service_prices
        SET amount = $1, label = COALESCE($2, label), description = COALESCE($3, description),
            billing_group = COALESCE($4, billing_group),
            bundle_key = COALESCE($5, bundle_key),
            included_service_keys = COALESCE($6, included_service_keys),
            billing_mode = COALESCE($7, billing_mode),
            updated_by = $8, updated_at = CURRENT_TIMESTAMP
        WHERE service_key = $9
        RETURNING *
      `, [
        parseFloat(amount).toFixed(2), label || null, description || null,
        billing_group || null, bundle_key || null,
        Array.isArray(included_service_keys) ? JSON.stringify(included_service_keys) : null,
        billing_mode || null, req.user.id, service_key,
      ]);

      if (result.rows.length > 0) updated.push(result.rows[0]);
    }

    res.json({ message: 'Service prices updated successfully', updated });
  } catch (err) {
    console.error('Update service prices error:', err);
    res.status(500).json({ message: 'Server error updating prices' });
  }
});

// ─── PUT /api/service-prices/:key  (admin: update single price) ───────────────
router.put('/:key', requireAdmin, async (req, res) => {
  try {
    const {
      amount, label, description, billing_group, bundle_key,
      included_service_keys, billing_mode,
    } = req.body;
    if (amount === undefined || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }
    const metadataError = validateBillingMetadata(req.body);
    if (metadataError) return res.status(400).json({ message: metadataError });

    const result = await db.query(`
      UPDATE service_prices
      SET amount = $1, label = COALESCE($2, label), description = COALESCE($3, description),
          billing_group = COALESCE($4, billing_group),
          bundle_key = COALESCE($5, bundle_key),
          included_service_keys = COALESCE($6, included_service_keys),
          billing_mode = COALESCE($7, billing_mode),
          updated_by = $8, updated_at = CURRENT_TIMESTAMP
      WHERE service_key = $9
      RETURNING *
    `, [
      parseFloat(amount).toFixed(2), label || null, description || null,
      billing_group || null, bundle_key || null,
      Array.isArray(included_service_keys) ? JSON.stringify(included_service_keys) : null,
      billing_mode || null, req.user.id, req.params.key,
    ]);

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({ message: 'Price updated', price: result.rows[0] });
  } catch (err) {
    console.error('Update single price error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
