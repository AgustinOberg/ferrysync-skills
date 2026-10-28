---
name: ferrysync-client
description: "Work with the Ferry (ferrysync) client in an app: evolve the schema safely (compatible changes vs a version bump), write queries and live queries, transactions and undo, show sync status and offline state, choose or write a storage, handle sign-in and sign-out with connect and reset (keepLocalOnly), and use the React hooks or the Zustand, Jotai and Legend-State adapters. Use when the user asks to add or rename a field or table, filter or sort synced data, group writes, add undo, show a saved or offline indicator, handle a server rejection, change the local storage, build login and logout around sync, or wire sync into React, React Native, Vue or Svelte."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# The Ferry client

Load [ferrysync](../ferrysync/SKILL.md) first for the vocabulary and the "Do not" list. `createSync` makes one object with a property per table, that reads and writes a local database and syncs in the background. Make one client per app, at module level, in its own module.

```ts
import { createSync, indexedDbStorage } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({ schema, storage: indexedDbStorage('app') });

await sync.ready; // local data readable, before any network

const task = sync.tasks.create({ projectId: 'p1', title: 'Book flights' });
sync.tasks.update(task.id, { done: true });
sync.tasks.get(task.id);
sync.tasks.delete(task.id);
```

## Core facts

- Writes are synchronous and optimistic: visible before the call returns, stored, queued, sent later. Writes before `sync.ready` throw. Reads before `ready` find nothing (`get` returns `null`, queries `[]`). `SyncProvider` waits for you.
- `create(input, options?)` takes the schema's input, returns the output with defaults; the id is optional (UUIDv7 from `createId()`; creating an id that exists throws). `update(id, patch)` and `delete(id)` return `false` for a missing row. `undefined` fields in a patch mean unchanged; an update that changes nothing sends nothing.
- A write the schema refuses throws `ValidationError` (`table`, `issues` with paths) and changes nothing.
- Never mutate a row you read (rows are shared objects). Compare rows by id, not identity.
- One client per storage: two clients over the same storage corrupt each other.

## Tasks

| The user wants | Do | Reference |
| --- | --- | --- |
| Add a field | Compatible change: `.default()`, `.optional()` or `.nullable()`. No version bump | [schema-evolution](references/schema-evolution.md) |
| Rename or retype a field, rename a table | Breaking: bump `version`, server accepts both while old apps exist | [schema-evolution](references/schema-evolution.md) |
| Filter, sort, limit, search | `where`, `orderBy`, `limit`, `first`; operators `eq not in notIn gt gte lt lte` | [queries-and-transactions](references/queries-and-transactions.md) |
| Several writes together, one undo step | `sync.transaction((tx) => ...)`, synchronous callback | [queries-and-transactions](references/queries-and-transactions.md) |
| Undo and redo | `sync.undo()`, `redo()`, `canUndo()`, `canRedo()`; `useUndo()` in React | [queries-and-transactions](references/queries-and-transactions.md) |
| A saved or offline indicator, force a sync, wait for sync | `sync.status`, `useSyncStatus()`, `syncNow()`, `whenSynced`, `flush` | [status-storage-accounts](references/status-storage-accounts.md) |
| Show why a write vanished | `onRejected` on `createSync` | [status-storage-accounts](references/status-storage-accounts.md) |
| Pick or write a storage, handle two tabs | Storages table, `onLocked`, conformance kit | [status-storage-accounts](references/status-storage-accounts.md) |
| Login and logout | `connect(http(...), { upload })`, `reset(local(), { keepLocalOnly })` | [status-storage-accounts](references/status-storage-accounts.md) |
| UI binding | `useQuery`, adapters, other frameworks | [react-and-adapters](references/react-and-adapters.md) |

## Do not

- Do not write in render: write in event handlers and effects. Writes notify every subscriber synchronously.
- Do not pass an `async` function to `sync.transaction` (it throws and writes nothing), call `sync.tasks.create` inside a transaction (use `tx.tasks.create`), or keep `tx` after the callback.
- Do not use `.optional()` for a field users can clear: `undefined` means unchanged. Use `.nullable().default(null)` and write `null`.
- Do not store `Date`, `Map`, `bigint`, `NaN` or class instances: JSON values only.
- Do not add a `.transform` that changes an already valid row: the client validates rows again when it reads them back.
- Do not rename or retype a field, or rename a table, without a `version` bump and a server accepting both versions.
- Do not call `sync.reset()` without checking `sync.status.pending` first when the user may have unsynced work: pending writes are lost with the rest.
- Do not connect from an auth-state listener (it fires on every session restore, and `upload: true` must run once per sign-in). Connect from the sign-in handler.
- Do not wrap Ferry reads in a fetching library or write through its mutations.
- Do not write to the Zustand store, Jotai atoms or Legend-State observables (read-only mirrors): write through the client.
- Do not use a table name the client reserves (`ready`, `isReady`, `status`, `tables`, `schema`, `engine`, `subscribe`, `onStatus`, `transaction`, `undo`, `redo`, `canUndo`, `canRedo`, `syncNow`, `flush`, `whenSynced`, `refetch`, `connect`, `reset`, `close`, `then`, `__proto__`).

## References

- [schema-evolution](references/schema-evolution.md)
- [queries-and-transactions](references/queries-and-transactions.md)
- [status-storage-accounts](references/status-storage-accounts.md)
- [react-and-adapters](references/react-and-adapters.md)
