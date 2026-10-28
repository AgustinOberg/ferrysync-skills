# Conformance kits and the simulator

Use these when the user writes a piece Ferry plugs into, or wants confidence about concurrency. For an ordinary app they are optional.

## Conformance kits

Each plug point has a kit that proves an implementation correct. Every case is `{ name, needs, run }`; a failure throws `ConformanceError` saying what was expected. `needs` lists optional abilities; skip cases the target lacks with `canRunStorageCase`, `canRunServerStoreCase`, `canRunProtocolCase`. Each case builds a fresh target, so cases are independent.

| Kit | Proves | Needs from you |
| --- | --- | --- |
| `storageConformanceCases` | A `StorageAdapter` (`load`, `write`, `clear`) | `create()`, and optionally `reopen()` (a new instance over the same data) and `failNextWrite()` |
| `serverStoreConformanceCases` | A server store (a SQL driver's `sqliteStore` or `postgresStore`, or a `ServerStore`) | `create()`: a fresh, empty store each time |
| `protocolConformanceCases` | A whole backend through a `Transport` | A `ProtocolConformanceBackend`: see `docs/internals/testing.md` and `docs/internals/server.md` |

A custom storage:

```ts
import { memoryStorage } from 'ferrysync';
import { canRunStorageCase, storageConformanceCases } from 'ferrysync/testing';
import { describe, it } from 'vitest';

describe('my storage', () => {
  for (const testCase of storageConformanceCases) {
    const shared = memoryStorage(); // stand in for the storage under test
    const target = {
      create: async () => shared,
      reopen: async () => shared, // a new instance over the same data, as after a restart
    };
    it.skipIf(!canRunStorageCase(target, testCase))(testCase.name, () => testCase.run(target));
  }
});
```

Replace `memoryStorage()` with the storage under test. The storage contract: `write` is atomic and resolves once the change would survive a restart (a rejection means nothing applied); inside a write, `clearRecords`, then `deleteRecords`, then `putRecords`, `deleteOutbox` before `putOutbox`, `setMeta` merges; no objects shared with what is stored; the client never runs two calls at once.

A SQL driver or store (here an in-memory SQLite store; use a fresh database each time):

```ts
import { nodeSqlite, sqliteStore } from 'ferrysync/server';
import { canRunServerStoreCase, serverStoreConformanceCases } from 'ferrysync/testing';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'vitest';

describe('my server store', () => {
  for (const testCase of serverStoreConformanceCases) {
    const target = { create: async () => sqliteStore(nodeSqlite(new DatabaseSync(':memory:'))) };
    it.skipIf(!canRunServerStoreCase(target, testCase))(testCase.name, () => testCase.run(target));
  }
});
```

Two rules matter most for a store of your own: sync ids become visible in commit order (a device that read id 42 never later finds a 41), and a write transaction sees and locks what it reads, so two pushes never both claim the same space or row.

## The seeded simulator

`runSimulation` runs many devices of several users against one reference server, over a faulty network, on a virtual clock: random transactions, undo and redo, restarts, crashes mid-write, membership changes, schema version mismatches, sign-ins from the local authority, log prunes and retention, cloned devices, spaces founded offline, restores from backup. Same seed, same run. It checks that nothing confirmed was not applied, and after the faults stop, that every device shows exactly what the server holds for its user, nothing is left to send, no deleted row came back, every handle settled, and stored undo histories match memory.

```ts
import { describeSimulation, runSimulation } from 'ferrysync/testing';
import { expect, it } from 'vitest';

for (let seed = 1; seed <= 50; seed += 1) {
  it(`converges (seed ${seed})`, async () => {
    const result = await runSimulation({ seed, clients: 4, steps: 200 });
    expect(result.problems, describeSimulation(result)).toEqual([]);
  });
}
```

| Option | Default | |
| --- | --- | --- |
| `seed` | required | Same seed, same run |
| `clients` | `3` | Devices |
| `users` | half the devices, rounded up | |
| `steps` | `150` | Random steps before faults stop |
| `faults` | some of every fault | `FaultRates`, as for `faultyTransport` |
| `transport` | `'direct'` | `'direct'`, `'http'`, `'http-subscribe'` |
| `store` | `memoryServerStore` | A function returning a new, empty store for each run: run it on your store |
| `clones`, `newSpaceShare`, `localShare`, `pageSize` | see docs | |

**A failing seed becomes a regression test**: copy the seed into a dedicated `it`, keep it forever, then fix.

## Fault injection

`faultyTransport(inner, options)` wraps a transport in a seeded unreliable network (`seed` required; `dropRequest`, `dropResponse`, `duplicatePush`, `dropPoke`, `latency`, `scheduler`). A dropped response is the interesting case: the server applied the push, the client did not hear, and it resends; a correct backend answers without applying twice. `transport.setEnabled(false)` lets a scenario settle; faults throw `TransportFaultError` (`fault` is `requestDropped` or `responseDropped`). It wraps engine-level transports, so it belongs to the engine toolbox: `docs/internals/testing.md`.

## Engine level

`createSyncEngine`, `localAuthority`, `directTransport`, `createProtocolServer` and `memoryServerStore` are the engine-level toolbox, for tests of an engine-based integration. Apps on `createSync` do not need them.
