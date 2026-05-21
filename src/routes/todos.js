const express = require('express');
const router = express.Router();
const db = require('../services/todosService');

router.get('/', (req, res) => {
  res.json(db.read());
});

router.post('/', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  const todos = db.read();
  const todo = { id: Date.now().toString(), text: text.trim(), done: false, createdAt: new Date().toISOString() };
  todos.push(todo);
  db.write(todos);
  res.json(todo);
});

router.patch('/:id', (req, res) => {
  const todos = db.read();
  const idx = todos.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  todos[idx].done = req.body.done ?? !todos[idx].done;
  db.write(todos);
  res.json(todos[idx]);
});

router.delete('/completed', (req, res) => {
  const todos = db.read().filter(t => !t.done);
  db.write(todos);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.write(db.read().filter(t => t.id !== req.params.id));
  res.json({ success: true });
});

module.exports = router;
