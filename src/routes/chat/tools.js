const todosService = require('../../services/todosService');
const projectsService = require('../../services/projectsService');
const dataService = require('../../services/dataService');

// ── Gemini tool declarations ──────────────────────────────────────────────────

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
          text: { type: 'STRING', description: 'The task description to add' },
          priority: { type: 'STRING', description: 'Priority level: high, medium, or low. Leave empty if not specified.' },
          dueDate: { type: 'STRING', description: 'Due date in YYYY-MM-DD format. Leave empty if not specified.' },
          tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'List of tags/categories for the task. Empty array if none.' },
          projectId: { type: 'STRING', description: 'Project ID to assign this task to. Call get_projects first to get valid IDs. Leave empty if no project.' }
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
      name: 'edit_todo',
      description: 'Edit an existing todo task — update its text, priority, due date, tags, or project by ID',
      parameters: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'The todo ID to edit' },
          text: { type: 'STRING', description: 'New task description' },
          priority: { type: 'STRING', description: 'New priority: high, medium, or low. Empty string to clear.' },
          dueDate: { type: 'STRING', description: 'New due date in YYYY-MM-DD format. Empty string to clear.' },
          tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'New list of tags. Empty array to clear.' },
          projectId: { type: 'STRING', description: 'Project ID to assign this task to. Empty string to remove from project.' }
        },
        required: ['id']
      }
    },
    {
      name: 'delete_todo',
      description: 'Delete a todo task permanently by its ID',
      parameters: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'The todo ID to delete' }
        },
        required: ['id']
      }
    },
    {
      name: 'get_projects',
      description: 'Get all projects with their ID, name, and color. Use this before assigning a projectId to a todo.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'create_project',
      description: 'Create a new project. Color is auto-assigned.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Project name' }
        },
        required: ['name']
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



// ── Tool routing ──────────────────────────────────────────────────────────────

function needsSearch(message) {
  const toolIntent = /todo|task|งาน|สิ่งที่ต้องทำ|รายการ|weight|น้ำหนัก|เพิ่ม|add|สร้าง|create|บันทึก|log|ลบ|delete|remove|เสร็จ|done|check|mark|แก้|edit|อัปเดต|update|remind|เตือน|วางแผน|plan|schedule|นัด/i;
  if (toolIntent.test(message)) return false;
  const searchIntent = /ราคา|price|weather|อากาศ|news|ข่าว|bitcoin|crypto|stock|หุ้น|คืออะไร|what is|how to|ทำยังไง|อัตรา|rate|forecast|พยากรณ์/i;
  return searchIntent.test(message);
}








// ── Tool execution ────────────────────────────────────────────────────────────

function executeTool(name, args) {
  if (name === 'get_todos') {
    const todos = todosService.read();
    const projects = projectsService.read();
    const active = todos.filter(t => !t.done).length;
    const allTags = [...new Set(todos.flatMap(t => t.tags || []))].sort();
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const todosWithProject = todos.map(t => ({ ...t, projectName: projectMap[t.projectId] || '' }));
    return { todos: todosWithProject, summary: `${todos.length} total, ${active} active, ${todos.length - active} done`, availableTags: allTags, availableProjects: projects.map(p => ({ id: p.id, name: p.name })) };
  }

  if (name === 'add_todo') {
    const todos = todosService.read();
    const dupText = args.text.trim().toLowerCase();
    const existing = todos.find(t => t.text.trim().toLowerCase() === dupText);
    if (existing) return { error: `Todo "${args.text}" already exists (id=${existing.id}). Do not add a duplicate.` };
    const todo = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      text: args.text.trim(),
      done: false,
      priority: args.priority || '',
      dueDate: args.dueDate || '',
      tags: Array.isArray(args.tags) ? args.tags : [],
      projectId: args.projectId || '',
      createdAt: new Date().toISOString()
    };
    todos.push(todo);
    todosService.write(todos);
    return { success: true, added: todo, verification: `Task "${todo.text}" now exists in list with id=${todo.id}` };
  }

  if (name === 'complete_todo') {
    const todos = todosService.read();
    const idx = todos.findIndex(t => t.id === args.id);
    if (idx < 0) return { error: `Todo id=${args.id} not found. Call get_todos first to get correct IDs.` };
    todos[idx].done = true;
    todosService.write(todos);
    return { success: true, completed: todos[idx], verification: `Task "${todos[idx].text}" is now marked done` };
  }

  if (name === 'edit_todo') {
    const todos = todosService.read();
    const idx = todos.findIndex(t => t.id === args.id);
    if (idx < 0) return { error: `Todo id=${args.id} not found. Call get_todos first to get correct IDs.` };
    const before = { ...todos[idx] };
    if (args.text !== undefined) todos[idx].text = args.text.trim();
    if (args.priority !== undefined) todos[idx].priority = args.priority;
    if (args.dueDate !== undefined) todos[idx].dueDate = args.dueDate;
    if (args.tags !== undefined) todos[idx].tags = Array.isArray(args.tags) ? args.tags : [];
    if (args.projectId !== undefined) todos[idx].projectId = args.projectId;
    todosService.write(todos);
    return { success: true, before, after: todos[idx], verification: `Task updated successfully` };
  }

  if (name === 'delete_todo') {
    const todos = todosService.read();
    const target = todos.find(t => t.id === args.id);
    if (!target) return { error: `Todo id=${args.id} not found. Call get_todos first to get correct IDs.` };
    todosService.write(todos.filter(t => t.id !== args.id));
    return { success: true, deleted: target, verification: `Task "${target.text}" has been permanently deleted` };
  }

  if (name === 'get_projects') {
    const projects = projectsService.read();
    return { projects, summary: `${projects.length} project(s)` };
  }

  if (name === 'create_project') {
    if (!args.name?.trim()) return { error: 'Project name is required.' };
    const PALETTE = ['#f97316','#22c55e','#3b82f6','#a855f7','#ef4444','#eab308','#06b6d4','#ec4899'];
    const projects = projectsService.read();
    const dup = projects.find(p => p.name.toLowerCase() === args.name.trim().toLowerCase());
    if (dup) return { error: `Project "${args.name}" already exists (id=${dup.id}).` };
    const project = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      name: args.name.trim(),
      color: PALETTE[projects.length % PALETTE.length],
      createdAt: new Date().toISOString()
    };
    projects.push(project);
    projectsService.write(projects);
    return { success: true, created: project, verification: `Project "${project.name}" created with id=${project.id}` };
  }

  if (name === 'get_weight_history') {
    const data = dataService.read();
    return { entries: data.entries, goal: data.goal };
  }

  if (name === 'log_weight') {
    const data = dataService.read();
    const idx = data.entries.findIndex(e => e.date === args.date);
    const isUpdate = idx >= 0;
    if (isUpdate) data.entries[idx].weight = args.weight;
    else data.entries.push({ date: args.date, weight: args.weight });
    dataService.write(data);
    return { success: true, action: isUpdate ? 'updated' : 'added', date: args.date, weight: args.weight };
  }

  return { error: 'Unknown tool' };
}

module.exports = { functionTools, searchTools, needsSearch, executeTool };
