# Hooks and backend writes

## Hooks (per table, under `tables`)

| Hook | Runs | Use for |
| --- | --- | --- |
| `validate` | In the transaction, before anything is saved | Rules beyond schema and membership. Refuses the whole transaction |
| `onWrite` | In the same transaction, after `validate`, with a `tx` | More writes that commit with the change or not at all (cascade deletes, seed rows) |
| `afterCommit` | Once per applied change, after commit | Email, push, webhooks, search indexes. What it throws goes to `onError` and fails nothing |

Order for each change: schema validates the row, the user must belong to the row's space (or found it with `claimSpace`), `validate`, `onWrite` (whose writes go through the same steps, up to 8 levels deep), commit, devices are told, `afterCommit`.

What a hook sees: `table`, `kind` (`create`, `update`, `delete`), `before`, `after` (typed by the table), `actor`, `name` (the transaction's name: `tasks.update.v1`, or one you gave). `actor` is `{ type: 'user', userId, clientId }` for an app's write, `{ type: 'user', userId, clientId: null }` for `write({ as: { userId } })`, and `{ type: 'system' }` for `write({ as: 'system' })` and `onWrite` writes.

```ts
import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  tables: {
    tasks: {
      validate: async ({ after, get }) => {
        if (after !== null && after.title.trim() === '') {
          return 'A task needs a title'; // code 'rejected', this message
        }
        if (after !== null && (await get('projects', after.projectId)) === null) {
          return { code: 'no_project', message: 'This project was deleted' };
        }
      },
      afterCommit: async ({ before, after }) => {
        if (after?.done === true && before?.done === false) {
          await notifyProject(after.projectId, `Done: ${after.title}`);
        }
      },
    },
    projects: {
      // Deleting a project deletes its tasks, in the same transaction.
      onWrite: async ({ kind, before }, tx) => {
        if (kind === 'delete' && before !== null) {
          for (const taskId of await taskIdsOf(before.id)) {
            await tx.tasks.delete(taskId);
          }
        }
      },
    },
  },
});
```

`validate` returns nothing or `null` to continue, a string (code `rejected`) or `{ code, message? }` to refuse. A refusal refuses the whole transaction, the device rolls back and calls `onRejected` with the code, and a `write` from the backend throws `WriteRejectedError`. `get(table, id)` reads a row as the transaction sees it so far. `tx.<table>` has `create`, `update`, `delete`, `get`, all async. The hook's finding rows is the database's job (a mirror table).

Rules: keep `validate` fast (it holds database locks); a hook runs once per change, not per request (a transaction of three operations runs `validate` three times; use `name` to tell what the user did); `afterCommit` waits before the response unless `waitUntil` is set.

## `syncServer.write`

Changes synced data from backend code so devices hear about it. One database transaction: all or nothing. What the callback returns is what `write` resolves with.

```ts
import { syncServer } from './sync-server';

// As the server itself: may write any space.
await syncServer.write({ as: 'system' }, (tx) => tx.tasks.update(taskId, { done: true }));

// As a user: with that user's permissions, as if from their app. Can found a space via claimSpace.
const project = await syncServer.write({ as: { userId } }, (tx) =>
  tx.projects.create({ name: 'Japan' }),
);

// Several rows, reads see the transaction's own writes.
await syncServer.write({ as: 'system' }, async (tx) => {
  const created = await tx.projects.create({ name: 'Imported' });
  for (const title of ['Flights', 'Hotel', 'Visa']) {
    await tx.tasks.create({ projectId: created.id, title });
  }
});

// Name the kind of change when hooks care.
await syncServer.write({ as: 'system' }, (tx) => tx.tasks.update(taskId, { done: true }), {
  name: 'tasks.complete-from-billing.v1',
});
```

| `tx` call | Resolves with |
| --- | --- |
| `create(input, opts?)` | the row, defaults applied; the id is made unless given |
| `update(id, patch)` | `true`, or `false` if no row |
| `delete(id)` | `true`, or `false` if no row |
| `get(id)` | the row, or `null` |

`write` checks no auth: the endpoint decides who may call it. Reads see every space; `as` decides what may be written. Rows the server creates get UUIDv7 ids.

Refusals throw `WriteRejectedError` (import from `ferrysync/server`) with `code`: `invalid` (schema, or a string with U+0000), `forbidden` (not the user's space), `exists` (create over a live id), `local_only`, or your hook's. A refused operation refuses the whole write even if the callback catches it. `update` or `delete` of a missing row resolves `false`.

```ts
import { WriteRejectedError } from 'ferrysync/server';

import { syncServer } from './sync-server';

try {
  await syncServer.write({ as: { userId } }, (tx) => tx.projects.update(projectId, { name: 'x' }));
} catch (error) {
  if (error instanceof WriteRejectedError) {
    console.warn(error.code, error.message);
  }
}
```

### Inside your own transaction (`within`)

`{ within: tx }` makes the sync write part of the app's own transaction. `write` then resolves with `{ value, committed }`: call `committed()` after your commit (never after a rollback) to tell devices and run `afterCommit`. Works with `nodePostgres` (pool client after `BEGIN`), `postgresJs`, `pglite`, `prismaDriver`, `drizzleDriver`. A type error with the SQLite drivers, `durableObjectSqlite` and `d1Store`.

## Gotchas

- Every change to synced data goes through `write` (or an app push): a change straight in the database is not in the log.
- The `tx` ends with the callback: using it afterwards rejects.
- A hook that throws makes the device retry the same transaction until it goes through.
