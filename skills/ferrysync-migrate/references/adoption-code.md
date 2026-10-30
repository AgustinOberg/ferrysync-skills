# Adoption code

All snippets are type-checked. They assume an existing Postgres database with a `tasks` table. For SQLite use `sqliteStore` and a SQLite driver; mirrors work on both. D1 has no mirrors.

## What the existing tables need

| Need | Do |
| --- | --- |
| A string primary key devices can make | A `uuid` (Postgres) or `text` key is ready. An integer `serial` is not: add a `uuid` column, make it the key for synced rows, keep the integer as a plain column if other tables point at it |
| A delete column | `deleted_at` (nullable timestamp; a boolean is set to `true`). Name another with `deletedAt: 'archived_at'`, or `deletedAt: false` to really delete the row. The rest of the backend must now filter `deleted_at IS NULL` |
| A column per schema field | `projectId` goes to `project_id`, or to `projectId` if the table has that. Override with `columns` |
| Defaults on every other column | The mirror writes only the schema's fields: a `NOT NULL` column without a default fails every insert |

```sql
-- Postgres example: give an integer-keyed table a device-makeable id and a delete column (adapt to your migration tool)
ALTER TABLE tasks ADD COLUMN sync_id uuid;
UPDATE tasks SET sync_id = gen_random_uuid() WHERE sync_id IS NULL;
ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
```

The mirror's id column must be the table's only primary key, and is named `id` unless the mirror says otherwise. With the example above, the key must move from the serial `id` to `sync_id` (make it `NOT NULL`, drop the old primary key, add the new one), and the mirror says `columns: { id: 'sync_id' }`. The serial column stays as a plain column and keeps filling itself on rows sync creates. Until then `store.ready()` fails with "needs the id's column (sync_id) as its only primary key". Plan that migration with the user, in their migration tool, and do not run DDL against production yourself. The store never alters your tables: `ready()` only reads them, and it creates only its own `ferry_*` tables.

### SQLite: the table is rebuilt

SQLite cannot change a primary key in place, and an `INTEGER PRIMARY KEY` (with or without `AUTOINCREMENT`) cannot hold a text id: the table is rebuilt. This recipe keeps the old integer as `legacy_id`, so old app versions keep their ids, and hands the next one to rows that sync creates. Run as a migration script on a copy first, never at server start, and never against real data without a backup and the user's explicit confirmation naming the table. (`PRAGMA foreign_keys` cannot change inside a transaction. Tables that reference `tasks(id)` must be rebuilt in the same script, pointing at `legacy_id` or at the new text id: decide with the user.)

```sql
PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
INSERT INTO tasks_new (id, legacy_id, project_id, title, done)
  SELECT CAST(id AS TEXT), id, project_id, title, done FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
-- Recreate every index, view and trigger the old table had, then:
CREATE TRIGGER tasks_legacy_id AFTER INSERT ON tasks WHEN NEW.legacy_id IS NULL
BEGIN
  UPDATE tasks SET legacy_id = (SELECT COALESCE(MAX(legacy_id), 0) + 1 FROM tasks) WHERE id = NEW.id;
END;
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
```

Checked on SQLite with Ferry: the mirror writes only the schema's fields, so rows sync creates (an app push, `write`) get a `legacy_id` from the trigger (an update does not fire it), and `ready()` passes. Old rows keep their integer as `legacy_id`; their text id is the same number as a string, so existing devices-to-be get stable ids. Soft deletes keep the maximum, so `MAX + 1` never reuses an id; with `deletedAt: false` it can.

The old code must then read and answer with `legacy_id`: where it took `lastInsertRowid` after an insert, create through `write` and look the row up (`SELECT legacy_id FROM tasks WHERE id = ?`), and where it reads by integer id, use `WHERE legacy_id = ?` (and `AND deleted_at IS NULL`).

## The schema over the existing tables

Take the existing columns that must sync, as strings, numbers, booleans, nulls and JSON. The same Zod object can describe the mirror's fields.

```ts
// schema.ts
import { defineSchema } from 'ferrysync';
import { z } from 'zod';

export const Task = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  done: z.boolean().default(false),
});

export const schema = defineSchema(
  { tasks: Task },
  { spaces: { tasks: (task) => `project:${task.projectId}` } },
);
```

