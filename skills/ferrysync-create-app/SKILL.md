---
name: ferrysync-create-app
description: "Build a new offline-first app, or a new synced feature, on Ferry (ferrysync) from a blank or fresh project: Zod schema with spaces, local client, sync server mounted in the backend, React hooks, a first two-device sync check and deploy pointers. Concrete per stack: Expo and React Native, Vite and React, Next.js; Hono, Express, Node, Bun, Cloudflare Workers backends; SQLite, Postgres, D1. Use when the user says add offline sync to a new app, start a local-first app, scaffold a synced todo or notes app, set up ferrysync from scratch, or has no existing data layer to preserve. For an app that already has a backend and data, use ferrysync-migrate instead."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# Create an offline-first app with Ferry

Load [ferrysync](../ferrysync/SKILL.md) first if you have not: it has the fit check, the vocabulary and the "Do not" list. This skill is the build recipe for a project with no data layer to preserve. If the app already has a REST backend or database to keep, stop and load [ferrysync-migrate](../ferrysync-migrate/SKILL.md).

## Procedure

### 1. Detect the stack and decide, before installing anything

Read `package.json`, the lockfile, the framework config and any `AGENTS.md`. Fill this in, asking the user only about what you cannot read:

| Decision | How to decide | Recipe |
| --- | --- | --- |
| Client platform | `expo`/`react-native` in deps: native. `vite`, `next`, `react-dom`: web | [expo-react-native](references/expo-react-native.md), [web-vite-react](references/web-vite-react.md), [nextjs](references/nextjs.md) |
| Backend | The existing server framework. None yet: Hono on the user's runtime is the lightest | [backends](references/backends.md) |
| Database | Existing database. None: SQLite for one process, Postgres for several instances or serverless | [databases](references/databases.md) |
| Auth | Existing auth. None: ask. Ferry has no users of its own, and `auth: () => 'demo-user'` is for local development only | `ferrysync-server` references |
| Accounts at launch | Does the app work before sign-in? | Start on `local()`, add `http()` at sign-in |

If a choice is not decided by the project (a new database, an auth library), present options with a recommendation and wait. Do not adopt one silently.

### 2. Model the data

For each thing the user stores, answer, then write the schema:

| Question | Consequence |
| --- | --- |
| Who owns a row? | No space function: private to its creator. Shared: a space function returning a stable string such as `project:${row.projectId}` |
| Which row founds a space? | The project/team row itself. The server needs `claimSpace` for it when devices create spaces offline |
| Is it device-only (drafts, UI state, settings)? | `localOnly: ['drafts']`. A local-only table cannot have a space |
| Can two people change the same field at once? | Last write wins per field. Counters: one row per increment. Lists two people append to: one row per item. Long shared text: not Ferry's job |
| Can the user clear a field? | `z.string().nullable().default(null)`, not `.optional()` (`undefined` means "unchanged" in an update) |

Schema rules (the engine refuses violations): every table outputs an object with a string `id`; fields are JSON values only (no `Date`, `Map`, `bigint`: store ISO strings or epoch numbers); validation is synchronous; a schema must accept its own output (no `.transform` that changes an already valid row); table names are stable, and not one of the client's reserved names (`ready`, `status`, `reset`, `transaction`, `undo`, `connect`, `close`, ...).

```ts
import { defineSchema } from 'ferrysync';
import { z } from 'zod';

export const schema = defineSchema(
  {
    projects: z.object({ id: z.string(), name: z.string() }),
    tasks: z.object({
      id: z.string(),
      projectId: z.string(),
      title: z.string(),
      done: z.boolean().default(false),
      notes: z.string().nullable().default(null),
    }),
    drafts: z.object({ id: z.string(), text: z.string() }),
  },
  {
    spaces: {
      projects: (project) => `project:${project.id}`,
      tasks: (task) => `project:${task.projectId}`,
    },
    localOnly: ['drafts'],
  },
);

export type Task = typeof schema.$infer.tasks;
```

Put it in a file both the app and the server import, with no side effects and nothing platform-specific. In a monorepo, a shared package.

**Verify:** the type check passes; `Task` shows `id`, `projectId`, `title`, `done`, `notes`.

### 3. Start on the device alone

Install, then create the client with a storage and no `backend` (it runs on `local()`), and put the data on screen. The platform recipe has the exact files. This step must work with the server absent: that is the point of the order.

**Verify:** create rows, reload or restart the app: they persist. Turn the network off: nothing changes.

### 4. Add the server

Create it over the store chosen in step 1 ([databases](references/databases.md)) with real `auth` and `claimSpace`, then mount it on one route of the backend ([backends](references/backends.md)). Ferry runs inside the backend the project already has; do not start a separate service.

**Verify:** `store.ready()` resolved (the server starts with no error), and the curl check in [verify-two-devices](references/verify-two-devices.md): `401` without credentials, `200` with them.

### 5. Connect the client

Add `backend: http({ url, headers })`. `url` is the route without the endpoint. On a phone or emulator `localhost` is the device: the Android emulator reaches the computer at `10.0.2.2`, a phone needs the computer's LAN address. A web app on another origin needs CORS answered by the backend (`authorization`, `content-type` headers allowed); in development, proxy the sync path from the dev server instead.

**Verify:** requests to `<route>/push`, `/pull`, `/wait` appear and `sync.status.lastError` is `null`.

### 6. Prove two devices sync

Write the test in [verify-two-devices](references/verify-two-devices.md) with `createTestHarness`, run it, then do the manual two-window offline check from the same page. Add the app's sync status to the UI (`useSyncStatus`) so the manual check is visible.

### 7. Accounts, if the app has them

`sync.connect(http(...), { upload: true })` at sign-in, `sync.reset(local())` at sign-out, from the sign-in handler, not from an auth-state listener (it fires on every session restore). Details: [ferrysync-client](../ferrysync-client/SKILL.md).

### 8. Deploy

Follow the matrix in [ferrysync-server](../ferrysync-server/SKILL.md) (`stores-and-deploy` reference): proxy and function timeouts above 30 s, a shared database for several instances, `waitUntil` on serverless. Then run [ferrysync-security-review](../ferrysync-security-review/SKILL.md) and [ferrysync-production-readiness](../ferrysync-production-readiness/SKILL.md).

## Finish like this

Run the project's type check, lint, format and tests, plus the harness test you added. Report what you ran and what you could not run (for example a device or a deploy). Never report a check as passed if it did not run.

## Do not

- Do not use `auth: () => 'demo-user'` anywhere but local development, and say so in the final report if it is still there.
- Do not make a separate sync service or a second HTTP server for Ferry: it is a route on the existing backend.
- Do not create the client inside a component or per render. One client per app, at module level, in its own module (Fast Refresh re-runs a module you edit: reload the app after editing it).
- Do not write in render. Write in event handlers and effects.
- Do not read through `fetch` what Ferry already holds.
- Do not delete the server's database in development without clearing the app's local data (browser: Application, Clear site data): the device waits for history the new database lacks.

## References

- [web-vite-react](references/web-vite-react.md), [expo-react-native](references/expo-react-native.md), [nextjs](references/nextjs.md): per-platform files.
- [backends](references/backends.md): Hono, Express, Node, Bun, Cloudflare Workers.
- [databases](references/databases.md): SQLite, Postgres, Prisma, Drizzle, D1.
- [verify-two-devices](references/verify-two-devices.md): the curl check, the harness test, the manual offline check.
