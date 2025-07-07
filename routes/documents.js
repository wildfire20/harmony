const express = require('express');
const router = express.Router();

// Basic stub for documents route
router.get('/', (req, res) => {
  res.json({ message: 'Documents endpoint - coming soon' });
});

module.exports = router;
