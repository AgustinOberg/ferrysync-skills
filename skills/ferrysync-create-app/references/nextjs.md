# Next.js

The browser keeps the data and one route handler of the same Next.js app is the server. Ferry runs on the **Node.js runtime**, not Edge: do not set `runtime = 'edge'` on the sync route.

```sh
bun add ferrysync zod
```

## Client (client components only)

```ts
// lib/sync.ts
import { createSync, http, indexedDbStorage } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({
  schema,
  storage: indexedDbStorage('app'),
  backend: http({ url: '/api/sync' }),
});
```

```tsx
// components/tasks.tsx  (starts with 'use client')
'use client';

import { SyncProvider, useQuery } from 'ferrysync/react';

import { sync } from './sync';

const Projects = () => {
  const projects = useQuery(sync.projects.all());
  return <p>{projects.length} projects</p>;
};

export const TasksApp = () => (
  <SyncProvider sync={sync} fallback={<p>Opening...</p>}>
    <Projects />
  </SyncProvider>
);
```

On the server `SyncProvider` renders its fallback; in the browser the local data opens with no request in between.

## Server

Keep it in its own module, imported by the route.

```ts
// lib/sync-server.ts (local development: a SQLite file, Node 22.13+)
import { createSyncServer, nodeSqlite, sqliteStore } from 'ferrysync/server';
import { DatabaseSync } from 'node:sqlite';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: sqliteStore(nodeSqlite(new DatabaseSync('sync.db'))),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
});
```

On Vercel every instance must reach the same database: use Postgres, and hand post-response work to `after`:

```ts
// lib/sync-server.ts (Vercel)
import { createSyncServer, nodePostgres, postgresStore } from 'ferrysync/server';
import { after } from 'next/server';
import { Pool } from 'pg';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: postgresStore(nodePostgres(new Pool({ connectionString: process.env.DATABASE_URL }))),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
  // Work after the response (retention, afterCommit hooks) finishes before the function sleeps.
  waitUntil: (promise) => after(promise),
});
```

## The route

One dynamic segment catches `push`, `pull`, `bootstrap` and `wait`:

```ts
// app/api/sync/[endpoint]/route.ts
import { syncServer } from './sync-server';

export const POST = syncServer.fetch;
// A realtime wait is held up to 30 s: let the function run longer.
export const maxDuration = 60;
```

(In a real app the import is your path alias, for example `@/lib/sync-server`.)

## Auth

`auth` gets the route's `Request`. Read the session from it:

| Library | Expression |
| --- | --- |
| Better Auth | `(await auth.api.getSession({ headers: request.headers }))?.user.id ?? null` |
| Auth.js | `(await auth())?.user?.id ?? null` |
| A bearer token | see `docs/server/auth.md` |

## Gotchas

- Do not put the route behind a middleware that reads the body: `fetch` reads it.
- `node:sqlite` needs Node 22.13 or later. On Vercel use Postgres.
- Several Vercel instances each hold their own waits: a change wakes the devices on the instance that applied it at once and the others within 15 s. For instant everywhere pass a `broadcast` (Redis or Postgres `LISTEN`/`NOTIFY`): see [ferrysync-server](../../ferrysync-server/SKILL.md).
