const express = require('express');
const router = express.Router();
const db = require('../services/dataService');

router.get('/', (req, res) => {
  const { entries } = db.read();
  res.json(entries.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

router.post('/', (req, res) => {
  const { date, weight } = req.body;
  if (!date || !weight) return res.status(400).json({ error: 'date and weight required' });

  const data = db.read();
  const idx = data.entries.findIndex(e => e.date === date);
  if (idx >= 0) {
    data.entries[idx].weight = parseFloat(weight);
  } else {
    data.entries.push({ date, weight: parseFloat(weight) });
  }
  db.write(data);
  res.json({ success: true });
});

router.delete('/:date', (req, res) => {
  const data = db.read();
  data.entries = data.entries.filter(e => e.date !== req.params.date);
  db.write(data);
  res.json({ success: true });
});

module.exports = router;
