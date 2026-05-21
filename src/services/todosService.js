const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function read() {
  if (!fs.existsSync(TODOS_FILE)) return [];
  return JSON.parse(fs.readFileSync(TODOS_FILE, 'utf-8'));
}

function write(todos) {
  fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}

module.exports = { read, write };
