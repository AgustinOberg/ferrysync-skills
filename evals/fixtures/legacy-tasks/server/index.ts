// A small REST backend, as an app that predates Ferry would have it. Integer ids, a bearer-token
// session table, no soft deletes, and an admin job that writes the table directly.
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';

const db = new Database('app.db');
db.run(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner TEXT NOT NULL)`);
db.run(`CREATE TABLE IF NOT EXISTS members (project_id INTEGER NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'editor')`);
db.run(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, assignee TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL)`);

const app = new Hono<{ Variables: { userId: string } }>();

app.use('/api/*', async (c, next) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '') ?? '';
  const row = db.query('SELECT user_id FROM sessions WHERE token = ?').get(token) as { user_id: string } | null;
  if (row === null) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', row.user_id);
  await next();
});

const canEdit = (userId: string, projectId: number) =>
  db.query(`SELECT 1 FROM members WHERE project_id = ? AND user_id = ? AND role = 'editor'`).get(projectId, userId) !== null;

app.get('/api/projects', (c) =>
  c.json(db.query('SELECT p.* FROM projects p JOIN members m ON m.project_id = p.id WHERE m.user_id = ?').all(c.get('userId'))),
);
app.get('/api/projects/:id/tasks', (c) => c.json(db.query('SELECT * FROM tasks WHERE project_id = ?').all(Number(c.req.param('id')))));
app.post('/api/projects/:id/tasks', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (!canEdit(c.get('userId'), projectId)) return c.json({ error: 'forbidden' }, 403);
  const { title } = await c.req.json<{ title: string }>();
  const result = db.run('INSERT INTO tasks (project_id, title) VALUES (?, ?)', [projectId, title]);
  return c.json({ id: result.lastInsertRowid }, 201);
});
app.patch('/api/tasks/:id', async (c) => {
  const { done } = await c.req.json<{ done: boolean }>();
  db.run('UPDATE tasks SET done = ? WHERE id = ?', [done ? 1 : 0, Number(c.req.param('id'))]);
  return c.json({ ok: true });
});
app.delete('/api/tasks/:id', (c) => {
  db.run('DELETE FROM tasks WHERE id = ?', [Number(c.req.param('id'))]);
  return c.json({ ok: true });
});

// Nightly job: archive finished tasks of closed projects by writing the table directly.
export const nightly = () => db.run(`DELETE FROM tasks WHERE done = 1 AND created_at < date('now', '-90 days')`);

export default { port: 3000, fetch: app.fetch };
