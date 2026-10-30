---
name: ferrysync-migrate
description: "Migrate an EXISTING app to Ferry (ferrysync) offline-first sync incrementally and reversibly: assess which data syncs and which does not, who owns what, auth and the spaces mapping; then adopt one feature at a time with mirrors into the existing tables, backfill and log; cut over client reads and writes; keep a rollback. Mapping tables for REST with fetch, TanStack Query, SWR, Redux, Zustand, Firebase, Supabase, and an existing Postgres, Prisma or Drizzle database. Use when the user says migrate to Ferry or ferrysync, add offline support to an existing app, replace our REST API or TanStack Query data layer with a local database, move off Firebase or Supabase realtime, or sync our existing Postgres tables to devices. For a blank project use ferrysync-create-app."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# Migrate an existing app to Ferry

Load [ferrysync](../ferrysync/SKILL.md) first for the fit check, vocabulary and "Do not" list. Ferry does not own the whole database and does not need a big-bang rewrite: it keeps its own `ferry_*` tables in the existing database, mirrors synced tables into the existing ones in the same transaction, and takes over one feature at a time.

**Never start by editing code.** Do the assessment, write the plan, get the user's approval on the open decisions, then adopt in phases. Each phase ends in a working app and a check.

## Phase 0: assess (read-only)

Produce a written assessment with the user. The full procedure and questions are in [assessment](references/assessment.md). In short, answer all of these from the code, asking only about what you cannot read:

1. **Fit.** Does each candidate dataset fit in a device's memory per user, and is last-write-wins per field acceptable? Anything server-authoritative (payments, stock) stays on the normal API. If the answer is no for the core data, say so and stop: Ferry is the wrong tool.
2. **Inventory.** Tables, ids, deletes, ownership and sharing, data volume per user, who else reads or writes them (admin tools, jobs, BI, other services, old app versions).
3. **Identity and auth.** What `auth(request)` can read (cookie or token), and which stable user id it yields.
4. **Spaces mapping.** For each table: private, or which membership unit (project, team, org), and where membership is stored today.
5. **Rules.** Permissions and validations now enforced by endpoints, RLS or the client: they become `validate` hooks and space membership.
6. **Client state.** What reads this data today (TanStack Query, SWR, Redux, Zustand, Firebase listeners) and what writes it.
7. **Clients in the wild.** Mobile versions that cannot be forced to update: the old REST path must keep working during rollout.

**Verify:** the assessment lists every table as one of `sync (private)`, `sync (space X)`, `device-only`, or `stay on the API`, with a reason. Show it to the user before phase 1.

## Phase 1: Ferry beside the old backend (nothing uses it yet)

1. Install `ferrysync` and `zod` on the server and the app (check the package exists: see the entry skill).
2. Write the shared Zod schema from the existing tables: string ids, only synced columns, `spaces` from the assessment, `localOnly` for device-only data. Check each table can be mirrored: a text or `uuid` primary key and a delete column. An integer key needs a migration, and on SQLite a table rebuild ([adoption-code](references/adoption-code.md)): write it as a script for the user to run on a backed-up copy first, and never run it at server start.
3. Create the server over the existing database with a **mirror** into the existing tables and the existing auth, and mount it on one new route ([adoption-code](references/adoption-code.md)).
4. Generate Ferry's tables through the project's migration tool (`syncTablesSql`, then `migrate: false`) when migrations are the only thing allowed to change the database; otherwise let the store create them.

**Verify:** the server starts and `await store.ready()` resolves: it checks every mirror (table, primary key, columns) and says what to change. The curl check from [ferrysync-create-app](../ferrysync-create-app/references/verify-two-devices.md) gives `401` then `200`. The old app behaves exactly as before.

## Phase 2: bring the data in and keep both writers honest

