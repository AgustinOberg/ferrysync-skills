# Eval 1: add offline sync to a blank app

## Fixture

A blank monorepo, made with the commands below, then committed:

```sh
mkdir scratch-blank && cd scratch-blank
bun init -y
bun add hono
bun create vite web --template react-ts
```

Layout: `server/index.ts` exports a Hono app on `Bun.serve` with one `GET /health` route; `web/` is the Vite React TypeScript template. No auth, no database, no data layer.

## Prompt

> This workspace has a Hono server and a Vite React app and nothing else. Add a task list that works offline and syncs between two browser windows, using Ferry. Tasks belong to projects, and a project can be shared with other users later. Make it work end to end and tell me how you verified it.

## Operator answers (only if asked)

- Where to install `ferrysync` from: not asked when the registry has it (`ferrysync` 0.1.0 is on npm). Only if `npm view ferrysync version` fails: the tarball or path the operator prepared.
- Auth: "No login system yet. Use a fixed development user for now, and tell me what it will take to make it real."
- Database: "Whatever is simplest; it is one server for now."
- State library: "None."

## Pass criteria

**Process**

- must: checks that `ferrysync` resolves (`npm view ferrysync version`) and installs it from the registry; if it does not resolve, asks where to install from instead of guessing a registry or fork.
- must: states a fit check (offline, multi-device, last writer wins) before building.
- must: starts the client on the device alone and verifies persistence before adding the server (the order in `ferrysync-create-app`).
- should: asks about auth and database, or states its choice and the reason.

**Outcome** (verify by running)

- must: a shared `schema` file with `projects` and `tasks`, string ids, `spaces` for both tables (`project:<id>`), a `claimSpace` on the server that returns `true` only for the project's own row.
- must: server over `sqliteStore` with `bunSqlite` (or Postgres if the operator chose it), mounted on one route with `app.all('/api/sync/*', ...)` or equivalent; `Bun.serve` has `idleTimeout` above 30.
- must: client with `indexedDbStorage` and `http({ url })`; the Vite dev server proxies the sync path, or CORS is answered.
- must: `SyncProvider` once, `useQuery` for reads, plain `sync.tasks.create/update` for writes, a visible sync status.
- must: the curl check from the skill appears in the transcript: `401` without credentials, `200` with them.
- must: a `createTestHarness` test that two clients of one user converge, and a second case where a stranger cannot read or write the project; `bunx vitest run` passes.
- must: the project's type check passes.
- should: a manual two-window offline check is described, or run with a browser tool.
- should: an error boundary or `onLocked` handling for the second tab.

**Safety**

- must: the development auth user is named as development only in the code and in the final report, with what real auth needs.
- must: no `memoryStorage()` or `memoryStore()` in production paths; no `as any`, `@ts-ignore`, or non-null `!`.
- must: no TanStack Query or SWR wrapped around Ferry reads; no `useEffect` that copies Ferry data into state.
- must: no invented API: every import from `ferrysync*` resolves (the type check proves it).
- must: no database default choosing synced ids.

**Report**

- must: lists what ran (type check, tests, curl) and what did not (browser, deploy).
- must: mentions Ferry's maturity (0.1.0, gaps) in at most a few lines, with the production-readiness skill as the pointer.
