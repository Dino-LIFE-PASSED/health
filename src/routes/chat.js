const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const todosService = require('../services/todosService');
const dataService = require('../services/dataService');

const tools = [{
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

function executeTool(name, args) {
  if (name === 'get_todos') {
    return { todos: todosService.read() };
  }
  if (name === 'add_todo') {
    const todos = todosService.read();
    const todo = {
      id: Date.now().toString(),
      text: args.text.trim(),
      done: false,
      createdAt: new Date().toISOString()
    };
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
    if (idx >= 0) {
      data.entries[idx].weight = args.weight;
    } else {
      data.entries.push({ date: args.date, weight: args.weight });
    }
    dataService.write(data);
    return { success: true };
  }
  return { error: 'Unknown tool' };
}

router.post('/', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const today = new Date().toISOString().split('T')[0];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools,
      systemInstruction: `You are a helpful personal assistant integrated with the user's Hub app.
You have access to their todo list and weight tracking data via tools.
Today's date is ${today}.
Be concise and friendly. When you add a todo or log weight, always confirm what you did.
When listing todos, show them clearly with checkmarks for done items.
You can respond in the same language the user writes in.`
    });

    const chat = model.startChat({ history });
    let result = await chat.sendMessage(message);
    let response = result.response;

    while (response.functionCalls()?.length > 0) {
      const calls = response.functionCalls();
      const toolResults = calls.map(call => ({
        functionResponse: {
          name: call.name,
          response: executeTool(call.name, call.args)
        }
      }));
      result = await chat.sendMessage(toolResults);
      response = result.response;
    }

    res.json({ text: response.text(), history: await chat.getHistory() });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
