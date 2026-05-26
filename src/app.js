const express = require('express');
const path = require('path');
const entriesRouter = require('./routes/entries');
const goalRouter = require('./routes/goal');
const todosRouter = require('./routes/todos');
const chatRouter = require('./routes/chat');
const projectsRouter = require('./routes/projects');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => res.sendFile(path.join(__dirname, '../public/health.html')));
app.get('/todo', (req, res) => res.sendFile(path.join(__dirname, '../public/todo.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, '../public/chat.html')));

app.use('/api/entries', entriesRouter);
app.use('/api/goal', goalRouter);
app.use('/api/todos', todosRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/chat', chatRouter);

module.exports = app;
