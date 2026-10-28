---
name: ferrysync-server
description: "Build and operate the Ferry (ferrysync) sync server inside an app's own backend: createSyncServer options, auth(request), spaces and membership, claimSpace and invites, validate/onWrite/afterCommit hooks, writes from the backend with syncServer.write, SQL stores and drivers, migrations, retention, realtime and long-poll scaling with broadcast, deploy per platform, and backups with afterRestore. Use when the user asks to add or change the Ferry server, wire auth or permissions, share data between users, add a server-side rule, write from a job or webhook, pick or migrate a store, scale to several instances, deploy to Vercel, Cloudflare, Fly or Lambda, or restore a backup."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# The Ferry server

Load [ferrysync](../ferrysync/SKILL.md) first for the vocabulary and the "Do not" list. The server is a library on one route of the user's backend, over their database and their auth. One server per process, made at module level, like a database client.

## The shape

```ts
import { createSyncServer, nodePostgres, postgresStore } from 'ferrysync/server';
import { Pool } from 'pg';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema, // the same schema file the apps import
  store: postgresStore(nodePostgres(new Pool({ connectionString: process.env.DATABASE_URL }))),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
  onError: (error) => console.error('ferry', error),
});
```

On every push, in one database transaction, the server validates each row with the table's schema, checks the user may write the row's space, runs the hooks, and appends to the log in one global order. A refused write is a `200` with a rejection code, and the device rolls it back.

## Options

| Option | Default | Decide |
| --- | --- | --- |
| `schema`, `store`, `auth` | required | See the sections below |
| `tables` | none | Per-table hooks: `validate`, `onWrite`, `afterCommit` |
| `claimSpace` | none | Who may found a space. Required when devices create shared spaces offline |
| `versions` | `{ min: 1, max: schema.version }` | Schema versions accepted. Older clients get `updateNeeded` |
| `retention` | `{ days: 90 }` | `false` keeps everything. Set above how long devices stay offline |
| `broadcast` | `memoryBroadcast()` | Share across instances for instant realtime |
| `waitUntil` | none | Serverless: run work after the response (`ctx.waitUntil`, Next.js `after`) |
| `onError` | none | Always set it: failed hooks, failed publishes, a 500's cause |
| `maxBodyBytes` | 5 MiB | `fetch` only; a framework's own parser has its own limit |
| `maxHeldWaitsPerUser` | `10` | Held `wait` requests per user and instance |
| `now`, `scheduler`, `createId` | defaults | Tests only |

The server object: `fetch`, `handle({ endpoint, body, request })`, `write`, `log`, `backfill`, `spaces`, `afterRestore`, `close`, `protocol`.

## Tasks

### Auth

`auth(request)` returns the user's stable id, `null` for a 401, and must not throw for a bad or missing token (a throw is a 500). Return the primary key or the provider's `sub`, never an email. It runs before the body is read and again on every request (every online device sends one about every 25 s), so keep it cheap: cache sessions, or verify a signed token without a database read. Recipes: [auth-and-spaces](references/auth-and-spaces.md).

**Verify:** curl with no credentials returns `401`; with valid ones, `200`. A second user cannot sync with the first user's `clientId`: `403`.

### Spaces and sharing

Space functions live in the schema; membership lives on the server. A user's devices get the rows of their spaces plus their private rows. `syncServer.spaces.addMember(userId, space)` / `removeMember` / `members` / `of`. Invites are endpoints of the backend that check what an invite means, then call `addMember`. [auth-and-spaces](references/auth-and-spaces.md).

**Verify:** a harness test: user A creates a shared row, user B sees nothing until `addMember`, then sees it, and loses it after `removeMember`.

### Rules and backend writes

Rules beyond membership are `validate` hooks. Side effects after commit (email, push, webhooks, search index) are `afterCommit`. Writes from jobs and endpoints are `syncServer.write`. [hooks-and-writes](references/hooks-and-writes.md).

**Verify:** a harness test where a refused write is rolled back on the client and `onRejected` receives your code.

### Stores, drivers, migrations, deploy

[stores-and-deploy](references/stores-and-deploy.md): store per platform, ORM drivers, `migrate: false` with `syncTablesSql`, timeouts and `waitUntil` per platform, graceful shutdown, shipping a new schema version.

**Verify:** `await store.ready()` resolves; `wait` requests survive the platform's timeouts (no repeating 504 every 30 s).

### Realtime, retention, backups

[realtime-retention-backups](references/realtime-retention-backups.md): long polling, `broadcast` with Redis or Postgres `LISTEN`/`NOTIFY`, what retention drops and `forgotten`, the restore procedure with `afterRestore`.

## Do not

- Do not mount Ferry on an Edge runtime that cannot open the database drivers. Next.js: Node.js runtime.
- Do not read the request body in a middleware before the route (`fetch` reads it). Use `handle` with a parsed body when the framework already parsed it.
- Do not trust a header the client can set to carry the user into `auth`. If a middleware sets one, it must always delete the client's own copy first.
- Do not throw from a hook to say no: return a refusal. A hook that always throws blocks that device's changes forever.
- Do not call `syncServer.write` inside `validate` or `onWrite`: it deadlocks on the transaction the hook is in. Use the hook's `tx`.
- Do not write straight to `ferry_*` tables, or to mirrored tables without `write`, `log` or an app push.
- Do not add anyone to a `user:` space.
- Do not run several SQLite processes on one file, put the file on a container's own disk, or use `memoryStore()` outside tests.
- Do not restore a backup and serve before running `afterRestore` once. That step is destructive for devices (each downloads again) and irreversible: say what it will do and get the user's explicit confirmation naming the database before running it against production.
- Do not drop `ferry_*` tables, change `retention` to a shorter value than devices stay offline, or lower `versions.min` and raise it back without confirmation.

## References

- [auth-and-spaces](references/auth-and-spaces.md)
- [hooks-and-writes](references/hooks-and-writes.md)
- [stores-and-deploy](references/stores-and-deploy.md)
- [realtime-retention-backups](references/realtime-retention-backups.md)
