# Symptoms: cause and fix

Every row ends with a check. Do not mark a symptom fixed until the check passes.

## Nothing syncs, or the status is offline

| Symptom | Likely cause | Fix | Check |
| --- | --- | --- | --- |
| `lastError` mentions a network failure, no request reaches the server | Wrong `url`; the client `url` includes the endpoint (`/api/sync/push`) | `url` is the mount without the endpoint: `/api/sync` | Requests to `/api/sync/push` and `/pull` appear |
| Same on a phone or emulator | `localhost` is the device itself | Android emulator `10.0.2.2`, a phone the computer's LAN IP; iOS simulator `localhost` works; allow cleartext HTTP in dev builds | `curl` from the device's network reaches the route |
| Browser console: CORS error, preflight fails | App and API on different origins | Dev: proxy the sync path from the dev server. Prod: answer preflight before the route, allowing `authorization` and `content-type`. Ferry does not do CORS | A `POST` preflight returns 2xx |
| `404 unknown_endpoint` | Wrong mount: Next.js needs `[endpoint]`; Express needs `app.use`, not `app.post`; Hono needs `/*` | Fix the mount | `curl -X POST <url>/pull` gives 401, not 404 |
| 401 on everything | `auth` returns `null`: cookie not sent cross-origin, header missing, token expired or not verified | Send `headers` (a function, so refreshed tokens are used); check `auth` with a real token | `curl` with the token gives 200 |
| 401 only for some users | `auth` returns different ids or `null` for a session type | Log what `auth` sees (not the token) | |
| 500 `internal` | A hook threw, a store failed, `auth` threw | Read `onError` | |
| Requests succeed but nothing appears on the other device | The other user is not in the space; or the table is private | `syncServer.spaces.members('project:<id>')`; check the space function | `members` lists them |
| `store.ready()` rejects at startup with a message | A mirror's table, key or column is wrong, or `migrate: false` and the tables are not at this release's version | Do what the message says (add the column, run `syncTablesSql` statements) | `await store.ready()` resolves |
| Server starts, all pushes 500 with `NOT NULL` violation | A mirror table has a `NOT NULL` column without a default that the schema does not know | Add a default or add the field to the schema | A push succeeds |
| Server deleted and recreated, devices wait forever | The device synced with the old database and waits for history the new one lacks | Clear the app's local data (browser: Application, Clear site data) or `reset` | The device downloads fresh |

## Pending never reaches 0

| Symptom | Likely cause | Fix | Check |
| --- | --- | --- | --- |
| `pending` stays, `phase` `offline` | Network or 5xx loop | The row above for the actual error | `phase` returns to `idle` |
| `pending` stays, `phase` `idle` or `syncing`, server logs a hook error | A hook that always throws: the device retries the same transaction forever and blocks its outbox | Make the hook return a refusal for "no", throw only for "try later" | The transaction is confirmed or rejected |
| Pushes fail with 413 | A transaction bigger than `maxBodyBytes`, or a framework body limit | Split large operations into several transactions; raise the framework limit. A single transaction over the server limit keeps retrying (known gap) | The next push is 200 |
| `phase` is `updateNeeded` | The app's schema `version` is outside the server's `versions` | Update the app, or include the version in `versions` | `syncNow()` then `idle` |
| Stuck after a long time offline | Retention forgot answers; device re-bootstraps | Wait for the download; check retention vs offline spans | `lastSyncedAt` set |
| `local()` backend, `pending` flickers | The device confirms its own writes on the next tick | Normal | |

## A write disappeared or reverted

| Symptom | Likely cause | Fix | Check |
| --- | --- | --- | --- |
| A new row appears then vanishes | The server rejected it. `onRejected` has the code | [error-codes](error-codes.md) | The row stays |
| A field reverts to another value | Last writer wins: another device's write to the same field was applied later | Expected. Model counters and lists as rows | |
| An edit of a deleted row has no effect | Delete wins: `deleted` rejection | Expected | |
| A deleted row came back | A `create` with the deleted id restores it (that is how undo works); or an old writer re-created it | Do not re-create ids you deleted; check the legacy writer | |
| Data written straight to the database never reaches devices | Not in the sync log; next sync write overwrites it | Use `syncServer.write`, or `log` after the write; `backfill` for rows sync never had | The device receives it |
| Rows vanish after `removeMember` | Expected: the device drops the space's rows and its pending changes in it | | |
| Signed out and the data is gone | `reset` wipes the device (pending writes included) | Check `pending` first; `keepLocalOnly` for device-only data | |
| `forgotten` rejection | Offline longer than `retention.days` | Raise `days` | |

## Visibility and permissions

| Symptom | Likely cause | Fix | Check |
| --- | --- | --- | --- |
| Creating a project offline is `forbidden` on sync | `claimSpace` missing, or does not return `true` for the founding row | Add a `claimSpace` that returns `true` only for the row that creates the space (see ferrysync-server, auth-and-spaces) | The project syncs |
| A space whose members left is `forbidden` forever | A space with rows but no members is never claimed again | `spaces.addMember`, or delete its rows | |
| A task update moving `projectId` is `forbidden` | The writer must belong to both spaces | Add membership | |
| Another user's private rows visible | Someone was added to a `user:<id>` space | Remove them; never do that | `spaces.of(userId)` |
| All rows appear for everyone | A space function returns the same constant for everything | Make it depend on the row | |

## Duplicates

