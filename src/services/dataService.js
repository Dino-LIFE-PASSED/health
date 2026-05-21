const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function read() {
  if (!fs.existsSync(DATA_FILE)) return { entries: [], goal: null };
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  data.entries = data.entries.map(e => ({ ...e, weight: parseFloat(e.weight) }));
  return data;
}

function write(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

module.exports = { read, write };
