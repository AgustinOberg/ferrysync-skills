# React, React Native and state libraries

`ferrysync/react` works the same on React 18 and 19, web and React Native. `react` is an optional peer dependency; `react-dom` is never imported. Hooks read with `useSyncExternalStore` from snapshots that stay the same object until they change: no effects, no tearing, unchanged rows keep their objects so `memo` children skip renders. The React Compiler needs nothing from you.

| Hook | Returns | Re-renders when |
| --- | --- | --- |
| `useQuery(query)` | the query's result | the result changes |
| `useQuery(make, deps)` | the result of the query `make` returns | the result changes, or `deps` do |
| `useLiveQuery(...)` | the same as `useQuery` | the same |
| `useRow(table, id)` | the row, or `null` (a null or undefined id reads `null`) | that row changes |
| `useSyncStatus(sync?)` | `sync.status` | the status changes |
| `useUndo(sync?)` | `{ undo, redo, canUndo, canRedo }` | `canUndo` or `canRedo` changes |
| `useSync()` | the provider's client | never |

```tsx
import { SyncProvider, useQuery, useRow, useSyncStatus, useUndo } from 'ferrysync/react';

import { sync } from './sync';

const Search = ({ search }: { search: string }) => {
  // A predicate query is new on every call: factory form with deps.
  const found = useQuery(
    () => sync.tasks.where((task) => task.title.toLowerCase().includes(search.toLowerCase())),
    [search],
  );
  const first = useRow(sync.tasks, found[0]?.id ?? null);
  const { synced } = useSyncStatus();
  const { undo, canUndo } = useUndo();
  return (
    <section>
      <p>{found.length} found, first: {first?.title ?? 'none'}, {synced ? 'saved' : 'saving'}</p>
      <button type="button" disabled={!canUndo} onClick={undo}>
        Undo
      </button>
    </section>
  );
};

export const App = () => (
  <SyncProvider sync={sync} fallback={<p>Opening...</p>}>
    <Search search="visa" />
  </SyncProvider>
);
```

`SyncProvider` waits for `sync.ready` (a few milliseconds at startup), renders the fallback again after `sync.reset()`, and rethrows a storage failure for the nearest error boundary. Server rendering renders the fallback because `ready` never resolves there: components that read Ferry are client components.

## Error boundary for a second tab

```tsx
import { Component, type ReactNode } from 'react';
import { StorageLockedError } from 'ferrysync';
import { SyncProvider } from 'ferrysync/react';

import { sync } from './sync';

class SyncBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error instanceof StorageLockedError) {
      return <p>This app is open in another tab. Close it and reload.</p>;
    }
    if (error !== null) return <p>Could not open your data.</p>;
    return this.props.children;
  }
}

export const Guarded = ({ children }: { children: ReactNode }) => (
  <SyncBoundary>
    <SyncProvider sync={sync} fallback={null}>
      {children}
    </SyncProvider>
  </SyncBoundary>
);
```

## Typing `useSync`

Register the client next to it; `SyncProvider` then refuses a client of another schema. Without it `useSync()` returns a client without tables. Most apps import the client directly.

```tsx
import { createSync } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({ schema });

declare module 'ferrysync/react' {
  interface Register {
    sync: typeof sync;
  }
}
```

## With TanStack Query or SWR

They fetch server data and say when it is loading; Ferry's data is already on the device. Import Ferry's hook as `useLiveQuery`. Do not wrap Ferry reads in them, do not write through mutations. For server-computed data, key it on `lastSyncId`. Full mapping: [ferrysync-migrate](../../ferrysync-migrate/references/source-stacks.md).

## React Native

No native code, runs on Hermes, no polyfill for ids. Native storage (`sqliteStorage`), full backend URL, `syncNow()` on `AppState` `'active'`. Keep the client in its own module and reload the app after editing it (Fast Refresh re-runs the module; a second client over one storage is trouble). Hermes: nothing in Ferry uses `structuredClone`, `Array.prototype.at`, `toSorted`, `toReversed`, `Object.hasOwn` or `findLast`; do not add them to code that shares a bundle with the client. `Intl` may be missing in some builds: collation then falls back to code-unit order.

## Which UI binding

| App | Use |
| --- | --- |
| New, or React with no global state library | `useQuery` |
| Already reads through Zustand selectors | `createSyncStore(sync)` from `@ferrysync/zustand`: `state.tables.<table>[id]`, `state.status`, `state.ready`. Option `{ tables }`. `destroy()` stops it |
| Already Jotai atoms | `createSyncAtoms(sync)` from `@ferrysync/jotai`: `tables.<table>`, `status`, `ready`, and its own `store`: pass `syncAtoms.store` to every read |
| Already Legend-State | `bindLegendState(sync, [bindTable(sync.tasks, store$.tasks), bindRow(sync.projects, current$, id)])` from `@ferrysync/legend-state`; bind once, before reading; the returned function stops it |
| Vue, Svelte, Solid, vanilla | `query.get()` and `query.subscribe(listener)`: `docs/examples/own-bindings.md` |

Adapters are read-only mirrors: writes are always `sync.tasks.update(...)`. They filter and sort in your selector; `useQuery` does it in the query. Using both in one app is fine: they share the client.

```ts
import { createSyncStore } from '@ferrysync/zustand';
import { useStore } from 'zustand';

import { sync } from './sync';

export const syncStore = createSyncStore(sync, { tables: ['tasks'] });

export const usePending = () => useStore(syncStore, (state) => state.status.pending);
```
