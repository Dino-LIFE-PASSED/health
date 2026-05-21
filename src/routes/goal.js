const express = require('express');
const router = express.Router();
const db = require('../services/dataService');

router.get('/', (req, res) => {
  res.json({ goal: db.read().goal });
});

router.post('/', (req, res) => {
  const { goal } = req.body;
  const data = db.read();
  data.goal = parseFloat(goal);
  db.write(data);
  res.json({ success: true });
});

module.exports = router;
