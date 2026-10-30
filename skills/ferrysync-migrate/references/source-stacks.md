# Mapping tables per source stack

Find the stack the app uses today, read its table, then apply it one feature at a time (phase 3). The "before" blocks are legacy code shown for pattern matching and are marked `no-check`; the "after" blocks compile.

## REST with `fetch` (or axios) and hand-rolled state

| Before | After |
| --- | --- |
| `GET /tasks?projectId=` in an effect, `useState` for the list | `useQuery(sync.tasks.where({ projectId }))`: local, no loading state |
| `POST /tasks` then refetch or push into state | `sync.tasks.create({ projectId, title })`: applies at once, queues, returns the row |
| `PATCH /tasks/:id` | `sync.tasks.update(id, { done: true })` (only changed fields go over the wire) |
| `DELETE /tasks/:id` | `sync.tasks.delete(id)` |
| Several calls that must succeed together | `sync.transaction((tx) => { ... })`: all or nothing, one undo step |
| `loading`, `error`, retry buttons | Nothing for local data. Show `useSyncStatus()` (`synced`, `online`, `pending`) if the UI needs it |
| Polling or WebSocket for fresh data | Realtime is on by default with `http()`. No code |
| Retry queue for offline writes | The outbox: nothing to write |
| Server error on a write (4xx) | `onRejected({ code, message, changes })`: the row is already rolled back |
| Endpoint-level auth | `auth(request)` and the schema's spaces; extra rules as `validate` hooks |

The old endpoints stay for non-synced features and for old app versions, and their server code must write through `syncServer.write` or tell sync with `syncServer.log` ([adoption-code](adoption-code.md)).

## TanStack Query

```tsx no-check
// BEFORE (legacy, for pattern matching)
const tasks = useQuery({ queryKey: ['tasks', projectId], queryFn: () => fetchTasks(projectId) });
const complete = useMutation({
  mutationFn: (id: string) => api.completeTask(id),
  onMutate: async (id) => { /* cancel, snapshot, optimistic update */ },
  onError: (_e, _id, context) => { /* roll back */ },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }),
});
```

```tsx
// AFTER: local read, plain write. Optimistic update, rollback and invalidation are built in.
import { useLiveQuery } from 'ferrysync/react';

import { sync } from './sync';

export const Tasks = ({ projectId }: { projectId: string }) => {
  const tasks = useLiveQuery(sync.tasks.where({ projectId }));
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id} onClick={() => sync.tasks.update(task.id, { done: true })}>
          {task.title}
        </li>
      ))}
    </ul>
  );
};
```

