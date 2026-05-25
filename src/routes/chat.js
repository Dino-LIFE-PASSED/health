const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const chatsService = require('../services/chatsService');
const todosService = require('../services/todosService');
const dataService = require('../services/dataService');
const settingsService = require('../services/settingsService');

async function withRetry(fn, maxRetries = 4) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.includes('Service Unavailable');
      const is429 = err.message?.includes('429') || err.message?.includes('quota');
      if ((is503 || is429) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

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

// Settings
router.get('/settings', (req, res) => {
  res.json(settingsService.read());
});

router.put('/settings', (req, res) => {
  const { systemPrompt } = req.body;
  settingsService.write({ systemPrompt: systemPrompt || '' });
  res.json({ success: true });
});

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

  const { message, imageData, imageMimeType } = req.body;
  if (!message?.trim() && !imageData) return res.status(400).json({ error: 'message or image required' });

  const chats = chatsService.read();
  const idx = chats.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'session not found' });

  const session = chats[idx];

  // SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const today = new Date().toISOString().split('T')[0];

    const useSearch = !imageData && needsSearch(message || '');
    const { systemPrompt: customPrompt } = settingsService.read();
    const personality = customPrompt
      ? customPrompt + '\n\n'
      : 'You are a helpful personal assistant integrated with the user\'s Hub app.\n';
    const systemInstruction = personality
      + (useSearch ? '' : 'You have access to their todo list and weight tracking data via tools.\n')
      + `Today's date is ${today}.\n`
      + 'Be concise and friendly. When you add a todo or log weight, confirm what you did.\n'
      + 'When listing todos, show them with checkmarks for done items.\n'
      + 'Respond in the same language the user writes in.';

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: useSearch ? searchTools : functionTools,
      systemInstruction
    });

    const chat = model.startChat({ history: session.geminiHistory });

    const parts = [];
    if (imageData) parts.push({ inlineData: { mimeType: imageMimeType || 'image/jpeg', data: imageData } });
    if (message?.trim()) parts.push({ text: message.trim() });
    const msgPayload = parts.length === 1 && parts[0].text ? parts[0].text : parts;

    let fullText = '';

    // stream one round, collect full response for function-call inspection
    async function streamRound(payload) {
      const result = await withRetry(() => chat.sendMessageStream(payload));
      for await (const chunk of result.stream) {
        const t = chunk.text();
        if (t) { fullText += t; send({ chunk: t }); }
      }
      return await result.response;
    }

    let response = await streamRound(msgPayload);

    // function-call loop: tool rounds produce no visible text, so signal "thinking"
    while (response.functionCalls()?.length > 0) {
      send({ thinking: true });
      const calls = response.functionCalls();
      const toolResults = calls.map(call => ({
        functionResponse: { name: call.name, response: executeTool(call.name, call.args) }
      }));
      fullText = '';
      response = await streamRound(toolResults);
    }

    const now = new Date().toISOString();
    const userText = message?.trim() || '';

    session.messages.push({ role: 'user', content: userText, hasImage: !!imageData, ts: now });
    session.messages.push({ role: 'ai', content: fullText, ts: now });

    const rawHistory = await chat.getHistory();
    session.geminiHistory = rawHistory.map(h => ({
      ...h,
      parts: h.parts.map(p => p.inlineData ? { text: '[image]' } : p)
    }));
    session.updatedAt = now;

    const titleText = userText || 'Image';
    if (session.messages.length === 2) {
      session.title = titleText.length > 48 ? titleText.slice(0, 48) + '…' : titleText;
    }

    chats[idx] = session;
    chatsService.write(chats);

    send({ done: true, title: session.title });
    res.end();
  } catch (err) {
    console.error('Gemini error:', err.message);
    send({ error: err.message });
    res.end();
  }
});

module.exports = router;
