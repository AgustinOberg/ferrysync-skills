// Fixture for the security-review eval: an integration with planted problems. Do not "fix" it
// in the fixture; the eval checks that a review finds them.
import { createSyncServer, nodePostgres, postgresStore } from 'ferrysync/server';
import { Hono } from 'hono';
import { Pool } from 'pg';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: postgresStore(nodePostgres(new Pool({ connectionString: process.env.DATABASE_URL }))),
  // PLANTED 1: falls back to a shared user when the header is missing or wrong.
  auth: async (request) => {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    return (token && (await lookup(token))) || 'guest';
  },
  // PLANTED 2: anyone can found any empty space, for any table.
  claimSpace: () => true,
  tables: {
    tasks: {
      // PLANTED 3: a role rule enforced by throwing.
      validate: async ({ after, actor }) => {
        if (after !== null && actor.type === 'user' && !(await isEditor(actor.userId, after.projectId))) {
          throw new Error('read only');
        }
      },
    },
  },
});

const app = new Hono();
app.all('/api/sync/*', (c) => syncServer.fetch(c.req.raw));

// PLANTED 4: a public webhook writes as the server from request input, with no verification.
app.post('/webhooks/import', async (c) => {
  const { projectId, title } = await c.req.json<{ projectId: string; title: string }>();
  await syncServer.write({ as: 'system' }, (tx) => tx.tasks.create({ projectId, title }));
  return c.json({ ok: true });
});

// PLANTED 5: adds any user to any project, authorized by nothing.
app.post('/projects/:id/members', async (c) => {
  const { userId } = await c.req.json<{ userId: string }>();
  await syncServer.spaces.addMember(userId, `project:${c.req.param('id')}`);
  return c.json({ ok: true });
});

// PLANTED 6: CORS reflects every origin with credentials.
app.use('*', async (c, next) => {
  c.header('access-control-allow-origin', c.req.header('origin') ?? '*');
  c.header('access-control-allow-credentials', 'true');
  await next();
});

declare function lookup(token: string): Promise<string | null>;
declare function isEditor(userId: string, projectId: string): Promise<boolean>;
