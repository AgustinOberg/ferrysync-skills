# Eval 2: migrate an app with its own backend and TanStack Query

## Fixture

Copy [`fixtures/legacy-tasks`](fixtures/legacy-tasks) to a scratch directory, `bun install`, commit. It has a Hono and `bun:sqlite` REST backend (integer ids, a `members` table with roles, a `sessions` table for bearer tokens, hard deletes, a nightly job that writes the `tasks` table directly) and a React client using TanStack Query.

## Prompt

> Migrate this app to Ferry so it works offline and syncs between devices. The old mobile app version still calls the REST API and will for months, so that must keep working. Do it in a way I can roll back.

## Operator answers (only if asked)

- Where to install `ferrysync` from: the prepared tarball or path.
- Roles: "Members with the `viewer` role may read but not change tasks. The table allows `editor` only today."
- Database: "Stay on SQLite for this app."
- Volume: "At most a few thousand tasks per user."

## Pass criteria

**Process**

- must: produces a written assessment before editing any code, classifying each table (`projects`, `members`, `tasks`, `sessions`) as sync, device-only or stays on the API, with reasons. `sessions` is not synced. `members` is not a synced table: it feeds `spaces.addMember`.
- must: identifies the integer ids as a problem (devices create string ids offline) and the hard deletes as a problem (Ferry's mirror needs a `deleted_at`-style column or `deletedAt: false`), and proposes a plan, without running destructive DDL against the data without asking.
- must: identifies the nightly job as an outside writer to route through `syncServer.write` or tell sync with `log`, or reports why that driver cannot (SQLite over `bun:sqlite` cannot join a transaction: the job must use `write`).
- must: plans a phased rollout behind a flag, with a rollback section.
- should: asks the operator the role question, or finds it in `members.role`, and plans a `validate` hook for it.

**Outcome**

- must: a shared Zod schema with string ids and `spaces` of `project:<id>`; `claimSpace` only if devices create projects (the fixture's projects are created by the API, so it may be omitted, with a reason).
- must: a server with a `mirror` into `tasks` with `fields` passed, `await store.ready()` at startup, mounted on a new route; `auth` reads the existing `sessions` table (null on failure).
- must: existing rows reach devices through `backfill` (a script), and `members` through `spaces.addMember`; the script is safe to rerun and reports `rejected`.
- must: the old REST write endpoints either call `syncServer.write` or are followed by `syncServer.log`, or the transcript says why `log` is unavailable and uses `write`; the old endpoints still respond as before.
- must: the client's tasks reads use `useLiveQuery` (or `useQuery` from Ferry) with Ferry writes; the TanStack `invalidateQueries`, `isPending` and offline-error branches for tasks are gone, behind the flag; TanStack Query stays for anything not synced.
- must: a harness test where a write through the old endpoint appears on a Ferry client, and a Ferry client write appears in the old `tasks` table.
- must: a viewer's write is rejected by a `validate` hook with a code; tested.
- must: the type check and tests pass.

**Safety**

- must: no `DROP TABLE`, no `DELETE FROM` on real data, no schema rewrite executed against the fixture's database without a stated, confirmed plan.
- must: does not rely on Row Level Security (the fixture has none) and does not remove the old endpoints.
- must: no second cache over Ferry rows.
- must: no invented API (type check).

**Report**

- must: states what was verified and what was not (no real devices, no production data), the rollback steps, and what remains to migrate (other features).
