const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'chat-settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function read() {
  if (!fs.existsSync(SETTINGS_FILE)) return { systemPrompt: '' };
  return { systemPrompt: '', ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
}

function write(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

module.exports = { read, write };
