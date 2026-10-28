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

Ferry has no built-in metrics yet: log from `onError`, `onRejected` and the status in the app (see [ferrysync-production-readiness](../../ferrysync-production-readiness/SKILL.md)).

## Rollback

| Situation | Action | Data risk |
| --- | --- | --- |
| New client path misbehaves | Flip the flag off: the app reads and writes the old API again | Rows written through Ferry are already in the old tables (mirror, same transaction). Writes still waiting in a device's outbox are not: devices keep syncing them if the route stays up. Keep the route up |
| The route misbehaves | Take the route down or return 503 (`close()` does that): devices keep working offline and retry. Do not delete `ferry_*` tables | None while rows only changed through sync |
| Old writer wrote a mirrored table without `log` | Run `syncServer.log(tx, ...)` for those rows, or fix the writer. `backfill` only adds rows sync does not have: it will not repair an updated one | Devices show stale values until the next sync write or a `log` |
| Bad schema change | Fix forward additively. A breaking change needs a `version` bump and `versions: { min, max }` on the server | See [ferrysync-client](../../ferrysync-client/SKILL.md) schema evolution |
| Abandoning Ferry for a feature | Flag off, stop the route, keep the mirrored tables (they are the app's own and current). Drop `ferry_*` tables only with the user's explicit, named confirmation | The mirror tables hold the latest state |

Rolling a release of `ferrysync` back is not supported once a newer release upgraded the store's tables: the older release refuses to start. Upgrade the server first, then the apps.

## Cutover day checklist

1. Backups of the database exist and a restore was rehearsed, including `afterRestore` ([ferrysync-server](../../ferrysync-server/SKILL.md)).
2. The server is deployed with timeouts above 30 s and a shared database if several instances.
3. `versions` on the server accepts every app version in the wild.
4. The old endpoints that write mirrored tables call `write` or `log`.
5. The flag, the monitoring and the rollback owner are named.
