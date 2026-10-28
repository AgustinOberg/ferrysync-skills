# Status, offline, storage and accounts

## `sync.status`

`{ phase, pending, oldestPendingAt, lastSyncId, lastError, lastSyncedAt, online, synced }`. It is the same object until something in it changes (compare by identity; `useSyncStatus()` in React).

| `phase` | Meaning |
| --- | --- |
| `'starting'` | Loading storage; nothing readable yet |
| `'idle'` | Nothing to send, caught up as far as the client knows |
| `'syncing'` | Sending or receiving |
| `'offline'` | The last attempt failed (no network, server down); retrying with backoff (1 s doubling to 60 s: the `retry` option) |
| `'updateNeeded'` | The server refused this schema version; writes keep queueing |

`online` is `phase !== 'offline'`; `synced` is `pending === 0 && phase === 'idle'`. `pending` counts transactions, not rows; local-only writes never count. `lastSyncedAt` starts `null` on every launch. With `local()` the device confirms its own writes on the next tick.

```ts
import type { ClientStatus } from 'ferrysync';

import { sync } from './sync';

export const label = (status: ClientStatus) =>
  status.synced ? 'Saved' : status.online ? 'Saving...' : 'Offline: changes will sync later';

const stop = sync.onStatus((status) => console.log(label(status)));
stop();
```

Most apps need one indicator, if any.

## Forcing and waiting

```ts
import { sync } from './sync';

window.addEventListener('online', () => void sync.syncNow()); // skip the backoff wait

// Everything the user did reached the server (or the wait timed out).
await sync.whenSynced({ signal: AbortSignal.timeout(5_000) });
if (!sync.status.synced) console.warn(`${sync.status.pending} changes are not on the server yet`);

// Every write so far is stored on the device: safe to let a CLI or test process end.
await sync.flush();

// Recovery only (a "Reload data" button): download everything again, keeping pending writes.
try {
  await sync.refetch();
} catch {
  // Offline, or an app update is needed: refetch rejects when the download did not happen.
}
```

`syncNow()` never rejects (read the status). `whenSynced` can wait forever while offline: pass a `signal`. React Native: call `syncNow()` when `AppState` becomes `'active'`.

## Server refusals: `onRejected`

The device already rolled the write back. `onRejected({ code, message, name, changes, transaction })` tells the app why. `changes` are typed by table; narrow on `table` and `kind` (`'create'` has `row`, `'update'` has `patch` and `previous`, `'delete'` has `previous`).

```ts
import { createSync } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({
  schema,
  onRejected: ({ code, message, changes }) => {
    for (const change of changes) {
      if (change.table === 'tasks' && change.kind === 'create') {
        showToast(`"${change.row.title}" could not be saved: ${message ?? code}`);
      }
    }
  },
});
```

Codes: see [ferrysync-troubleshooting](../../ferrysync-troubleshooting/references/error-codes.md). `'forgotten'` comes from the device itself.

## Other `createSync` options

| Option | Default | |
| --- | --- | --- |
| `storage` | `memoryStorage()` | Lost on reload: always set one in an app |
| `backend` | `local()` | |
| `onInvalidRow` | none | A stored or received row failed its schema and was left out |
| `pushDelayMs` | `0` | Wait after a write before sending, to batch bursts |
| `retry` | 1 s to 60 s | `{ initialMs, maxMs }`, doubling |
| `undo` | 100, stored | `{ limit, persist }` |
| `createId`, `now`, `scheduler` | defaults | Tests |

`sync.close()` stops for good (reads keep the last data, writes throw): not a sign-out.

## Storages

| Storage | Where | Notes |
| --- | --- | --- |
| `memoryStorage()` | tests, demos | The default |
| `indexedDbStorage(name?)` | web | Default web choice |
| `localStorageStorage(key?)` | small web apps | About 5 MB per origin |
| `sqliteStorage(db)` | Expo, expo-sqlite | A file; tables `sync_records`, `sync_outbox`, `sync_meta`; `{ prefix }` |
| `opSqliteStorage(db)` | op-sqlite | Same tables |
| `mmkvStorage(mmkv)` | react-native-mmkv 3 or 4 | An instance of its own: `reset` removes every key under the prefix |
| `keyValueStorage(kv)` | AsyncStorage, any string store | `{ get, set, remove, keys }`, each may return a promise |

