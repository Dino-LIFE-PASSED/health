const express = require('express');
const path = require('path');
const entriesRouter = require('./routes/entries');
const goalRouter = require('./routes/goal');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => res.sendFile(path.join(__dirname, '../public/health.html')));

app.use('/api/entries', entriesRouter);
app.use('/api/goal', goalRouter);

module.exports = app;
