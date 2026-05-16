const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json());
app.use(express.static('public'));

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { entries: [], goal: null };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/entries', (req, res) => {
  const data = readData();
  res.json(data.entries.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

app.post('/api/entries', (req, res) => {
  const { date, weight } = req.body;
  if (!date || !weight) return res.status(400).json({ error: 'date and weight required' });

  const data = readData();
  const existing = data.entries.findIndex(e => e.date === date);
  if (existing >= 0) {
    data.entries[existing].weight = weight;
  } else {
    data.entries.push({ date, weight: parseFloat(weight) });
  }
  writeData(data);
  res.json({ success: true });
});

app.delete('/api/entries/:date', (req, res) => {
  const data = readData();
  data.entries = data.entries.filter(e => e.date !== req.params.date);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/goal', (req, res) => {
  res.json({ goal: readData().goal });
});

app.post('/api/goal', (req, res) => {
  const { goal } = req.body;
  const data = readData();
  data.goal = parseFloat(goal);
  writeData(data);
  res.json({ success: true });
});

app.listen(3001, '::', () => console.log('Server running on port 3001'));