Every storage writes atomically, and none trusts what it reads back (`onCorruptEntry` hears a skipped entry). `reset` clears the storage: keep app data out of its tables and prefix. A storage that fails to load rejects `sync.ready` (`sync.reset()` recovers by clearing it). Moving storages is not automatic: a new one starts empty and downloads from the server.

### Two tabs on the web

IndexedDB and localStorage storages take an exclusive Web Lock on first `load`. The second tab fails with `StorageLockedError` (`code: 'locked'`), also rejecting `sync.ready`, or waits with `onLocked: 'wait'`. Sharing one database between tabs is planned, not built.

```ts
import { StorageLockedError, indexedDbStorage } from 'ferrysync';

export const strict = indexedDbStorage('app'); // load rejects with StorageLockedError
export const patient = indexedDbStorage('app', { onLocked: 'wait' }); // waits for the first tab to close

export const isLocked = (error: unknown) =>
  error instanceof StorageLockedError && error.code === 'locked';
```

Put an error boundary above `SyncProvider` that catches it (see [react-and-adapters](react-and-adapters.md)).

### Writing a storage

Three methods: `load()` (everything, one consistent read), `write(change)` (atomic: all lands or nothing; `clearRecords`, then `deleteRecords`, then `putRecords`; `deleteOutbox` before `putOutbox`; `setMeta` merges), `clear()`. No shared objects with what is stored. Prove it with `storageConformanceCases`: [ferrysync-testing](../../ferrysync-testing/SKILL.md). For key-value stores use `keyValueStorage` instead.

## Accounts: sign-in and sign-out

An app can start with no account and no server. `local()` is the default backend. At sign-in the same data moves to the server; at sign-out the device starts over.

```ts
import { http, local } from 'ferrysync';

import { sync } from './sync';

const backend = http({
  url: 'https://api.example.com/sync',
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
});

// Sign-in: keep what the user did without an account, and upload it.
await sync.connect(backend, { upload: true });

// Sign-out: wipe the device, and go back to having no account.
const signOut = async () => {
  await sync.whenSynced({ signal: AbortSignal.timeout(5_000) });
  const { pending } = sync.status;
  if (pending > 0 && !(await confirmDiscard(pending))) return; // keep the account until they reach the server
  await sync.reset(local(), { keepLocalOnly: true }); // drafts and settings stay on the device
};
```

| `connect` `upload` | The device's rows | Pending writes | Use when |
| --- | --- | --- | --- |
| `true` | Kept, sent as new rows (each its own transaction named `sync.upload.v1`, so a refused row loses only itself) | Kept, sent after them | The user signs in on a device they used anonymously |
| `false` | Replaced by what the account has | Dropped | The account already has its data elsewhere |

Either way local-only rows stay and the undo history is cleared. Rows the device created are private to the signing-in user unless the schema puts them in a space. When unsure, ask the user: "Keep the data on this device?".

`reset(backend?, { keepLocalOnly })` wipes every row, pending write, local-only table (unless `keepLocalOnly`), the undo history and the sync cursor, then starts again on `backend` (the current one by default). The device starts as a new client, so nothing kept is uploaded to the next account. Wipe and keep happen in one storage write. While it runs, reads find nothing and writes throw; `sync.ready` is the promise of the new start. The client object stays the same: tables, queries, `SyncProvider` (fallback until the new start), Zustand, Jotai and Legend-State follow; `sync.engine` is replaced (rebind anything bound to the engine itself).

`connect` and `reset` run one at a time in call order. The server knows the user from the auth headers: nothing the client sends picks the user. A device belongs to the first user who syncs with it: another user on it without a wipe gets `403`. `onUnauthorized` fires on every 401: refresh the token there or sign out with `reset(local())`.

### `http` options

| Option | Default | |
| --- | --- | --- |
| `url` | required | The route without the endpoint |
| `headers` | none | An object, or a function called before every request |
| `realtime` | `true` | Long-poll `wait` |
| `pollIntervalMs` | none | With `realtime: false`, pull this often too (throws without `realtime: false`) |
| `onUnauthorized` | none | Called on a 401 |
| `timeoutMs` | `30000` | `Infinity` turns it off |
| `fetch` | global | Your own, for tests or a network layer |
