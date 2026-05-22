const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function read() {
  if (!fs.existsSync(CHATS_FILE)) return [];
  return JSON.parse(fs.readFileSync(CHATS_FILE, 'utf-8'));
}

function write(chats) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
}

module.exports = { read, write };
