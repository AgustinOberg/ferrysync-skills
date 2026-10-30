# Realtime, retention and backups

## Realtime

Each online device keeps one `wait` request open. The server answers when something the user can see changes; the device pulls and opens the next wait. Plain HTTP, no WebSockets (not built), no extra service. A notice carries no data (spaces whose rows changed, users whose memberships changed): a lost one costs time (the wait looks at the database every 15 s anyway), never a change.

| Timing | Value |
| --- | --- |
| A device asks the server to hold | 25 s |
| The longest the server holds | 30 s |
| A held wait looks at the database anyway | every 15 s |
| Between two waits of a device | at least 1 s |

A device that sets `http({ url, realtime: false })` syncs only after its own writes and on `syncNow()`; add `pollIntervalMs` to poll.

### Several instances

Notices travel in memory by default. With several instances behind a balancer a change wakes only the waits that instance holds; the others find it within 15 s. Pass a `broadcast` shared by every instance for instant realtime: an object with `publish(notice)` and `subscribe(listener)` that delivers to every instance, the publisher included. A failed `publish` goes to `onError` and never fails the write.

Redis (ioredis; two connections, since a subscribed connection cannot publish):

```ts
import type { Broadcast, SyncNotice } from 'ferrysync/server';
import Redis from 'ioredis';

export const redisBroadcast = (url: string, channel = 'ferry:notices'): Broadcast => {
  const publisher = new Redis(url);
  const subscriber = new Redis(url);
  const listeners = new Set<(notice: SyncNotice) => void>();
  subscriber.subscribe(channel).catch((error: unknown) => console.error(error));
  subscriber.on('message', (from: string, message: string) => {
    if (from !== channel) return;
    const notice: SyncNotice = JSON.parse(message);
    for (const listener of listeners) listener(notice);
  });
  return {
    publish: async (notice) => {
      await publisher.publish(channel, JSON.stringify(notice));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
```

Then `createSyncServer({ ..., broadcast: redisBroadcast(process.env.REDIS_URL ?? '') })`. Postgres `LISTEN`/`NOTIFY` needs no other service: one direct connection (not a transaction-mode pooler) listens, the pool publishes, a notice must fit 8000 bytes, and the listener must reconnect on error: `docs/server/realtime-and-scaling.md` has the full snippet.

On Cloudflare with D1 or a Durable Object's SQLite, every request of a database goes through one object, so the default `memoryBroadcast()` already wakes every wait.

### Open requests

A server with 2,000 devices online holds about 2,000 requests, each cheap while waiting. Plan: raise file descriptor limits (`ulimit -n`), allow 30 s of silence through every proxy, check how serverless bills a held invocation, and note `maxHeldWaitsPerUser` (default 10) answers the oldest wait `timeout` when an eleventh arrives. The roadmap lists a measured cost of waking many held waits as an open item: see [ferrysync-production-readiness](../../ferrysync-production-readiness/SKILL.md).

## Retention

The server keeps a log of every change so devices catch up. Retention drops old log entries and stored push answers (`ferry_push_results`) older than `retention.days` (default 90; `false` keeps everything), and forgets devices (`ferry_clients`, one small row per install) that pushed nothing for `retention.clients.days` (default 365, or `days` when longer; `clients: false` remembers every device), by itself, after requests, at most hourly per instance: no cron. It drops history only: every row's current state stays and deleted rows stay as tombstones.

- A device offline longer than the retention finds its place in the log gone, downloads everything again, and keeps its pending changes. Choose `days` above how long users' devices stay offline.
- A forgotten device that comes back gets `forgottenClient`, nothing is applied, and it settles from the server's data and sends what is left again under a new client id. Known limit: a change applied but whose answer was lost, then undone by someone during more than `clients.days` of silence, is sent again and lands as a late write (`docs/server/retention.md`).
- A resend whose answer was pruned gets `forgotten`: the change is not applied twice, and the device settles it from the server's rows once caught up: confirmed if they show it, otherwise rolled back with `onRejected` code `forgotten` (a delete is never confirmed this way). Only what the app hears can differ.

## Backups and restore

The sync tables are in the app's database: back them up with it (snapshots, `pg_dump`, point-in-time recovery, `VACUUM INTO`, Litestream). Restoring needs one more step, because devices may be ahead of the backup.

Destructive and hard to reverse: do not run these against production without the user's explicit confirmation naming the database. Show what each step does first.

1. Stop serving sync: take the route down, or `close()` every instance. Devices keep working offline and retry.
2. Note the highest sync id the lost database handed out. If it still opens: `SELECT last_sync_id FROM ferry_state;`. If not, take it from logs or pick a generous number: skipping a billion ids costs nothing.
3. Restore the sync tables and the app's tables together, from the same moment.
4. Run `afterRestore` once, against the restored database, before any device reaches it:

```ts
import { syncServer } from './sync-server';

const { lastSyncId } = await syncServer.afterRestore({ highestSyncId: 48_210 });
console.log(`Sync resumes after sync id ${lastSyncId}`);
```

5. Redo what must not be lost between the backup and the failure: membership removals first, then additions, then the backend's writes.
6. Serve again.

What devices do: each downloads its data again on its next sync (pending changes are kept and sent afterwards; a device whose earlier changes the server lost sends its pending ones under a new client id by itself). What is lost: everything committed after the backup (changes the server had confirmed, backend writes, spaces founded after, membership changes). A too-low `highestSyncId` leaves devices at risk of skipping changes; too high costs nothing up to 2^53 - 1. Once per restore (running again costs each device one more download). On D1 run it inside the coordinator; see `docs/server/backups.md`.
