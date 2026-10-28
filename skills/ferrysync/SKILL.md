---
name: ferrysync
description: "Entry point for Ferry (the `ferrysync` package): offline-first sync for TypeScript. Data lives on the device in a local database, writes queue in an outbox and sync through a Ferry server mounted inside the app's own backend (server-ordered log, spaces, last-writer-wins per field). Decides whether Ferry fits, picks storage, backend, server store and state binding for the stack, and gives the end-to-end path with a check after each step. Use when the user mentions Ferry, ferrysync, createSync, createSyncServer, defineSchema, offline-first or local-first sync, or asks to make an app work offline, sync devices or users, or replace a REST or TanStack Query data layer with a local database. Routes to the other ferrysync-* skills."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# Ferry: offline-first sync for TypeScript

Ferry (`ferrysync` on npm) keeps an app's data on the device and syncs it in the background. The server is a library mounted on one route of the user's own backend, over the user's own database and auth. It is not a hosted service.

## Before you write anything

1. **The docs are the source of truth.** Never invent an API, option, import path or default. When this skill and the installed package disagree, the package wins: read its types. For anything not covered here, fetch the docs index or full text: see [docs-map](references/docs-map.md).
2. **Check the package exists.** Run `npm view ferrysync version`. Ferry 0.1.0 may not be published yet. If it is a 404, stop and ask the user where to install it from (a tarball, a git URL, a workspace path). Do not guess a registry or a fork.
3. **Check what is already installed.** Read `package.json` and the lockfile for `ferrysync`, `@ferrysync/*`, `zod`, `react`, the database driver and the backend framework before choosing anything.
4. **Use the project's package manager** (the lockfile says which) and its check command. If there is an `AGENTS.md` or `CLAUDE.md`, its rules win over this skill.

## What Ferry is, in five lines

- Reads and writes hit a local database on the device: instant, offline, no loading state.
- Each write becomes a transaction in an **outbox** on the device and is pushed when there is a network.
- The server applies transactions one at a time into a **log** with increasing **sync ids**, so every device converges.
- Rows live in **spaces** (also called groups: same thing). A user receives exactly the spaces they belong to, plus their private rows.
- Conflicts: the last write the server applies wins, per field. Different fields both survive. No CRDTs.

Vocabulary and how a change travels: [vocabulary](references/vocabulary.md).

## Does it fit? Decide first, and say so honestly

| Use Ferry when | Look elsewhere when |
| --- | --- |
| The app must work offline or feel instant on a slow network | People edit the same long text at once and expect the edits to merge (use a CRDT for that field) |
| Several devices or people edit the same data and "last write to a field wins" is acceptable | A write must be approved by the server before the user sees it (a payment, a booking with stock) |
| One user's visible data fits in memory on the device | A client needs only a slice of a huge shared dataset |
| The data falls into clear sharing units (team, workspace, project, document) | The data is public, read-only, cacheable content: a plain fetch cache is simpler |

Maturity facts to tell the user before they commit (details in [ferrysync-production-readiness](../ferrysync-production-readiness/SKILL.md)): version 0.1.0; no external security review yet; no built-in account deletion API or server metrics; on the web only one tab at a time owns the local database; D1 and Durable Objects are documented as experimental; no WebSockets (realtime is long polling).

If the app has a screen that must be server-authoritative (payments), keep that on the normal API next to Ferry. Ferry and a fetching library coexist: see [ferrysync-client](../ferrysync-client/SKILL.md).

## Which skill next

| The user wants | Load |
| --- | --- |
| A new project, or a new feature with sync from day one | [ferrysync-create-app](../ferrysync-create-app/SKILL.md) |
| To move an existing app (own REST backend, TanStack Query, Firebase, Supabase, Redux/Zustand state, existing Postgres) to Ferry | [ferrysync-migrate](../ferrysync-migrate/SKILL.md) |
| Auth, spaces, hooks, write validation, stores, retention, realtime, deploy, backups | [ferrysync-server](../ferrysync-server/SKILL.md) |
| Schema changes, queries, transactions, undo, status UI, storages, sign-in and sign-out, React and state adapters | [ferrysync-client](../ferrysync-client/SKILL.md) |
| Tests for an app that uses Ferry, or for a custom storage or store | [ferrysync-testing](../ferrysync-testing/SKILL.md) |
| Something does not sync, a write disappeared, an error code | [ferrysync-troubleshooting](../ferrysync-troubleshooting/SKILL.md) |
| A review of auth, spaces and hooks before launch | [ferrysync-security-review](../ferrysync-security-review/SKILL.md) |
| A go-live checklist | [ferrysync-production-readiness](../ferrysync-production-readiness/SKILL.md) |

## Choose the pieces from the stack

Read the project, then pick one row per column. Full matrix with imports and caveats: [stack-matrix](references/stack-matrix.md).

