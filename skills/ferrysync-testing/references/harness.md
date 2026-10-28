# Client tests and the harness

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

Realtime with a virtual clock (without `settle()`, the laptop never asked: it shows the long poll at work; a device starts a wait at most a second after its last, so give it that second):

```ts
import { createTestHarness, createVirtualClock } from 'ferrysync/testing';
import { expect, test } from 'vitest';

import { schema } from './schema';

test('a change reaches another device in realtime', async () => {
  const clock = createVirtualClock();
  const harness = createTestHarness({ schema, clock });
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

## Testing `auth`

The harness authenticates clients itself by the user id you pass, so it never runs your `auth`. Test `auth` against the mounted route with a request that carries a real cookie or token: no credentials gives `401`, a bad token gives `401` (not a 500), a good one gives `200`. With Hono: `app.request('/api/sync/pull', { method: 'POST', headers })`; with the Fetch API: call `syncServer.fetch(new Request(...))` directly.

## Gotchas

- `client()` is async; writes before it resolves throw.
- Close clients (`sync.close()`) and the harness at the end of every test.
- Use the app's real schema.
