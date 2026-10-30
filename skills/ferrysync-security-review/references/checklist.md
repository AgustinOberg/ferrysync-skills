# Security checklist

For each item: look, decide pass or finding, note the file and line.

## Auth

| Check | Failure looks like | Fix |
| --- | --- | --- |
| `auth` returns `null` for a missing or invalid credential and never a default user | `auth: () => 'demo-user'` outside local development; a fallback id; a catch that returns a user | Real verification; `null` on failure |
| It does not throw for bad tokens (a throw is a 500 and noisy) | Unhandled `jwtVerify` rejection | try/catch returning `null` |
| Tokens are verified: signature, issuer, audience, expiry | Decoding a JWT without verifying; no audience check | Verify against the provider's keys |
| The id is stable and unique per person | An email, a username, an id that can be reassigned | The primary key or provider `sub`; map duplicate identities to one |
| A header carrying the user is never client-controlled | `request.headers.get('x-user-id')` trusted from the client; a proxy-set header not stripped at the edge | Middleware must `delete` the client's copy first |
| `auth` is cheap and cached | A database read per request (every online device sends about one per 25 s) | Cache sessions or verify signed tokens locally |
| Anonymous requests are not served | A route mounted before the auth middleware | `401` without credentials: curl it |

## Spaces and membership

| Check | Failure looks like | Fix |
| --- | --- | --- |
| Every table that holds another person's data has a space function; private is the default | A table meant to be shared with no space function (private, so safe but broken), or a space function returning one constant for all users (everyone shares everything) | Derive the space from the row's owner unit |
| Space ids are unguessable or membership is created by the backend | Natural keys such as `team:acme` or `org:<slug>` that a user could found first | UUIDs; create the space in a backend endpoint and `addMember`; make `claimSpace` stricter |
| `claimSpace` returns `true` only for the one row that creates the space | `claimSpace: () => true`; a check on `table` only; claiming by any row of the table | Match the founding table and `space === 'project:' + row.id` (the pattern in ferrysync-server); consider `actor` |
| No code adds a user to a `user:` space | `addMember(x, 'user:' + y)` where `y` is not `x` | Never; `addMember` throws only for the user's own |
| Member management endpoints authorize the caller | A route taking `userId` from the body and calling `addMember` for any caller (the example server only lets existing members add) | Check the caller is allowed to invite; validate the invite token; seat limits |
| Removal is wired | Users removed from a project in the app stay in the Ferry space | Call `removeMember` where the old system removes access; devices drop the rows |
| A row's space can be changed only by someone in both spaces | Moving rows between spaces without thinking | That is enforced (writer must belong to both): test it |

## Rules and hooks

| Check | Failure looks like | Fix |
| --- | --- | --- |
| Roles beyond membership are enforced server-side | Read-only members can write, because membership gives read and write | A `validate` hook using `actor` and a role lookup |
| Hooks refuse instead of throwing | `throw new Error('forbidden')` in `validate`: a 500, and the device retries forever | Return `{ code, message }` |
| Hooks see all writers | A rule enforced only in the UI or one endpoint | Put it in `validate`: it runs for pushes, `write` and other hooks |
| Hook messages are safe to show | Messages that leak internals, other users' data or SQL | Short, user-safe text |
| `afterCommit` side effects use data safely | Row text interpolated into emails, URLs, shell commands or HTML | Treat row fields as untrusted input |
| Limits exist | `z.string()` with no `.max()`: huge rows; a 5 MiB body per push | Length limits in the schema; `maxBodyBytes` as needed; rate limits at the proxy (Ferry has none) |

## Server-side writes

| Check | Failure looks like | Fix |
| --- | --- | --- |
| Every route that calls `syncServer.write` authenticates and authorizes the caller (`write` checks no auth) | A public webhook or endpoint that writes as `system` from request input | Verify the caller; validate the input; prefer `as: { userId }` so permissions apply |
| `as: 'system'` is only used by trusted code | Passing user-supplied ids straight into a system write | Check ownership first; or write as the user |
| Reads: `tx.get` and `get` see every space | A hook returning another space's data to the user in a message | Do not echo what was read |
| Mirrors | The mirror writes the app's tables with the store's database credentials, bypassing Row Level Security | Keep RLS on for any other path; enforce access in `auth`, spaces and hooks |
| `ferry_*` tables are not writable by app roles or admin tools | A BI or admin tool with write access to `ferry_*` | Read-only for tools; changes only through `write` |