| Piece | Decide from | Default pick |
| --- | --- | --- |
| Client storage | Platform | Web: `indexedDbStorage`. Expo: `sqliteStorage` (expo-sqlite). op-sqlite: `opSqliteStorage`. Small RN data: `mmkvStorage`. AsyncStorage: `keyValueStorage` |
| Client backend | Account state | No account yet: `local()` (the default). Has accounts: `http({ url })` |
| Server mount | Existing backend | Anything with web `Request`/`Response`: `syncServer.fetch(request)`. Node `http`, Express, Fastify, Nest: `toNodeHandler(syncServer)` |
| Server store | Existing database and hosting | One process: SQLite (`sqliteStore`). Several instances or serverless: Postgres (`postgresStore`). Cloudflare: D1 behind a Durable Object coordinator, or Postgres via Hyperdrive. Tests: `memoryStore()` |
| Store driver | Existing DB library | `nodePostgres`, `postgresJs`, `pglite`, `prismaDriver`, `drizzleDriver`, `nodeSqlite`, `bunSqlite`, `betterSqlite3`, `durableObjectSqlite` |
| UI binding | Existing state library | React with no store: `useQuery`. Zustand, Jotai, Legend-State: `@ferrysync/zustand`, `@ferrysync/jotai`, `@ferrysync/legend-state`. Vue, Svelte, Solid: `query.get()` and `query.subscribe()` |
| Auth | Existing auth | Whatever exists: `auth(request)` returns the user id or `null`. Ferry has no users of its own |

## The path, end to end

Run the check after every step. Do not move on while one fails. A check that did not run is never reported as passed.

| # | Step | Check you can run |
| --- | --- | --- |
| 1 | Install `ferrysync` and `zod` (plus the storage, driver and binding packages the matrix chose) | The package manager exits 0. `ferrysync` resolves from the app |
| 2 | Write the shared `schema.ts` with `defineSchema`: tables, `spaces`, `localOnly` | The project's type check passes. Hovering a row type shows its fields |
| 3 | Create the client with storage and no backend (`createSync`) and wire the UI | The app runs. Create a row, reload: it is still there. Airplane mode changes nothing |
| 4 | Create the server (`createSyncServer`) over the chosen store, with real `auth`, and `claimSpace` where devices create spaces | Server starts. `store.ready()` resolves |
| 5 | Mount it on one route of the backend | `curl -s -o /dev/null -w '%{http_code}' -X POST <origin>/<prefix>/pull` prints `401` (route mounted, `auth` ran). With valid credentials and `{"clientId":"c1","schemaVersion":1,"after":0}` it prints `200` |
| 6 | Point the client at the route: `backend: http({ url, headers })` | Network tab (or server log) shows `push`, `pull`, `wait` requests to the route; `sync.status.lastError` is `null` |
| 7 | Prove two devices sync, offline too | A test with `createTestHarness` passes (see [ferrysync-testing](../ferrysync-testing/SKILL.md)). Then by hand: two windows, one offline, edit both, reconnect, both converge |
| 8 | Sign-in and sign-out (`sync.connect`, `sync.reset(local())`), if the app has accounts | After sign-out and sign-in as another user, no row of the first user is visible |
| 9 | Deploy: proxy timeouts above 30 s, shared database if several instances, `waitUntil` on serverless | `wait` requests are not cut every 10 or 30 s: no repeating 504s in the logs |
| 10 | Go-live review | [ferrysync-security-review](../ferrysync-security-review/SKILL.md) and [ferrysync-production-readiness](../ferrysync-production-readiness/SKILL.md) |

Step by step recipes per stack: [ferrysync-create-app](../ferrysync-create-app/SKILL.md). For an existing app, do not follow this path as is: use [ferrysync-migrate](../ferrysync-migrate/SKILL.md).

## Do not

- Do not use `memoryStorage()` or `memoryStore()` in production: both lose data on restart.
- Do not wrap Ferry reads in TanStack Query or SWR, and do not write through mutations. Writes are plain calls: `sync.tasks.update(id, patch)`.
- Do not let a database default (`gen_random_uuid()`, a serial) choose the id of a synced row: devices create ids offline (`createId()`, UUIDv7 strings).
- Do not change synced data straight in the database, or in `ferry_*` tables. Route backend writes through `syncServer.write` (or `log` / `backfill` for adoption).
- Do not rename a table or field in place, or change a field's type, without bumping the schema `version`.
- Do not return a user's email or any value that can change from `auth`. Return a stable primary key.
- Do not put secrets or per-user data in `localOnly` tables expecting them to be private from the device user.
- Do not add a runtime dependency to a library of the user's, or pick a database, auth or state library the project has not chosen: ask.

## Reference

- [vocabulary](references/vocabulary.md): space, group, outbox, rebase, sync id, tombstone, local authority, mirror, coordinator.
- [stack-matrix](references/stack-matrix.md): every piece, its import, when to pick it, caveats.
- [docs-map](references/docs-map.md): where each topic lives in Ferry's docs, and the `llms.txt` / `llms-full.txt` files for the long tail.
