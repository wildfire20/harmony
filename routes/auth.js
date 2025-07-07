const express = require('express');
const router = express.Router();

// Basic stub for auth route
router.post('/login', (req, res) => {
  res.json({ message: 'Auth endpoint - coming soon' });
});

module.exports = router;