| Before | After |
| --- | --- |
| `useQuery` of rows the app creates and edits | `useLiveQuery(...)` (Ferry's hook, imported under its second name so both libraries coexist) |
| `useMutation` + `invalidateQueries` | A table call. No mutation, no invalidation |
| `onMutate`/`onError` optimistic code | Delete it. `onRejected` on `createSync` is the failure hook |
| `isLoading`, `isPending`, skeletons | Delete for synced data. `SyncProvider`'s `fallback` shows once while local data opens |
| `refetchOnWindowFocus`, `refetchInterval` | Delete. `sync.syncNow()` on foreground (React Native `AppState`, web `online` and `visibilitychange`) |
| Infinite queries, pagination | `.orderBy(...).limit(n)` in memory. A huge server-only list stays on TanStack |
| Cache persisters, offline mutation resume | Delete: the local database and outbox replace them |
| Aggregates the server computes (reports) | Keep on TanStack Query. Add `lastSyncId` from `useSyncStatus(sync)` to the key so it refetches when the server may have news |
| Third-party APIs (weather, search) | Stay on TanStack Query |

Never wrap Ferry reads in `useQuery` and never write through `useMutation`: it adds a second cache to invalidate and a pending state to something that never waits. Both providers can wrap the app in any order.

```tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSyncStatus } from 'ferrysync/react';

import { sync } from './sync';

export const Report = ({ projectId }: { projectId: string }) => {
  const { lastSyncId } = useSyncStatus(sync);
  const report = useQuery({
    queryKey: ['report', projectId, lastSyncId],
    queryFn: () => fetchReport(projectId),
    placeholderData: keepPreviousData,
  });
  if (report.data === undefined) return <p>Loading the report...</p>;
  return <p>{report.data.done} done, {report.data.open} open</p>;
};
```

## SWR

| Before | After |
| --- | --- |
| `useSWR('/api/tasks?p=' + id, fetcher)` for synced rows | `useLiveQuery(sync.tasks.where({ projectId: id }))` |
| `mutate(key, optimistic, { revalidate })` | A table call |
| `useSWRMutation` | A table call |
| `isLoading`, `error` | None for local data |
| Server-computed data | Stay on SWR, key it with `lastSyncId` (`docs/examples/swr.md`) |

## Redux, Zustand, Context holding server data

| Before | After |
| --- | --- |
| A slice or store field holding fetched rows, plus thunks and loading flags | Delete the slice. Read with `useQuery`, write with table calls |
| Already Zustand and many components select from the store | `createSyncStore(sync)` from `@ferrysync/zustand`: tables by id, `status`, `ready`. Read-only: never `setState` it |
| Already Jotai | `createSyncAtoms(sync)` from `@ferrysync/jotai`. Pass `syncAtoms.store` to every read |
| Already Legend-State | `bindLegendState(sync, [bindTable(sync.tasks, store$.tasks)])` |
| Redux | No adapter. Prefer `useQuery` in components. To feed an existing store, `await sync.ready`, seed it with `sync.tasks.all().get()`, then subscribe: `sync.tasks.all().subscribe((rows) => dispatch(replace(rows)))` (a listener hears changes, not the current value), and keep it read-only |
| UI-only state (open modals, selected tab) | Keep where it is. Per-device persistent settings: a `localOnly` table |
| Persisted store (redux-persist, zustand persist) holding server rows | Remove the persistence for those rows |

```ts
import { createSyncStore } from '@ferrysync/zustand';
import { useStore } from 'zustand';

import { sync } from './sync';

export const syncStore = createSyncStore(sync);

export const useTaskTitle = (id: string) =>
  useStore(syncStore, (state) => state.tables.tasks[id]?.title);
```

## Firebase (Firestore + Auth)

Keep Firebase Auth. Firestore is not a Ferry store: Ferry's server keeps an ordered log next to the rows in SQL, so the synced data moves to Postgres or SQLite beside the app's backend.

| Before | After |
| --- | --- |
| Firebase Auth ID token | Verify it in `auth`: `(await getAuth().verifyIdToken(token)).uid` with the Admin SDK. Return `null` on failure |
| `onSnapshot(query, ...)` listeners | `useQuery(...)`. Realtime comes from the `wait` long poll |
| `addDoc`, `updateDoc`, `deleteDoc` | `create`, `update`, `delete` on the table |
| Firestore offline persistence | The local database and outbox |
| Security rules | Spaces (who sees a row) and `validate` hooks (rules beyond membership), in the backend |
| Document ids | Strings from `createId()`: keep existing Firestore ids as they are (any string id works) |
| Subcollections | A table with a parent id field, and the parent's space function |
| Data migration | A script that reads Firestore and calls `syncServer.write({ as: 'system' }, ...)` in batches |

Wait for `auth.authStateReady()` before choosing the backend (until then `currentUser` is `null` even when signed in), and connect from the sign-in handler, not from `onAuthStateChanged` (it fires on every restore): `docs/examples/firebase.md`.

## Supabase

| Before | After |
| --- | --- |
| Supabase Auth access token | Verify in `auth` with `supabase.auth.getUser(token)`, return `data.user?.id ?? null` |
| `supabase.from('tasks').select()` | `useQuery(sync.tasks.where(...))` |
| `.insert`, `.update`, `.delete` | Table calls. The backend writes Supabase's Postgres through the store |
| `supabase.channel(...).on('postgres_changes', ...)` | Delete: realtime is Ferry's `wait` |
| Row Level Security | Does not apply to Ferry's connection. Port the policies to spaces and `validate` hooks. Keep RLS on for any direct client access you still allow |
| Existing tables | Point `postgresStore(nodePostgres(pool))` at the same database with `mirror` so existing queries and the dashboard keep working |
| Storage buckets | Unchanged: sync the object key or URL |

The store works on the direct connection string or through a transaction-mode pooler (Supavisor); behind one, give postgres.js `prepare: false`. `docs/examples/supabase.md` has the full pair of files, without a mirror: add `mirror` to the store for your existing tables.

## Existing Postgres with Prisma or Drizzle

| Before | After |
| --- | --- |
| ORM models and migrations for the synced tables | Unchanged. Add `mirror` so Ferry keeps them current |
| `prisma.task.create(...)` in endpoints | `syncServer.write(..., { within: tx })` inside the same Prisma transaction, or `syncServer.log(tx, ...)` after the write |
| Serial primary keys | Add a `uuid`/`text` key for synced rows ([adoption-code](adoption-code.md)) |
| Soft deletes with another column name | `deletedAt: 'archived_at'` in the mirror |
| Hand-written SQL reading `tasks` | Keep, and filter `deleted_at IS NULL` |
| Prisma migrate / drizzle-kit owns schema | Generate Ferry's tables with `syncTablesSql` into a migration, `migrate: false` |
| Transaction timeouts | `prismaDriver(prisma, { dialect, timeout })`: the first download of a big account reads every row in one transaction |

```ts
import { drizzleDriver, postgresStore } from 'ferrysync/server';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));

export const store = postgresStore(drizzleDriver(db, { dialect: 'postgres', sql }), {
  mirror: { tasks: { table: 'tasks', fields: ['projectId', 'title', 'done'] } },
});
```
