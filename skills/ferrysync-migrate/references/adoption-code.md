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
-- Example: give an integer-keyed table a device-makeable id and a delete column (adapt to your migration tool)
ALTER TABLE tasks ADD COLUMN sync_id uuid;
UPDATE tasks SET sync_id = gen_random_uuid() WHERE sync_id IS NULL;
ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
```

If the key must change, the mirror's table must have the row id as its only primary key: plan that migration with the user, in their migration tool, and do not run DDL against production yourself.

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

Mirror options: `table` (required; `app.projects` for another Postgres schema), `fields` (a list of names, or the table's Zod schema: pass it, so the store checks each field has its column and leaves your other columns alone), `columns` (field to column where the default is not it), `deletedAt`, `toColumns`, `toRow` for your own mapping.

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

A write the schema, the user's spaces or a `validate` hook refuses throws `WriteRejectedError` (with `code` and `message`): map it to the endpoint's old error response. To make your own tables and the synced rows commit together, pass `{ within: tx }` (your ORM's transaction) and call `written.committed()` after your commit. `within` works with `nodePostgres` (a pool client after `BEGIN`), `postgresJs`, `pglite`, `prismaDriver`, `drizzleDriver`; not with the SQLite drivers or D1.

## Writers you cannot change: `log`

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

`log` reads the row back from the table and writes what changed into sync as `system`. A row that does not fit the schema makes `log` throw `WriteRejectedError` and nothing of the sync write happens. It needs a driver that can join your transaction (not the SQLite drivers over `node:sqlite`, `bun:sqlite`, `better-sqlite3`, nor `durableObjectSqlite`).

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
