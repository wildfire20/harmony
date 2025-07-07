const express = require('express');
const router = express.Router();

// Basic stub for analytics route
router.get('/', (req, res) => {
  res.json({ message: 'Analytics endpoint - coming soon' });
});

module.exports = router;
