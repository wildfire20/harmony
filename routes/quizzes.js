const express = require('express');
const router = express.Router();

// Basic stub for quizzes route
router.get('/', (req, res) => {
  res.json({ message: 'Quizzes endpoint - coming soon' });
});

module.exports = router;
