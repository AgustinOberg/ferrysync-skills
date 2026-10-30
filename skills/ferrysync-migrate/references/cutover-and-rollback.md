# Cutover and rollback

Per feature. The mirror keeps the old tables current, so the old path and the new path agree as long as every writer goes through sync.

## Rollout

| Stage | What | Gate to the next stage |
| --- | --- | --- |
| 0 | Phase 1 and 2 deployed. Backfill done. Nobody reads through Ferry | Row counts match. Harness test of old-to-new and new-to-old passes |
| 1 | Internal users on the new client path (flag on) | A week without data complaints. `onRejected` and `onError` logs reviewed |
| 2 | A percentage of users, then everyone, for this feature | No growth in `rejected` codes, `lastError` or 5xx on the route. `wait` requests not cut by proxies |
| 3 | Remove the flag and the old client code for the feature | Only after the old endpoints' traffic from current clients is zero |
| 4 | Remove the old endpoints | Only when no supported app version calls them. Keep them (writing through sync) while old mobile versions exist |

## What to watch

- Server: the route's 4xx and 5xx rates, `onError` output (failed hooks, failed broadcast publishes, 500 causes), `ferry_log` size, held `wait` requests per instance (about one per online device), database CPU.
- Client: `sync.status.lastError`, `pending` stuck above zero, `phase` stuck on `offline` or `updateNeeded`, `onRejected` codes, `onInvalidRow` reports.
- Data: counts per table between the old table and Ferry; spot-check rows across a device and the database.

Ferry can report its own numbers (request latency, refusals by code, held waits, log size) through the `metrics` option of `createSyncServer`, off by default: see `docs/server/metrics.md`. Without it, log from `onError`, `onRejected` and the status in the app (see [ferrysync-production-readiness](../../ferrysync-production-readiness/SKILL.md)).

## Rollback

| Situation | Action | Data risk |
| --- | --- | --- |
| New client path misbehaves | Flip the flag off: the app reads and writes the old API again | Rows written through Ferry are already in the old tables (mirror, same transaction). Writes still waiting in a device's outbox are not: devices keep syncing them if the route stays up. Keep the route up |
| The route misbehaves | Take the route down or return 503 (`close()` does that): devices keep working offline and retry. Do not delete `ferry_*` tables | None while rows only changed through sync |
| Old writer wrote a mirrored table without `log` | Postgres, Prisma, Drizzle: run `syncServer.log(tx, ...)` for those rows, or fix the writer. `backfill` only adds rows sync does not have: it will not repair an updated one. SQLite drivers: see the next section | Devices show stale values until the next sync write or a `log` |
| Bad schema change | Fix forward additively. A breaking change needs a `version` bump and `versions: { min, max }` on the server | See [ferrysync-client](../../ferrysync-client/SKILL.md) schema evolution |
| Abandoning Ferry for a feature | Flag off, stop the route, keep the mirrored tables (they are the app's own and current). Drop `ferry_*` tables only with the user's explicit, named confirmation | The mirror tables hold the latest state |

### SQLite: a legacy writer changed mirrored rows without sync

The SQLite drivers have no `log`, and `backfill` only adds missing rows, so Ferry has no supported repair for rows a legacy writer updated or deleted behind its back. Choose with the user:

1. **Push the differences through `write`**: a script reads the table, compares it with what Ferry holds (`write` reads with `tx.<table>.get`), and applies the updates and deletes as `system`. The mirror is rewritten with the same values and devices get the changes. This is the safe one.
2. **Start Ferry's tables over.** Only with the user's explicit confirmation naming the `ferry_*` tables and a backup of them: note `SELECT last_sync_id FROM ferry_state`, stop the route, drop the `ferry_*` tables, restart, run `afterRestore({ highestSyncId })` ([ferrysync-server](../../ferrysync-server/SKILL.md)), reload members with `spaces.addMember`, run `backfill`. I ran the mechanics (the backfill adds only live rows, so deleted legacy rows stay out) but not a device converging afterwards: for what devices do, see `docs/server/backups.md`. Every device downloads again, and the members, the devices and the log history are lost.

Then stop the writer: it must use `write` from now on.

### Undoing the table shape (a DOWN migration)

The mirror tables are the app's own, so a rollback of the shape is a migration of the app's, written with the user and run on a backup first. Stop the route first (`close()` or a 503), so nothing writes the table meanwhile.

- **Postgres**: the shape change was additive (`sync_id`, `deleted_at`). Moving back means making the integer key the primary key again and dropping what was added. Rows sync created have a `uuid` and no integer: give them one first (`UPDATE ... SET id = nextval(...) WHERE id IS NULL`), or those rows are lost to the old app. Decide with the user what happens to soft-deleted rows (`deleted_at IS NOT NULL`): delete them, or keep them.
- **SQLite**: rebuild again, the inverse of the recipe in [adoption-code](adoption-code.md): `CREATE TABLE tasks_old (id INTEGER PRIMARY KEY AUTOINCREMENT, ...)`, copy `legacy_id` into `id` for the live rows (`WHERE deleted_at IS NULL`), drop the trigger and the table, rename. Rows with a NULL `legacy_id` (made before the trigger existed) get one first.
- After either, Ferry's mirror for that table must not start: `ready()` fails on the key, by design. Keep `ferry_*` tables (never drop them without the named confirmation) and leave the route off for that table until the shape is back.

Rolling a release of `ferrysync` back is not supported once a newer release upgraded the store's tables: the older release refuses to start. Upgrade the server first, then the apps.

## Cutover day checklist

1. Backups of the database exist and a restore was rehearsed, including `afterRestore` ([ferrysync-server](../../ferrysync-server/SKILL.md)).
2. The server is deployed with timeouts above 30 s and a shared database if several instances.
3. `versions` on the server accepts every app version in the wild.
4. The old endpoints that write mirrored tables call `write` or `log`.
5. The flag, the monitoring and the rollback owner are named.