1. Run `syncServer.backfill('<table>')` once per mirrored table, from a script or at deploy. It is safe to repeat. Read `rejected`: each row the schema or a hook refused is listed and written nowhere. Fix the data or the schema, then run again.
2. For a table in a shared space, load the members from where the old backend keeps them (`syncServer.spaces.addMember`, see [adoption-code](references/adoption-code.md)) before any device connects. Backfilled rows put rows in the space, and `claimSpace` never founds a space that has rows, so without members every write to it is `forbidden`.
3. Route every server-side writer of those tables through sync, picking by driver first ([adoption-code](references/adoption-code.md)). With Postgres, Prisma or Drizzle: `syncServer.write` for code you can change, `syncServer.log(tx, { table, id })` right after a write you cannot change. With the SQLite drivers (`nodeSqlite`, `bunSqlite`, `betterSqlite3`, `durableObjectSqlite`) `log` does not exist: every writer of a mirrored table moves to `write`, and no old code may write the table itself. An admin tool, trigger or migration that writes a mirrored table without telling sync is not seen by devices, and the next sync write overwrites it.

**Verify:** counts match: rows in the old table (not soft-deleted) equal `created + existing` of the backfill, and `rejected` is empty. A read-only cross-check in the database: `SELECT count(*) FROM ferry_records WHERE model = 'tasks' AND NOT deleted` (SQLite: `deleted = 0`; the prefix is `ferry_` unless the store set another). Never write to `ferry_*` tables by hand. Moving old endpoints onto `write` changes their behaviour (see [assessment](references/assessment.md)): show the user those changes. A harness test (the recipe is at the end of [adoption-code](references/adoption-code.md); see also [ferrysync-testing](../ferrysync-testing/SKILL.md)) creates through the old endpoint and shows the change on a Ferry client, and the reverse.

## Phase 3: move one feature on the client

Pick the smallest feature with real users. Behind a flag:

1. Create the client and `SyncProvider` once. Replace the feature's reads with queries and its writes with table calls. The mapping per source stack is in [source-stacks](references/source-stacks.md).
2. Delete that feature's fetching code, optimistic-update code, loading states and offline queue. Keep the old code behind the flag until cutover.
3. Handle refusals: `onRejected` gets `code` and `changes`; the row has already rolled back.
4. Add the sync status to the UI.

**Verify:** the feature works offline, survives a restart, and a second device sees changes. The flag off still gives the old behavior.

## Phase 4: cut over and retire

Follow [cutover-and-rollback](references/cutover-and-rollback.md): staged rollout, what to watch, the rollback, and when old endpoints can be removed (only when no supported client version uses them). Then repeat phase 3 for the next feature.

## Checklist

Use [checklist](references/checklist.md) at the end of every phase, and again before the final cutover.

## Do not

- Do not migrate the whole app in one change. One feature, one flag, one rollout.
- Do not let a database default or serial choose a synced row's id. Add a `uuid` or `text` key for synced rows, and keep an integer as a plain column if other tables point at it.
- Do not drop `deleted_at` semantics: a sync delete sets the mirror's `deleted_at` (or `deletedAt: 'archived_at'`); the rest of the backend must filter it.
- Do not write to mirrored tables (or `ferry_*` tables) without `write`, `log` or an app push. On SQLite drivers there is no `log`: only `write` or an app push.
- Do not give the mirror a `NOT NULL` column without a default that the schema does not know: inserts fail.
- Do not rely on Row Level Security: Ferry's connection does not apply it. Access is decided by `auth`, the schema's spaces and `validate`.
- Do not keep TanStack Query, SWR or a Redux slice as a second cache over the same rows.
- Do not remove the old endpoints while any supported app version calls them.
- Do not delete production data, drop tables, or rewrite history as part of a migration without the user's explicit, named confirmation.

## References

- [assessment](references/assessment.md): the procedure and the questions.
- [adoption-code](references/adoption-code.md): schema over existing tables, mirror, backfill, `log`, `write`, role checks. Compiled snippets.
- [source-stacks](references/source-stacks.md): mapping tables for REST, TanStack Query, SWR, Redux, Zustand, Firebase, Supabase, Prisma, Drizzle.
- [cutover-and-rollback](references/cutover-and-rollback.md): rollout, monitoring and rollback.
- [checklist](references/checklist.md): per-phase checklist.
