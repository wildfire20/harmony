const express = require('express');
const router = express.Router();

// Basic stub for calendar route
router.get('/events', (req, res) => {
  res.json({ message: 'Calendar endpoint - coming soon' });
});

module.exports = router;
