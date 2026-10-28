# Stack matrix

Pick one row per section. Every name below is exported by the entry point shown. Imports are checked against the sources by `bun run check` in this repo.

## Client storage (`ferrysync`)

| Platform and library | Use | Notes |
| --- | --- | --- |
| Web (default) | `indexedDbStorage('app')` | One tab at a time: a second tab gets `StorageLockedError` (`code: 'locked'`), or waits with `{ onLocked: 'wait' }` |
| Small web data | `localStorageStorage('app')` | About 5 MB per origin |
| Expo, expo-sqlite | `sqliteStorage(openDatabaseSync('app.db'))` | Database must be a file, not `:memory:`. On expo-sqlite web, pass a driver with a plain transaction: see `docs/client/storages.md` |
| React Native, op-sqlite | `opSqliteStorage(open({ name: 'app.db' }))` | Not isolated from the app's own queries on that database: give it its own |
| React Native, MMKV 3 or 4 | `mmkvStorage(createMMKV({ id: 'sync' }))` | Give it an instance of its own: `reset` removes every key under the prefix |
| AsyncStorage or any string store | `keyValueStorage({ get, set, remove, keys })` | |
| Tests, demos | `memoryStorage()` | The default. Lost on reload |

## Client backend (`ferrysync`)

| State | Use |
| --- | --- |
| No account, or before sign-in | `local()` (default) |
| Account | `http({ url, headers, onUnauthorized })`. `url` is the route without the endpoint. A device has no origin: React Native needs the full URL |
| Sign-in later | `sync.connect(http(...), { upload: true })` |
| Sign-out | `sync.reset(local())` |

## Server mount (`ferrysync/server`)

| Backend | Mount | Page |
| --- | --- | --- |
| Hono (any runtime) | `app.all('/api/sync/*', (c) => syncServer.fetch(c.req.raw))` | `docs/examples/hono.md` |
| Next.js route handler | `app/api/sync/[endpoint]/route.ts`: `export const POST = syncServer.fetch; export const maxDuration = 60` | `docs/examples/nextjs.md` |
| Bun | `Bun.serve({ idleTimeout: 40, fetch: (r) => syncServer.fetch(r) })` | `docs/examples/bun.md` |
| Express | `app.use('/api/sync', toNodeHandler(syncServer))`, before body parsers or with a raised `limit` | `docs/examples/express.md` |
| Node `http`, Fastify, Nest | `toNodeHandler(syncServer)` | `docs/examples/node.md` |
| Cloudflare Workers | D1 behind `durableObjectCoordinator`, or Postgres per request | `docs/examples/cloudflare-workers.md` |
| Deno | `Deno.serve(app.fetch)` with Hono | `docs/examples/hono.md` |

## Server store and driver (`ferrysync/server`)

| Hosting | Store | Driver |
| --- | --- | --- |
| One server process, a persistent volume | `sqliteStore` | `nodeSqlite(new DatabaseSync(...))` (Node 22.13+), `bunSqlite`, `betterSqlite3` |
| Several instances, serverless, Vercel, Lambda | `postgresStore` | `nodePostgres(pool)`, `postgresJs(sql)` (give it `prepare: false` behind a transaction-mode pooler), or the ORM's |
| Existing Prisma | `postgresStore` or `sqliteStore` | `prismaDriver(prisma, { dialect })` |
| Existing Drizzle | either | `drizzleDriver(db, { dialect, sql })` |
| Cloudflare D1 | `d1Store(env.DB)` inside one Durable Object | none; use `durableObjectCoordinator(env.SYNC).fetch(request)` from the Worker |
| Durable Object SQLite | `sqliteStore(durableObjectSqlite(ctx.storage))` | |
| Tests, PGlite | `memoryStore()`; `postgresStore(pglite(new PGlite()))` | |
| Another SQL library | `sqliteStore` or `postgresStore` over your own `SqlDriver` | `docs/examples/own-database.md` |

`mirror` (keep the app's own tables in sync) works on `sqliteStore` and `postgresStore`, not `d1Store`. `within` (join your transaction) works only with `nodePostgres`, `postgresJs`, `pglite`, `prismaDriver`, `drizzleDriver`.

## UI binding

| App | Use |
| --- | --- |
| React, React Native | `SyncProvider` once, `useQuery(sync.tasks.where({ ... }))`. With TanStack Query or SWR in the same app, import it as `useLiveQuery` |
| Already Zustand | `createSyncStore(sync)` from `@ferrysync/zustand` (peer: `zustand` 5+) |
| Already Jotai | `createSyncAtoms(sync)` from `@ferrysync/jotai` (peer: `jotai` 3+). Always pass `syncAtoms.store` |
| Already Legend-State | `bindLegendState(sync, [bindTable(sync.tasks, store$.tasks)])` from `@ferrysync/legend-state` |
| Vue, Svelte, Solid, vanilla | `query.get()` and `query.subscribe(listener)`: `docs/examples/own-bindings.md` |

## Auth

Ferry has none. `auth(request)` returns the user's stable id or `null` (a clean 401). Recipes: session cookie, bearer JWT with `jose`, Better Auth, Auth.js, Supabase, Firebase: `docs/server/auth.md`, `docs/examples/own-auth.md`.
