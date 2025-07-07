const express = require('express');
const router = express.Router();

// Basic stub for users route
router.get('/', (req, res) => {
  res.json({ message: 'Users endpoint - coming soon' });
});

module.exports = router;
