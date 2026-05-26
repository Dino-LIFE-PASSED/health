const express = require('express');
const router = express.Router();
const db = require('../services/todosService');

router.get('/', (req, res) => {
  res.json(db.read());
});

router.post('/', (req, res) => {
  const { text, priority, dueDate, tags, projectId } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  const todos = db.read();
  const todo = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    text: text.trim(),
    done: false,
    priority: priority || '',
    dueDate: dueDate || '',
    tags: Array.isArray(tags) ? tags : [],
    projectId: projectId || '',
    createdAt: new Date().toISOString()
  };
  todos.push(todo);
  db.write(todos);
  res.json(todo);
});

router.patch('/:id', (req, res) => {
  const todos = db.read();
  const idx = todos.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const { done, text, priority, dueDate, tags, projectId } = req.body;
  if (done !== undefined) todos[idx].done = done;
  if (text !== undefined) todos[idx].text = text.trim();
  if (priority !== undefined) todos[idx].priority = priority;
  if (dueDate !== undefined) todos[idx].dueDate = dueDate;
  if (tags !== undefined) todos[idx].tags = Array.isArray(tags) ? tags : [];
  if (projectId !== undefined) todos[idx].projectId = projectId;
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
