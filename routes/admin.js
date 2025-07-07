const express = require('express');
const router = express.Router();

// Basic stub for admin route
router.get('/students', (req, res) => {
  res.json({ message: 'Admin endpoint - coming soon' });
});

module.exports = router;