## The server with a mirror

`mirror` makes every write through sync also a write to the app's own table, in the same database transaction (an app push, `syncServer.write`, a hook's write). A refused transaction leaves no trace in either.

```ts
// sync-server.ts
import { createSyncServer, nodePostgres, postgresStore } from 'ferrysync/server';
import { Pool } from 'pg';

import { Task, schema } from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const store = postgresStore(nodePostgres(pool), {
  mirror: { tasks: { table: 'tasks', fields: Task } },
});

export const syncServer = createSyncServer({
  schema,
  store,
  auth: async (request) => (await getSession(request))?.userId ?? null,
  onError: (error) => console.error('ferry', error),
});

// Fail at startup, with a message that says what to change, if a table, key or column is wrong.
await store.ready();
```

Mirror options: `table` (required; `app.projects` for another Postgres schema), `fields` (a list of names, or the table's Zod schema: pass it, so the store checks each field has its column and leaves your other columns alone; left out, the store takes the fields from the schema when it can read them, and otherwise mirrors every column but `deletedAt`), `columns` (field to column where the default is not it), `deletedAt`, `toColumns`, `toRow` for your own mapping.

```ts
import { nodePostgres, postgresStore } from 'ferrysync/server';
import { Pool } from 'pg';

export const store = postgresStore(nodePostgres(new Pool()), {
  mirror: {
    projects: {
      table: 'app.projects',
      fields: ['name'],
      columns: { name: 'title' }, // the field `name` lives in the column `title`
      deletedAt: 'archived_at',
    },
  },
});
```

### Ferry's own tables in the project's migrations

When migrations are the only thing allowed to change the database (Prisma Migrate, drizzle-kit, a SQL folder), generate the statements and open the store with `migrate: false`:

```ts
import { syncTablesSql } from 'ferrysync/server';
import { writeFileSync } from 'node:fs';

const statements = syncTablesSql({ dialect: 'postgres', prefix: 'ferry_' });
writeFileSync('migrations/0007_ferry/migration.sql', `${statements.join(';\n')};\n`);
```

A Ferry release that changes its tables says so in its notes. With `migrate: false` the store refuses to start until the new statements are added.

## Bring the existing rows in: `backfill`

Rows that exist only in the app's tables are unknown to sync, so devices do not get them. Run once per mirrored table, from a script or at deploy. It reads pages (default `pageSize` 500), writes each page as `system` in one transaction, and skips rows sync already has, so running it again is safe.

```ts
import { syncServer } from './sync-server';

const result = await syncServer.backfill('tasks');
console.log(`${result.created} tasks synced, ${result.existing} already were`);
for (const { id, code, message } of result.rejected) {
  console.warn(`task ${id} was not synced: ${code}: ${message}`);
}
```

A private table needs `owner: (row) => userId` (whose private space a row joins). A row the schema, a hook or a permission refuses is listed in `rejected` and written nowhere. Fix the data or the schema and run again. `d1Store` has neither `backfill` nor `log`.

## Writers: pick by driver first

| Store and driver | `write` | `write` with `within` | `log` |
| --- | --- | --- | --- |
| `postgresStore` with `nodePostgres`, `postgresJs`, `pglite`, `prismaDriver`, `drizzleDriver` | yes | yes | yes |
| `sqliteStore` with `prismaDriver` or `drizzleDriver` (`dialect: 'sqlite'`) | yes | yes | yes |
| `sqliteStore` with `nodeSqlite`, `bunSqlite`, `betterSqlite3`, `durableObjectSqlite` | yes | no | **no** |
| `d1Store` | yes | no | no (no mirror, no `backfill`) |

Where `log` is unavailable, an old endpoint must not write the mirrored table itself: move every write of it into `write`, and keep the endpoint's response shape. There is no way to tell sync afterwards, and nothing sees the change ([cutover-and-rollback](cutover-and-rollback.md) has the consequences). Without `within`, a write to your own other tables cannot commit with the sync write: order them so a failure between the two is harmless, or accept the small gap.

### SQLite in one process

The SQLite drivers share one connection and queue Ferry's transactions, each `BEGIN IMMEDIATE`. Checked with `bun:sqlite` (the same driver shape as `node:sqlite`):

- **Legacy code on the same connection object**: a legacy statement that runs while a Ferry transaction is open (it can only run when a hook such as `validate` awaits real I/O, since the driver itself only awaits microtasks) joins that transaction, and if Ferry then rolls back (a refused write) the legacy statement is rolled back with it. It was acknowledged and is gone.
- **Legacy code on a second connection to the file**: its write waits on Ferry's write lock, and the SQLite libraries are synchronous, so with `busy_timeout` it blocks the whole event loop (Ferry's transaction included) until the timeout, then fails with "database is locked". Measured: 1.6 s blocked against a 1.5 s timeout.

