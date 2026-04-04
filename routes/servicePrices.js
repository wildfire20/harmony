const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const requireAdmin = [authenticate, authorize('admin', 'super_admin')];

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
      const { service_key, amount, label, description } = item;
      if (!service_key || amount === undefined || amount === null) continue;
      if (parseFloat(amount) < 0) continue;

      const result = await db.query(`
        UPDATE service_prices
        SET amount = $1, label = COALESCE($2, label), description = COALESCE($3, description),
            updated_by = $4, updated_at = CURRENT_TIMESTAMP
        WHERE service_key = $5
        RETURNING *
      `, [parseFloat(amount).toFixed(2), label || null, description || null, req.user.id, service_key]);

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
    const { amount, label, description } = req.body;
    if (amount === undefined || parseFloat(amount) < 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    const result = await db.query(`
      UPDATE service_prices
      SET amount = $1, label = COALESCE($2, label), description = COALESCE($3, description),
          updated_by = $4, updated_at = CURRENT_TIMESTAMP
      WHERE service_key = $5
      RETURNING *
    `, [parseFloat(amount).toFixed(2), label || null, description || null, req.user.id, req.params.key]);

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
