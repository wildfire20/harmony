const express = require('express');
const router = express.Router();

// Basic stub for tasks route
router.get('/', (req, res) => {
  res.json({ message: 'Tasks endpoint - coming soon' });
});

module.exports = router;