So: keep `validate` and `onWrite` hooks free of real async I/O, write mirrored tables only through `write`, and share Ferry's connection object for the app's other tables if the app is one process. One process per file; see `docs/server/stores.md`.

## Writers you can change: `write`

Replace a direct write to a mirrored table with a sync write, so devices hear about it. It runs in one transaction, goes through the schema and your hooks, and does not check auth: the endpoint decides who may call it.

```ts
import { Hono } from 'hono';

import { syncServer } from './sync-server';

const app = new Hono();

app.post('/api/tasks/:id/complete', async (c) => {
  const session = await getSession(c.req.raw);
  if (session === null) return c.json({ error: 'Unauthorized' }, 401);
  // As the user: their permissions apply, as if from their app. `as: 'system'` may write any space.
  await syncServer.write({ as: { userId: session.userId } }, (tx) =>
    tx.tasks.update(c.req.param('id'), { done: true }),
  );
  return c.json({ ok: true });
});
```

A write the schema, the user's spaces or a `validate` hook refuses throws `WriteRejectedError` (with `code` and `message`): map it to the endpoint's old error response. To make your own tables and the synced rows commit together, pass `{ within: tx }` (your ORM's transaction) and call `written.committed()` after your commit. `within` works with `nodePostgres` (a pool client after `BEGIN`), `postgresJs`, `pglite`, `prismaDriver` and `drizzleDriver` (their transaction's `tx`); not with `nodeSqlite`, `bunSqlite`, `betterSqlite3`, `durableObjectSqlite` or `d1Store`.

## Writers you cannot change: `log`

Only with a driver that can join your transaction (see the table above): not on the SQLite drivers over `node:sqlite`, `bun:sqlite`, `better-sqlite3`, `durableObjectSqlite`, nor `d1Store`. There, every writer is moved to `write`.

An old endpoint, a job or an admin tool that writes the mirrored table itself must tell sync right after, in the same transaction:

```ts
import { createSyncServer, postgresStore, prismaDriver } from 'ferrysync/server';
import { PrismaClient } from '@prisma/client';

import { schema } from './schema';

const prisma = new PrismaClient();
const syncServer = createSyncServer({
  schema,
  store: postgresStore(prismaDriver(prisma, { dialect: 'postgres' }), {
    mirror: { tasks: { table: 'tasks' } },
  }),
  auth: async (request) => (await getSession(request))?.userId ?? null,
});

const logged = await prisma.$transaction(async (tx) => {
  await tx.task.update({ where: { id: taskId }, data: { done: true } });
  return syncServer.log(tx, { table: 'tasks', id: taskId });
});
await logged.committed();
logged.value; // 'created', 'updated', 'deleted' or 'unchanged'
```

`log` reads the row back from the table and writes what changed into sync as `system`. A row that does not fit the schema makes `log` throw `WriteRejectedError` and nothing of the sync write happens. It needs a driver that can join your transaction (the list under `write`).

## Membership from the existing tables

Membership is decided by the backend only. Load existing members once, then keep it in step where the app changes them:

```ts
import { syncServer } from './sync-server';

export const syncProjectMembers = async (projectId: string) => {
  for (const userId of await legacyMembersOf(projectId)) {
    await syncServer.spaces.addMember(userId, `project:${projectId}`);
  }
};

// Where the old API removes someone from a project:
export const removeFromProject = (userId: string, projectId: string) =>
  syncServer.spaces.removeMember(userId, `project:${projectId}`); // their devices drop its rows
```

