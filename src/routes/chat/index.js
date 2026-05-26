const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const chatsService = require('../../services/chatsService');
const settingsService = require('../../services/settingsService');
const { functionTools, searchTools, needsSearch, executeTool } = require('./tools');
const { buildSystemInstruction } = require('./systemPrompt');

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

  // SSE headers — flush immediately so client connects before Gemini is called
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const today = new Date().toISOString().split('T')[0];

    const useSearch = !imageData && needsSearch(message || '');
    console.log(`[chat] mode=${useSearch ? 'search' : 'tools'} msg="${(message || '').slice(0, 60)}"`);

    const { systemPrompt: customPrompt } = settingsService.read();
    const model = genAI.getGenerativeModel({
      model: useSearch ? 'gemini-2.5-flash' : 'gemini-2.5-pro',
      tools: useSearch ? searchTools : functionTools,
      systemInstruction: buildSystemInstruction(useSearch, customPrompt, today)
    });

    const chat = model.startChat({ history: session.geminiHistory });

    const parts = [];
    if (imageData) parts.push({ inlineData: { mimeType: imageMimeType || 'image/jpeg', data: imageData } });
    if (message?.trim()) parts.push({ text: message.trim() });
    const msgPayload = parts.length === 1 && parts[0].text ? parts[0].text : parts;

    let fullText = '';

    // stream one round; shouldStream=false suppresses text output (used for tool rounds)
    async function streamRound(payload, shouldStream = true) {
      fullText = '';
      const result = await withRetry(() => chat.sendMessageStream(payload));
      for await (const chunk of result.stream) {
        try {
          const t = chunk.text();
          if (t) { fullText += t; if (shouldStream) send({ chunk: t }); }
        } catch {
          // chunk contains function call parts, not text — skip
        }
      }
      return await result.response;
    }

    let response = await streamRound(msgPayload);

    // function-call loop
    let round = 0;
    let toolsUsed = false;
    while (response.functionCalls()?.length > 0 && round < 15) {
      if (!toolsUsed) {
        toolsUsed = true;
        if (fullText) { fullText = ''; send({ reset: true }); }
      }
      round++;
      send({ thinking: true });
      const calls = response.functionCalls();
      const toolResults = calls.map(call => {
        const result = executeTool(call.name, call.args);
        console.log(`[tool r${round}] ${call.name}`, JSON.stringify(call.args), '→', result.error ? `ERROR: ${result.error}` : 'ok');
        return { functionResponse: { name: call.name, response: result } };
      });
      response = await streamRound(toolResults, false);
    }

    if (toolsUsed && fullText) send({ chunk: fullText });

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
    send({ done: true, title: session.title });
    res.end();
    chatsService.write(chats);
  } catch (err) {
    console.error('[chat] error:', err?.message, err?.stack?.split('\n')[1]);
    try { send({ error: err?.message || 'Unknown error' }); } catch {}
    try { res.end(); } catch {}
  }
});

module.exports = router;
