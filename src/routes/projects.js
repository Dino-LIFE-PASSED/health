const express = require('express');
const router = express.Router();
const projectsService = require('../services/projectsService');
const todosService = require('../services/todosService');

const PALETTE = ['#f97316','#22c55e','#3b82f6','#a855f7','#ef4444','#eab308','#06b6d4','#ec4899'];

router.get('/', (req, res) => res.json(projectsService.read()));

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const projects = projectsService.read();
  const project = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    color: PALETTE[projects.length % PALETTE.length],
    createdAt: new Date().toISOString()
  };
  projects.push(project);
  projectsService.write(projects);
  res.json(project);
});

router.patch('/:id', (req, res) => {
  const projects = projectsService.read();
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const { name, color } = req.body;
  if (name !== undefined) projects[idx].name = name.trim();
  if (color !== undefined) projects[idx].color = color;
  projectsService.write(projects);
  res.json(projects[idx]);
});

router.delete('/:id', (req, res) => {
  projectsService.write(projectsService.read().filter(p => p.id !== req.params.id));
  const todos = todosService.read();
  todosService.write(todos.map(t => t.projectId === req.params.id ? { ...t, projectId: '' } : t));
  res.json({ success: true });
});

module.exports = router;