| Cause | Fix |
| --- | --- |
| Two writers: the old REST endpoint and Ferry both create rows | One writer per feature; route the old endpoint through `write` or `log` |
| A migration script created rows with new ids, and `backfill` added the originals | Reuse the existing ids; `backfill` skips ids sync has |
| `create` in render, or in an effect that runs twice (React Strict Mode in dev) | Write in handlers; guard effects |
| Two clients over one storage | One client per app, in its own module (Fast Refresh) |
| A copied device or restored backup | Automatic: the server answers `conflict` and the copy takes a new client id |

## Realtime delays

| Symptom | Cause | Fix |
| --- | --- | --- |
| Changes arrive about 15 s late | Several instances, default in-memory `broadcast` | Pass a shared `broadcast` (Redis, Postgres `LISTEN`/`NOTIFY`) |
| A network error every 10 s (Bun) | `Bun.serve` closes quiet requests after 10 s | `idleTimeout: 40` |
| A 504 every 30 s | A proxy, balancer or function timeout under 30 s | Raise it above 30 s (Lambda: above 30 s, default is 3 s; Vercel: `maxDuration = 60`) |
| Edits in one tab update only after a reload | Two tabs: the second failed with `StorageLockedError` | Error boundary or `onLocked: 'wait'` |
| `realtime: false` and changes only on write | By design | `pollIntervalMs`, or `syncNow()` on focus |
| Serverless: after-response work does not run | No `waitUntil` | Pass `waitUntil` (`after` in Next.js, `ctx.waitUntil`) |

## Version and schema mismatches

| Symptom | Cause | Fix |
| --- | --- | --- |
| `updateNeeded` for some users | They run an app version outside `versions` | Include it, or have them update |
| `invalid` rejections right after a schema change | Renamed or retyped a field without a version bump | Revert, or bump `version` and accept both |
| `onInvalidRow` fires | Stored or received rows no longer fit the schema (a tightened validation) | Keep changes additive; loosen the schema |
| Server refuses to start after upgrading `ferrysync` | `migrate: false` and the new release changed the tables, or the database is newer than the release | Add the release's statements to your migrations; upgrade `ferrysync` |
| New app version cannot sync | App `version` above the server's `max` | Deploy the server first |

## React and React Native

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank screen, no error | `SyncProvider` fallback is `null` and storage is slow or failed | Add a fallback; error boundary for storage failures |
| `useQuery` returns a new array every render | A predicate query built inline | `useQuery(() => sync.tasks.where(fn), [deps])` |
| Writes throw "not ready" | Written before `sync.ready` | Await it, or render inside `SyncProvider` |
| Server-rendered page shows the fallback only | `ready` never resolves during SSR | Expected: client components |
| Data lost on reload | `memoryStorage()` (the default) | Pass a real storage |
| Works on web, fails on a device | `localhost` url; no `AppState` sync; cleartext HTTP blocked | See "Nothing syncs" |
| `sqliteStorage` fails | Database is `:memory:`, or expo-sqlite web without exclusive transactions | Use a file; see `docs/client/storages.md` |
| MMKV data wiped by `reset` | The MMKV instance is shared with app keys | Give the storage an instance of its own |
| Hermes missing a method | Code in the app's bundle used `structuredClone`, `Array.prototype.at`, `toSorted`, `toReversed`, `Object.hasOwn` or `findLast` | Ferry avoids them; remove them from code in the same bundle |
| Ids look less random | No Web Crypto on Hermes: random part from `Math.random` | Fine for ids: they must be unique, not secret |
| `Intl` collation ignored | Some Hermes builds lack `Intl` | Order falls back to code units; check `typeof Intl` |
| Changed `sync.ts` and things broke | Fast Refresh created a second client over the same storage | Reload the app after editing that module |
| Zustand/Jotai values never update | Jotai: read from the default store instead of `syncAtoms.store`; Legend: binding made after reading | Pass the store; bind first |
| TanStack Query shows a spinner for local rows | Ferry reads wrapped in `useQuery` | Use `useLiveQuery` for local rows |

## Postgres, ORMs, Cloudflare

| Symptom | Cause | Fix |
| --- | --- | --- |
| Prisma transaction timeout on first download | Default 5 s | `prismaDriver(prisma, { dialect, timeout })` |
| PgBouncer or Supavisor errors with prepared statements | postgres.js prepared statements in transaction mode | `postgres(url, { prepare: false })` |
| Realtime via `LISTEN` does nothing | The listening connection goes through a pooler | A direct connection |
| `within` is a type error | The store's driver cannot join your transaction (SQLite drivers, `durableObjectSqlite`, `d1Store`) | Use `write` without `within`, or Postgres |
| `D1ConflictError` | Two writers on one D1 database | One coordinator per database |
| `log` or `backfill` not available | `d1Store` has no mirrors | Use Postgres or SQLite |
| `node:sqlite` not found | Needs Node 22.13+ | Upgrade, or Postgres |
| Many instances share one SQLite file and writes stall | One process per file | Postgres |

## Last resorts (ask first)

| Action | Effect | Confirm with the user |
| --- | --- | --- |
| `sync.refetch()` | Downloads everything again, keeps pending writes | Safe, for recovery screens |
| `sync.reset(...)` | Wipes the device: rows, pending writes, undo history | Name the device and what is lost |
| `syncServer.afterRestore(...)` | Every device downloads again | After a restore only |
| Dropping `ferry_*` tables | Destroys the log and memberships | Explicit, named confirmation |
