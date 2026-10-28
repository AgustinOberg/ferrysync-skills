# Vocabulary

Words the docs and the API use. Read this when a term in code or in an error message is unclear.

| Term | Meaning |
| --- | --- |
| **Space** / **group** | The same thing. A set of rows some users share (a project, a team). "Space" is the app-facing word (`spaces` in `defineSchema`, `syncServer.spaces`); "group" is what the engine, the wire protocol and the internals docs say |
| **Private space** | Rows of a table without a space function, or whose space function returns `null`. Owned by the user who created them (`user:<id>` on the server). Never add anyone to a `user:` space |
| **Space function** | `(row) => string \| null` in `defineSchema(..., { spaces })`. Ferry never parses the string it returns |
| **Membership** | Who belongs to which space. Decided on the server only: `syncServer.spaces.addMember` / `removeMember`. Not a row; no hook runs |
| **`claimSpace`** | Server option letting the first writer of a space that has no members and no rows become its first member. Needed when devices create spaces offline |
| **Local-only table** | `localOnly` in the schema. Written, queried and undone like any table, never sent to the server |
| **Outbox** | The queue of writes on the device that the server has not confirmed. Survives restarts. `sync.status.pending` counts its transactions |
| **Transaction** | One or more writes that apply, sync and undo together. Every write is one. `sync.transaction((tx) => ...)` groups several |
| **Sync id** | Increasing id the server gives each change in its log. A device's cursor (`status.lastSyncId`) is the highest it has applied |
| **Log** | The server's ordered list of changes. Pruned by retention (default 90 days) |
| **Rebase** | The device shows confirmed rows plus its pending writes replayed on top, recomputed when news arrives. Why a screen never flickers back |
| **Last writer wins** | The server applies writes in arrival order; per field the last applied wins. A delete beats an update; a create can restore a deleted id |
| **Tombstone** | A deleted row kept on the server so a late update cannot resurrect it |
| **`rejected` / rollback** | The server refused a transaction: the device removes it and calls `onRejected` with a `code` |
| **Local authority** | `local()`: the device confirms its own writes. The default backend. Same code path as with a server |
| **Backend (client)** | `local()` or `http({ url })`. Where the client syncs |
| **Store (server)** | Where the server keeps rows, log, devices and memberships. `memoryStore`, `sqliteStore`, `postgresStore`, `d1Store` |
| **Driver** | A few lines connecting a SQL store to a database library (`nodePostgres(pool)`, `prismaDriver(prisma, { dialect })`) |
| **Mirror** | `mirror` option of a SQL store: copies synced tables into the app's own tables in the same transaction, so the rest of the backend keeps reading them with its ORM |
| **`write` / `log` / `backfill`** | Backend-side ways to change synced data: `write` to write, `log` to tell sync about a row your code already wrote to a mirror table, `backfill` to bring existing rows in |
| **Realtime** | A long-poll `wait` request, held up to 30 s, that nudges the device to pull. Carries no data |
| **Coordinator** | On Cloudflare D1: the one Durable Object that runs the sync server and is the database's single writer |
| **`afterRestore`** | The step an operator runs once after restoring the database from a backup |

## How a change travels

1. `sync.tasks.update(id, { done: true })` changes the screen at once.
2. The change is stored in the outbox on the device.
3. With a network, the outbox is pushed, in order.
4. The server validates schema, space and your hooks in one database transaction, then appends to the log. A refusal rolls the change back on the device.
5. Other devices pull what came after their cursor and replay their own pending writes on top.

## Wire endpoints

All `POST` to one route, chosen by the last path segment: `push`, `pull`, `bootstrap`, `wait`. The client's `url` is the route without the endpoint (`/api/sync`, not `/api/sync/push`).
