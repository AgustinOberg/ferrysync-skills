# Backends

The server is one object, `syncServer`, made once at module level and shared. `fetch(request)` answers every endpoint by the last path segment, so mount it under any prefix and give the client that prefix as `url`. First write `sync-server.ts`:

```ts
// sync-server.ts
import { createSyncServer, nodeSqlite, sqliteStore } from 'ferrysync/server';
import { DatabaseSync } from 'node:sqlite';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: sqliteStore(nodeSqlite(new DatabaseSync('sync.db'))),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  // Whoever creates a project becomes the first member of its space.
  claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
  onError: (error) => console.error('ferry', error),
});
```

Swap the store per [databases](databases.md). Then mount it:

## Hono (Node, Bun, Deno, Workers)

```ts
// server.ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { syncServer } from './sync-server';

const app = new Hono();
app.all('/api/sync/*', (c) => syncServer.fetch(c.req.raw));

serve({ fetch: app.fetch, port: 3000 });
```

Other runtimes: Bun `export default { fetch: app.fetch, idleTimeout: 40 }`; Workers `export default app`; Deno `Deno.serve(app.fetch)`.

CORS (web app on another origin): answer preflight before the route, allowing `authorization` and `content-type`:

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { syncServer } from './sync-server';

export const app = new Hono();
app.use(
  '/api/sync/*',
  cors({ origin: 'https://app.example.com', allowHeaders: ['authorization', 'content-type'] }),
);
app.all('/api/sync/*', (c) => syncServer.fetch(c.req.raw));
```

Do not read the request body in a middleware before the route: `fetch` reads it. If a middleware already did, call `syncServer.handle({ endpoint, body, request })` with the parsed body instead.

## Express

```ts
// server.ts
import express from 'express';
import { toNodeHandler } from 'ferrysync/server';

import { syncServer } from './sync-server';

const app = express();
// Mount before any global body parser, or raise its limit: express.json() stops at 100 kB.
app.use('/api/sync', toNodeHandler(syncServer));
app.listen(3000);
```

Use `app.use`, not `app.post`: the endpoints are paths under the mount. Needs Node 18 or later. If the user exists only on the Node request (Passport's `req.user`), a middleware may put it in a header for `auth`, and it must always delete the client's own copy of that header first (see `docs/examples/express.md`).

## Node `http`, Fastify, Nest

```ts
import { toNodeHandler } from 'ferrysync/server';
import { createServer } from 'node:http';

import { syncServer } from './sync-server';

const sync = toNodeHandler(syncServer);
createServer((request, response) => {
  if (request.url?.startsWith('/sync/')) {
    void sync(request, response);
    return;
  }
  response.writeHead(404).end();
}).listen(3000);
```

Fastify parses bodies itself: hijack the reply and hand the parsed body on (see `docs/examples/node.md`); raise `bodyLimit` for the route (default 1 MiB). Nest runs on Express: `app.use('/sync', toNodeHandler(syncServer))` before `listen`, and authenticate inside `auth` (guards do not see this route).

## Bun

```ts
import { Database } from 'bun:sqlite';
import { bunSqlite, createSyncServer, sqliteStore } from 'ferrysync/server';

import { schema } from './schema';

const syncServer = createSyncServer({
  schema,
  store: sqliteStore(bunSqlite(new Database('sync.db'))),
  auth: async (request) => (await getSession(request))?.userId ?? null,
});

Bun.serve({
  port: 3000,
  // A realtime wait is held up to 30 s with nothing sent; Bun's default closes it after 10.
  idleTimeout: 40,
  fetch: (request) => syncServer.fetch(request),
});
```

## Cloudflare Workers with D1

D1 has no transactions to read inside, so one Durable Object, the coordinator, runs the server and is the database's single writer. `d1Store` has no `mirror` and no `within`. Cloudflare D1 and Durable Objects are unconfirmed on real Cloudflare (Ferry's roadmap): tell the user.

```ts
// worker.ts
import { createSyncServer, d1Store, durableObjectCoordinator } from 'ferrysync/server';

import { schema } from './schema';

interface Env {
  DB: D1Database;
  SYNC: DurableObjectNamespace;
}

export class SyncCoordinator {
  readonly fetch: (request: Request) => Promise<Response>;

  constructor(state: DurableObjectState, env: Env) {
    const store = d1Store(env.DB);
    const syncServer = createSyncServer({
      schema,
      store,
      auth: async (request) => (await getSession(request))?.userId ?? null,
    });
    this.fetch = (request) => syncServer.fetch(request);
    // The tables and the sync-id counter, read before the first request is let in.
    void state.blockConcurrencyWhile(() => store.ready());
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/sync/')) {
      return new Response('Not found', { status: 404 });
    }
    return durableObjectCoordinator(env.SYNC).fetch(request);
  },
};
```

```jsonc
// wrangler.jsonc
{
  "main": "worker.ts",
  "compatibility_date": "2025-09-01",
  "d1_databases": [{ "binding": "DB", "database_name": "sync", "database_id": "<your id>" }],
  "durable_objects": { "bindings": [{ "name": "SYNC", "class_name": "SyncCoordinator" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SyncCoordinator"] }]
}
```

One coordinator per D1 database, never two. Alternative: Postgres through Hyperdrive with a store per request: `docs/examples/cloudflare-workers.md`.

**Verify (every backend):** the curl check in [verify-two-devices](verify-two-devices.md).
