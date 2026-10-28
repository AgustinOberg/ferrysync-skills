# Databases (server stores)

`createSyncServer({ store })`. The store keeps rows as JSON, the ordered log, devices and memberships in tables prefixed `ferry_` in the user's database. They are created on first use (`migrate: true`, the default). Call `store.ready()` at startup to fail early.

| Hosting | Store |
| --- | --- |
| One process, a volume that outlives deploys | SQLite |
| Several instances, serverless | Postgres |
| Existing Prisma or Drizzle | Postgres or SQLite through the ORM's driver |
| Cloudflare | D1 behind a coordinator, see [backends](backends.md) |
| Tests, demos only | `memoryStore()`: lost on restart |

## SQLite

```ts
import { betterSqlite3, bunSqlite, nodeSqlite, sqliteStore } from 'ferrysync/server';
import Database from 'better-sqlite3';
import { Database as BunDatabase } from 'bun:sqlite';
import { DatabaseSync } from 'node:sqlite';

export const onNode = sqliteStore(nodeSqlite(new DatabaseSync('sync.db')));
export const onBun = sqliteStore(bunSqlite(new BunDatabase('sync.db')));
export const onBetterSqlite3 = sqliteStore(betterSqlite3(new Database('sync.db')));
```

One writer at a time, one process per file (another process needs a `busy_timeout` to wait). The file must live on a persistent volume, not the container's own disk. SQLite 3.38 or later. `node:sqlite` needs Node 22.13+.

## Postgres

```ts
import { nodePostgres, postgresJs, postgresStore } from 'ferrysync/server';
import { Pool } from 'pg';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? '';

export const withPg = postgresStore(nodePostgres(new Pool({ connectionString: url })));
// Behind a pooler in transaction mode (PgBouncer, Supavisor), give postgres.js `prepare: false`.
export const withPostgresJs = postgresStore(postgresJs(postgres(url, { prepare: false })));
```

Any Postgres works (Neon, Supabase, RDS, Cloud SQL), directly or through a transaction-mode pooler. No string may contain U+0000 (the server refuses such a row as `invalid` on every store).

## An ORM

```ts
import { drizzleDriver, postgresStore, prismaDriver } from 'ferrysync/server';
import { PrismaClient } from '@prisma/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export const withPrisma = postgresStore(prismaDriver(new PrismaClient(), { dialect: 'postgres' }));

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
export const withDrizzle = postgresStore(drizzleDriver(db, { dialect: 'postgres', sql }));
```

`dialect` says which database is behind the ORM. Prisma's transaction timeout defaults to 5 s: raise it with `prismaDriver(prisma, { dialect, timeout })` if a first download of a large account is slow. Drizzle on SQLite needs one connection.

## Store options

`postgresStore(driver, { prefix, migrate, mirror })` and the same for `sqliteStore`. `prefix` defaults to `ferry_`. `migrate: false` leaves the tables to the user's migration tool: generate the statements with `syncTablesSql({ dialect, prefix })`. `mirror` copies synced tables into the app's own tables: that is an adoption feature, see [ferrysync-migrate](../../ferrysync-migrate/SKILL.md).

**Verify:** start the server, call `await store.ready()`, then list tables: `ferry_state`, `ferry_clients`, `ferry_memberships`, `ferry_records`, `ferry_log`, `ferry_push_results`, `ferry_meta` exist.
