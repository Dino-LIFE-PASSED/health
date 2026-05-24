const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const chatsService = require('../services/chatsService');
const todosService = require('../services/todosService');
const dataService = require('../services/dataService');

const functionTools = [{
  functionDeclarations: [
    {
      name: 'get_todos',
      description: 'Get the current todo list with all tasks and their status',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'add_todo',
      description: 'Add a new task to the todo list',
      parameters: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING', description: 'The task description to add' }
        },
        required: ['text']
      }
    },
    {
      name: 'complete_todo',
      description: 'Mark a todo task as completed by its ID',
      parameters: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'The todo ID' }
        },
        required: ['id']
      }
    },
    {
      name: 'get_weight_history',
      description: 'Get weight tracking history and current goal weight',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'log_weight',
      description: 'Log a new weight entry for a specific date',
      parameters: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'Date in YYYY-MM-DD format' },
          weight: { type: 'NUMBER', description: 'Weight in kilograms' }
        },
        required: ['date', 'weight']
      }
    }
  ]
}];

const searchTools = [{ googleSearch: {} }];

function needsSearch(message) {
  return !/todo|task|weight|น้ำหนัก|เพิ่ม|บันทึก|ลบ|log|done|เสร็จ|check|งาน/i.test(message);
}

function executeTool(name, args) {
  if (name === 'get_todos') return { todos: todosService.read() };
  if (name === 'add_todo') {
    const todos = todosService.read();
    const todo = { id: Date.now().toString(), text: args.text.trim(), done: false, createdAt: new Date().toISOString() };
    todos.push(todo);
    todosService.write(todos);
    return { success: true, todo };
  }
  if (name === 'complete_todo') {
    const todos = todosService.read();
    const idx = todos.findIndex(t => t.id === args.id);
    if (idx < 0) return { error: 'Todo not found' };
    todos[idx].done = true;
    todosService.write(todos);
    return { success: true };
  }
  if (name === 'get_weight_history') {
    const data = dataService.read();
    return { entries: data.entries, goal: data.goal };
  }
  if (name === 'log_weight') {
    const data = dataService.read();
    const idx = data.entries.findIndex(e => e.date === args.date);
    if (idx >= 0) data.entries[idx].weight = args.weight;
    else data.entries.push({ date: args.date, weight: args.weight });
    dataService.write(data);
    return { success: true };
  }
  return { error: 'Unknown tool' };
}

// List sessions (lightweight)
router.get('/sessions', (req, res) => {
  const chats = chatsService.read();
  const list = chats
    .map(c => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      preview: c.messages[c.messages.length - 1]?.content?.slice(0, 60) || ''
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

// Create new session
router.post('/sessions', (req, res) => {
  const chats = chatsService.read();
  const session = {
    id: Date.now().toString(),
    title: 'New Chat',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    geminiHistory: []
  };
  chats.push(session);
  chatsService.write(chats);
  res.json(session);
});

// Get full session
router.get('/sessions/:id', (req, res) => {
  const session = chatsService.read().find(c => c.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  res.json(session);
});

// Delete session
router.delete('/sessions/:id', (req, res) => {
  chatsService.write(chatsService.read().filter(c => c.id !== req.params.id));
  res.json({ success: true });
});

// Send message in session
router.post('/sessions/:id/message', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  const chats = chatsService.read();
  const idx = chats.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'session not found' });

  const session = chats[idx];

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const today = new Date().toISOString().split('T')[0];

    const useSearch = needsSearch(message);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: useSearch ? searchTools : functionTools,
      systemInstruction: `You are a helpful personal assistant integrated with the user's Hub app.
${useSearch ? '' : 'You have access to their todo list and weight tracking data via tools.'}
Today's date is ${today}.
Be concise and friendly. When you add a todo or log weight, confirm what you did.
When listing todos, show them with checkmarks for done items.
Respond in the same language the user writes in.`
    });

    const chat = model.startChat({ history: session.geminiHistory });
    let result = await chat.sendMessage(message);
    let response = result.response;

    while (response.functionCalls()?.length > 0) {
      const calls = response.functionCalls();
      const toolResults = calls.map(call => ({
        functionResponse: { name: call.name, response: executeTool(call.name, call.args) }
      }));
      result = await chat.sendMessage(toolResults);
      response = result.response;
    }

    const aiText = response.text();
    const now = new Date().toISOString();

    session.messages.push({ role: 'user', content: message, ts: now });
    session.messages.push({ role: 'ai', content: aiText, ts: now });
    session.geminiHistory = await chat.getHistory();
    session.updatedAt = now;

    // Auto-title from first message
    if (session.messages.length === 2) {
      session.title = message.length > 48 ? message.slice(0, 48) + '…' : message;
    }

    chats[idx] = session;
    chatsService.write(chats);

    res.json({ text: aiText });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
