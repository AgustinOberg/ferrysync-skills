# Stores, migrations and deploy

## Pick the store

| Store | For |
| --- | --- |
| `memoryStore()` | Tests and demos only: in memory, lost on restart |
| `sqliteStore(driver, options?)` | One server process, a file on a persistent volume |
| `postgresStore(driver, options?)` | Production with several instances, serverless |
| `d1Store(env.DB, options?)` | Cloudflare D1, inside one Durable Object (experimental) |
| `sqliteStore(durableObjectSqlite(ctx.storage))` | A Durable Object's own SQLite (experimental) |

| Driver | Wraps | `within` |
| --- | --- | --- |
| `nodeSqlite(db)`, `bunSqlite(db)`, `betterSqlite3(db)`, `durableObjectSqlite(ctx.storage)` | node:sqlite, bun:sqlite, better-sqlite3, a DO's storage | no |
| `nodePostgres(pool)` | pg's `Pool` | a pool client inside `BEGIN` |
| `postgresJs(sql)` | postgres.js | the `sql` of `sql.begin` |
| `pglite(db)` | `@electric-sql/pglite` | its transaction's `tx` |
| `prismaDriver(prisma, { dialect, timeout? })` | Prisma | an interactive transaction's `tx` |
| `drizzleDriver(db, { dialect, sql })` | Drizzle | a Drizzle `tx` |

A driver is a few lines over a database library; Ferry imports none. For a library it does not ship (libSQL/Turso), write a `SqlDriver` and prove it with `serverStoreConformanceCases`: `docs/examples/own-database.md`, and [ferrysync-testing](../../ferrysync-testing/SKILL.md).

SQL store facts:

- SQLite: one write at a time (`BEGIN IMMEDIATE`), one process per file, 3.38+. Postgres: writes in `READ COMMITTED` lock only what they touch, reads see one snapshot. Behind a transaction-mode pooler give postgres.js `prepare: false`. PGlite has one connection: fine for tests and local-first desktop.
- No string may contain U+0000 (refused as `invalid` on every store).
- postgres.js: pass an instance without a `transform` that renames columns.
- Never write to `ferry_*` tables.
- Options: `prefix` (default `ferry_`, 1 to 40 lowercase letters, digits or `_`), `migrate` (default `true`), `mirror` (SQL stores only).

## Migrations

`migrate: true` (default) creates the tables on first use and upgrades them after a release that changes them. When the project's migration tool is the only thing allowed to change the database, put the statements in it and open the store with `migrate: false`:

```ts
import { nodePostgres, postgresStore, syncTablesSql } from 'ferrysync/server';
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';

const statements = syncTablesSql({ dialect: 'postgres', prefix: 'ferry_' });
writeFileSync('migrations/0007_ferry/migration.sql', `${statements.join(';\n')};\n`);

export const store = postgresStore(nodePostgres(new Pool()), { prefix: 'ferry_', migrate: false });
```

Each statement is idempotent. With `migrate: false` the store checks at first use that the tables match this release and fails with a message saying what to run. Read the release notes of every `ferrysync` upgrade: a release that changes the tables says what to add (version 2 added a nullable `updated_at` to `ferry_push_results`). A newer database than the release is refused (upgrade `ferrysync`); a rolled-back release cannot read a newer layout.

Tables: `ferry_state`, `ferry_clients`, `ferry_memberships`, `ferry_records`, `ferry_log`, `ferry_push_results`, `ferry_meta`.

## What every platform needs

| Need | Why | Applies to |
| --- | --- | --- |
| A shared database | Every instance must see the same log | Several instances, serverless |
| Requests of 30 s or more | A realtime `wait` is held up to 30 s with nothing sent | Every platform: check its limits |
| `waitUntil` | Work after the response must finish before the function sleeps | Serverless |
| A `broadcast` | Waits held by other instances hear of a change at once, not within 15 s | Several instances (optional) |

## By platform

| Platform | Store | Settings |
| --- | --- | --- |
| One server or container (VPS, Fly.io, Railway, Render) | SQLite on a persistent volume, or Postgres | A proxy in front must allow 30 s of silence (nginx's default `proxy_read_timeout` of 60 s does) |
| Several servers behind a load balancer | Postgres | The balancer's idle timeout above 30 s; a `broadcast` |
| Vercel (Next.js) | Postgres | `maxDuration = 60` and `waitUntil: (promise) => after(promise)` |
| Cloudflare Workers | `d1Store` behind `durableObjectCoordinator`, or Postgres through Hyperdrive | One coordinator per D1 database, never two |
| Cloudflare Durable Objects | `sqliteStore(durableObjectSqlite(ctx.storage))` | One object per sync authority |
| AWS Lambda | Postgres | Function timeout above 30 s (Lambda's default is 3 s). API Gateway's 29 s limit still works: devices ask for 25 s holds |
| Bun | SQLite or Postgres | `idleTimeout: 40` (the default closes quiet requests at 10 s) |

Symptom of a wrong timeout: a 504 every 30 s in the logs, or a network error every 10 s on Bun. Devices recover but realtime turns slow.

## Graceful shutdown

`close()` answers every held `wait`, refuses new requests with 503 (devices retry), and resolves once background work has finished:

```ts
import { syncServer } from './sync-server';

process.on('SIGTERM', () => {
  void syncServer.close().then(() => process.exit(0));
});
```

## SQLite in production

Fine for one process: the file must outlive deploys (a mounted volume), one instance only, back it up like any database (`VACUUM INTO`, Litestream, volume snapshots). To run more instances, move to Postgres.

## Shipping a new schema version

Deploy the server first, accepting both versions; raise `min` last, it is the only step that turns anyone away:

```ts
import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema'; // now at version 2

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  versions: { min: 1 }, // still accept version 1 apps; max defaults to schema.version
});
```

1. Deploy the server with `versions: { min: n, max: n + 1 }`.
2. Release the app at version `n + 1`.
3. When few old clients remain, raise `min` to `n + 1`: old apps keep working offline, queue writes, and sync once updated.

A client newer than `max` is refused too: the server must be deployed before the app. Client side: [ferrysync-client](../../ferrysync-client/SKILL.md).