## Transport and deployment

| Check | Failure looks like | Fix |
| --- | --- | --- |
| HTTPS only in production | `http://` URLs in release builds | HTTPS; cleartext only in dev builds |
| CORS allowlist | `origin: '*'` with credentials, or reflecting any origin | The app's exact origins; allow `authorization` and `content-type` |
| The route is not behind a body-consuming middleware that logs bodies | Request bodies (whole rows) written to logs | Do not log bodies |
| Rate limiting and abuse protection | None: Ferry has none | At the proxy or gateway |
| `onError` output | Logs tokens, headers, rows | Log codes and ids, not payloads |
| DB credentials | Connection string in client code or a repo | Server env only; rotate if exposed |

## Device side

| Check | Failure looks like | Fix |
| --- | --- | --- |
| Sensitive fields are on the device in plaintext (rows of every space the user belongs to, in IndexedDB or SQLite). The docs describe no encryption at rest | Passwords, tokens, API keys, card data or other secrets in synced rows | Do not sync secrets. Keep them in the platform keychain or on the server. Never put cardholder data in rows |
| `localOnly` is not a secret store | Treating `localOnly` as protected | It only means "never sent to the server" |
| Sign-out wipes | `reset` not called, or called with `keepLocalOnly` for sensitive local data | `sync.reset(local())` (check `pending` first); `keepLocalOnly` only for harmless device data |
| One user per device | Two accounts on one install without a wipe: the second gets `403` | Sign-out resets; do not catch the 403 and retry as another user |
| Account switching | `connect` with `upload: true` for a different person's anonymous data | Ask "keep the data on this device?" |
| Deleted users | The account is deleted in the app's auth, but `syncServer.deleteUser` is not called: the user's private rows, log entries, memberships and devices stay in `ferry_*`. Or `deleteUser` runs while `auth` still lets the user in, so a device writes the data again | Revoke `auth` first, then `deleteUser`, again a minute later and after any restore (`docs/server/deleting-users.md`). Rows of shared spaces stay by design: see [ferrysync-production-readiness](../../ferrysync-production-readiness/references/known-gaps.md) |

## Tests that prove the boundaries

Write these in the harness (the real server and clients in one process). Each must fail if the boundary is removed.

```ts
import { createTestHarness } from 'ferrysync/testing';
import { expect, test, vi } from 'vitest';

import { schema } from './schema';

const claimSpace = ({ table, space, row }: { table: string; space: string; row: { id: string } }) =>
  table === 'projects' && space === `project:${row.id}`;

test('a stranger neither reads nor writes into a project', async () => {
  const harness = createTestHarness({ schema, server: { claimSpace } });
  const alice = await harness.client('alice');
  const project = alice.projects.create({ name: 'Secret' });
  alice.tasks.create({ projectId: project.id, title: 'Private plan' });
  await harness.settle();

  const onRejected = vi.fn();
  const mallory = await harness.client('mallory', { onRejected });
  await harness.settle();
  expect(mallory.projects.all().get()).toEqual([]); // cannot read
  expect(mallory.tasks.all().get()).toEqual([]);

  mallory.tasks.create({ projectId: project.id, title: 'Injected' }); // cannot write
  await harness.settle();
  expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
  expect(alice.tasks.where({ title: 'Injected' }).get()).toEqual([]);
  await harness.close();
});

test('removing a member takes the rows off their device', async () => {
  const harness = createTestHarness({ schema, server: { claimSpace } });
  const alice = await harness.client('alice');
  const project = alice.projects.create({ name: 'Trip' });
  await harness.settle();
  await harness.server.spaces.addMember('bob', `project:${project.id}`);
  const bob = await harness.client('bob');
  await harness.settle();
  expect(bob.projects.get(project.id)).not.toBeNull();

  await harness.server.spaces.removeMember('bob', `project:${project.id}`);
  await harness.settle();
  expect(bob.projects.get(project.id)).toBeNull();
  await harness.close();
});
```

Also write: a `validate` role test (a read-only member's write is rejected with your code), a `claimSpace` squatting test (a user cannot found a space for another unit), and, against the real mounted route, an `auth` test (no header gives `401`, a forged or expired token gives `401` not `500`, a valid one `200`).
