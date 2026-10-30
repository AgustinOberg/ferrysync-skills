# Client tests and the harness

## Which runner

The examples import `vitest`, which Ferry and its examples use. A project on `bun:sqlite` (Bun's own SQLite) cannot run under Vitest on Node: use `bun test` and import `expect`, `it`, `test` and `mock` from `bun:test` (`mock()` replaces `vi.fn()`). Nothing else changes: the client, `createTestHarness`, `createVirtualClock`, `settle` and `act` behave the same (checked: a realtime test with a virtual clock and a harness over `bun:sqlite` pass under `bun test`). Inside this repo's source layout add `--conditions ferrysync-source`; with the published package no flag is needed. Do not add a runner without asking.

## A client alone

No server, no device: memory storage and `local()` are the defaults. Writes apply synchronously, so most tests need no waiting.

```ts
import { createSync } from 'ferrysync';
import { expect, it } from 'vitest';

import { schema } from './schema';

it('completes a task', async () => {
  const sync = createSync({ schema });
  await sync.ready;
  const task = sync.tasks.create({ projectId: 'p1', title: 'Visa' });
  sync.tasks.update(task.id, { done: true });
  expect(sync.tasks.where({ done: true }).get()).toEqual([{ ...task, done: true }]);
  sync.close();
});
```

## Control time

Sending runs on timers (the next tick, backoff after a failure). A virtual clock makes tests instant and repeatable: time moves only when you say. `clock.advance(ms)` fires due timers in order and lets their promises settle; `clock.pending()` counts timers left.

```ts
import { createSync } from 'ferrysync';
import { createVirtualClock } from 'ferrysync/testing';
import { expect, it } from 'vitest';

import { schema } from './schema';

it('confirms writes on the next tick', async () => {
  const clock = createVirtualClock();
  const sync = createSync({ schema, now: clock.now, scheduler: clock.scheduler });
  await sync.ready;
  sync.projects.create({ name: 'Japan' });
  expect(sync.status).toMatchObject({ pending: 1, synced: false });
  await clock.advance(0);
  expect(sync.status).toMatchObject({ pending: 0, synced: true });
  sync.close();
});
```

Predictable ids: `createSync({ schema, createId: () => `id-${++next}` })`. Ids sort as text and rows come in id order: pad (`id-0001`) when a test creates more than nine rows and reads them in order.

## Restarts

Share a `memoryStorage()` between two clients. `settle()` lets the first finish writing to storage before it stops. `memoryStorage` also has `peek()` (a copy of what is stored) and `failNextWrite()` (a full disk).

```ts
import { createSync, memoryStorage } from 'ferrysync';
import { settle } from 'ferrysync/testing';
import { expect, it } from 'vitest';

import { schema } from './schema';

it('keeps drafts across restarts', async () => {
  const storage = memoryStorage();
  const before = createSync({ schema, storage });
  await before.ready;
  const draft = before.drafts.create({ text: 'Remember the visa' });
  await settle();
  before.close();
  const after = createSync({ schema, storage });
  await after.ready;
  expect(after.drafts.get(draft.id)).toEqual(draft);
  after.close();
});
```

## Components

Render inside `SyncProvider`, wait for the content (the provider shows its fallback until storage has loaded), wrap writes in `act`. Needs a DOM environment (happy-dom or jsdom) and `@testing-library/react`.

```tsx
import { act, render, screen } from '@testing-library/react';
import { createSync } from 'ferrysync';
import { SyncProvider, useQuery } from 'ferrysync/react';
import { expect, it } from 'vitest';

import { schema } from './schema';

it('lists projects', async () => {
  const sync = createSync({ schema });
  const Projects = () => <p>Projects: {useQuery(sync.projects.all()).length}</p>;
  render(
    <SyncProvider sync={sync}>
      <Projects />
    </SyncProvider>,
  );
  await screen.findByText('Projects: 0');
  act(() => {
    sync.projects.create({ name: 'Japan' });
  });
  expect(screen.getByText('Projects: 1')).toBeTruthy();
});
```

## `createTestHarness`: the real server and many clients

`local()` confirms everything, so it cannot show rejections, other users' changes or spaces. The harness runs `createSyncServer` and any number of clients in one process, over the real HTTP protocol, your hooks and spaces, with realtime. Nothing to start, nothing to mock.

| Member | What it does |
| --- | --- |
| `client(userId, options?)` | A new device of that user: a client over memory storage, synced with the server. Async: resolves once ready. Options are `createSync`'s except `schema`, `storage`, `backend` |
| `settle()` | Resolves once every client has sent, pulled up to the server, and is idle. Throws if they cannot settle (a client on a refused schema version, a hook that always throws), with each client's status |
| `server` | The server as `createSyncServer` made it: `spaces`, `write`, `afterRestore`, `protocol` |
| `close()` | Closes every client and the server |

Harness options: `schema`, `server` (`createSyncServer`'s options except `schema` and `auth`; the store defaults to `memoryStore()`), `clock` (a virtual clock for the server and every client).

```ts
import { createTestHarness } from 'ferrysync/testing';
import { expect, test, vi } from 'vitest';

import { schema } from './schema';

test('a task without a title is refused and rolled back', async () => {
  const harness = createTestHarness({
    schema,
    server: {
      claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
      tables: {
        tasks: { validate: ({ after }) => (after?.title === '' ? 'A task needs a title' : null) },
      },
    },
  });
  const onRejected = vi.fn();
  const alice = await harness.client('alice', { onRejected });
  const project = alice.projects.create({ name: 'Japan' });
  const task = alice.tasks.create({ projectId: project.id, title: '' });
  await harness.settle();
  expect(alice.tasks.get(task.id)).toBeNull();
  expect(onRejected).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'rejected', message: 'A task needs a title' }),
  );
  await harness.close();
});
```

Every test whose schema has shared spaces needs the `claimSpace` of your server options, or a device-created space is refused as `forbidden`. Realtime with a virtual clock (without `settle()`, the laptop never asked: it shows the long poll at work; a device starts a wait at most a second after its last, so give it that second):

```ts
import { createTestHarness, createVirtualClock } from 'ferrysync/testing';
import { expect, test } from 'vitest';

import { schema } from './schema';

test('a change reaches another device in realtime', async () => {
  const clock = createVirtualClock();
  const harness = createTestHarness({
    schema,
    clock,
    // Without it the project's write is `forbidden` (no members yet) and nothing ever syncs.
    server: {
      claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
    },
  });
  const phone = await harness.client('alice');
  const laptop = await harness.client('alice');
  await harness.settle();
  const project = phone.projects.create({ name: 'Japan' });
  await clock.advance(1_000);
  expect(laptop.projects.get(project.id)).toEqual(project);
  await harness.close();
});
```

Test on the store you deploy by passing it: `server: { store: sqliteStore(nodeSqlite(new DatabaseSync(':memory:'))) }`, or PGlite for Postgres: `postgresStore(pglite(new PGlite()))`.

```ts
import { nodeSqlite, sqliteStore } from 'ferrysync/server';
import { createTestHarness } from 'ferrysync/testing';
import { DatabaseSync } from 'node:sqlite';

import { schema } from './schema';

export const harness = createTestHarness({
  schema,
  server: { store: sqliteStore(nodeSqlite(new DatabaseSync(':memory:'))) },
});
```

## Old endpoints and Ferry clients over one server

When a legacy REST API keeps running while Ferry takes over, test both against ONE server and one database. Export the Ferry options from the app (everything but `auth`, which the harness sets), run the harness on them, and build the legacy app over `harness.server`. The shipped store, mirror and hooks are what runs. This block is `no-check`: it imports `bun:sqlite` and `hono`, which the snippet checker does not have.

```ts no-check
import { defineSchema } from 'ferrysync';
import { bunSqlite, sqliteStore } from 'ferrysync/server';
import { createTestHarness } from 'ferrysync/testing';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { expect, test } from 'bun:test';
import { z } from 'zod';

const Task = z.object({ id: z.string(), title: z.string(), done: z.boolean().default(false) });
const schema = defineSchema({ tasks: Task });

// In the app: everything the Ferry server needs except `auth`.
const ferryOptions = (db: Database) => ({
  store: sqliteStore(bunSqlite(db), { mirror: { tasks: { table: 'tasks', fields: Task } } }),
});

test('legacy and Ferry share one server', async () => {
  const db = new Database(':memory:');
  db.run('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)');
  const harness = createTestHarness({ schema, server: ferryOptions(db) });
  const legacy = new Hono(); // the app's old routes, written over harness.server
  legacy.post('/api/tasks', async (c) => {
    const { title } = await c.req.json<{ title: string }>();
    const task = await harness.server.write({ as: { userId: 'alice' } }, (tx) => tx.tasks.create({ title }));
    return c.json(task, 201);
  });

  const alice = await harness.client('alice');
  const res = await legacy.request('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'old endpoint' }) });
  expect(res.status).toBe(201);
  await harness.settle();
  expect(alice.tasks.where({ title: 'old endpoint' }).get()).toHaveLength(1); // old write reaches a Ferry client

  const fromApp = alice.tasks.create({ title: 'ferry client' });
  await harness.settle();
  expect(db.query('SELECT title FROM tasks WHERE id = ?').get(fromApp.id)).toEqual({ title: 'ferry client' }); // Ferry write is in the old table
  await harness.close();
});
```

Notes: a legacy route must write through `harness.server.write` (or, for SQL it already ran, `log`) so devices hear about it; a raw `INSERT` is invisible to sync until `backfill`. `backfill` of a private table needs an owner, or its rows come back in `rejected` with "a private row the server creates needs an owner". A legacy write that bypasses sync is not a Ferry bug: it is the `log` and `backfill` step of [ferrysync-migrate](../../ferrysync-migrate/SKILL.md).

## Testing `auth`

The harness authenticates clients itself by the user id you pass, so it never runs your `auth`. Test `auth` against the mounted route with a request that carries a real cookie or token: no credentials gives `401`, a bad token gives `401` (not a 500), a good one gives `200`. With Hono: `app.request('/api/sync/pull', { method: 'POST', headers })`; with the Fetch API: call `syncServer.fetch(new Request(...))` directly.

## Gotchas

- `client()` is async; writes before it resolves throw.
- Close clients (`sync.close()`) and the harness at the end of every test.
- Use the app's real schema.