`addMember` for a member and `removeMember` for a non-member do nothing. Do the removals first when replaying history. Space ids are the strings the schema's space functions return: keep them stable, and keep them apart from `user:...`, which is the private space (never add anyone to another user's).

## Rules that were endpoint checks: `validate`

A hook runs for every change wherever it comes from. Return a reason to refuse the whole transaction (the device rolls back and `onRejected` gets the code):

```ts
import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  tables: {
    tasks: {
      // Members may read; only editors may write.
      validate: async ({ after, actor }) => {
        if (after === null || actor.type !== 'user') return;
        if (!(await canEdit(actor.userId, after.projectId))) {
          return { code: 'read_only', message: 'You can only view this project' };
        }
      },
    },
  },
});
```

Keep `validate` fast: it runs inside the database transaction and holds its locks. Throwing is not refusing: a hook that throws fails the request and the device retries the same transaction until it passes. Do not call `syncServer.write` inside a hook: use the hook's own `tx`.

## Test the old and the new path over one server

The migration needs one test that keeps legacy endpoints and Ferry clients honest on the same database. Export the server's options without `schema` and `auth` from the app (the app's `createSyncServer` and the test then share the shipped store, mirrors, hooks and `claimSpace`), run the harness on them, and build the legacy app over `harness.server`, so a legacy endpoint calls `write` exactly as in production ([harness](../../ferrysync-testing/references/harness.md) has the rest).

```ts
// ferry-options.ts: all of the server's options but `schema` and `auth`
import { nodeSqlite, sqliteStore } from 'ferrysync/server';
import type { DatabaseSync } from 'node:sqlite';

import { Task } from './schema';

export const ferryOptions = (db: DatabaseSync) => ({
  store: sqliteStore(nodeSqlite(db), { mirror: { tasks: { table: 'tasks', fields: Task } } }),
  // tables: { ... validate hooks }, claimSpace: ... go here too
});
```

```ts no-check
// migration.test.ts
import { createTestHarness } from 'ferrysync/testing';
import { Hono } from 'hono';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

import { ferryOptions } from './ferry-options';
import { schema } from './schema';

it('a legacy write reaches a Ferry client, and the reverse', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0, notes TEXT, deleted_at TEXT);
    INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'Legacy')`);
  const harness = createTestHarness({ schema, server: ferryOptions(db) });
  const legacy = new Hono();
  legacy.patch('/api/tasks/:id', async (c) => {
    await harness.server.write({ as: { userId: 'alice' } }, (tx) =>
      tx.tasks.update(c.req.param('id'), { done: true }),
    );
    return c.json({ ok: true });
  });

  await harness.server.spaces.addMember('alice', 'project:p1');
  await harness.server.backfill('tasks');
  const phone = await harness.client('alice');
  await harness.settle();
  expect(phone.tasks.get('t1')?.title).toBe('Legacy'); // legacy row reached the device

  const made = phone.tasks.create({ projectId: 'p1', title: 'Visa' });
  await harness.settle();
  const row = db.prepare('SELECT title FROM tasks WHERE id = ?').get(made.id);
  expect(row?.title).toBe('Visa'); // device write reached the old table

  expect((await legacy.request('/api/tasks/t1', { method: 'PATCH' })).status).toBe(200);
  await harness.settle();
  expect(phone.tasks.get('t1')?.done).toBe(true); // legacy write reached the device

  phone.tasks.delete(made.id);
  await harness.settle();
  const gone = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(made.id);
  expect(gone?.deleted_at).not.toBeNull(); // a delete is a soft delete the old reads must filter
  await harness.close();
});
```

The test block is `no-check` because it imports the app's own `./ferry-options` and the snippet checker's Hono stub has no `patch` or `request`; its `bun:sqlite` twin was run for real (it passes). On `bun:sqlite` use `bunSqlite(db)`, `Database` from `bun:sqlite`, and `bun:test` (see the harness reference). Add a case per legacy endpoint that you moved to `write`, one for a refusal (`WriteRejectedError`) and one per `validate` hook.
