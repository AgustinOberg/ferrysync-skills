# Auth and spaces

## `auth(request)`

| It returns | The server |
| --- | --- |
| a user id | answers as that user: their private space and the spaces they joined |
| `null` or `''` | answers 401; the client calls `onUnauthorized` and retries with backoff |
| throws | answers 500 and hands the error to `onError` |

Session cookie (app and backend share a domain; the browser sends it with every sync request):

```ts
import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => (await getSession(request))?.userId ?? null,
});
```

Bearer token (native apps and web apps on another domain). Verify a signed token locally rather than calling the provider per request:

```ts
import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => {
    const header = request.headers.get('authorization');
    if (header === null || !header.startsWith('Bearer ')) return null;
    return verifyToken(header.slice('Bearer '.length)); // the user's id, or null
  },
});
```

The client sends it on every request; `headers` is asked each time, so a refreshed token is used, and `onUnauthorized` is where the app signs out when it cannot refresh:

```ts
import { createSync, http } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({
  schema,
  backend: http({
    url: 'https://api.example.com/sync',
    headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
    onUnauthorized: () => showToast('Please sign in again'),
  }),
});
```

| Provider or library | In `auth` |
| --- | --- |
| Better Auth | `(await auth.api.getSession({ headers: request.headers }))?.user.id ?? null` |
| Auth.js | `(await auth())?.user?.id ?? null` |
| Supabase | `supabase.auth.getUser(token)` then `data.user?.id ?? null`: `docs/examples/supabase.md` |
| Firebase | `getAuth().verifyIdToken(token)` then `.uid`, `null` on a throw: `docs/examples/firebase.md` |
| Clerk, Auth0, WorkOS, any JWT | Verify against the provider's JWKS (`jose`'s `createRemoteJWKSet`, `jwtVerify` with issuer and audience), return `payload.sub`, `null` on a throw: `docs/examples/own-auth.md` |
| Passport (`req.user`) on Express | A middleware sets a header for `auth`, after deleting the client's own copy: `docs/examples/express.md` |
| Hono middleware | Hand the user through a `WeakMap<Request, string>`: `docs/examples/hono.md` |

A device belongs to the first user who syncs with it. Another user on the same device without a wipe gets `403 forbidden`: sign-out must call `sync.reset(local())`.

## Membership

```ts
import { syncServer } from './sync-server';

await syncServer.spaces.addMember(userId, `project:${projectId}`); // their devices download it
await syncServer.spaces.removeMember(userId, `project:${projectId}`); // their devices drop it
await syncServer.spaces.members(`project:${projectId}`); // ['alice', 'bob']
await syncServer.spaces.of(userId); // ['project:p1', 'team:t1']
```

- Both changes reach the user's devices in realtime. Adding a member and removing a non-member do nothing.
- Membership is not a row: no hook runs, and the app cannot change it. Only the backend decides.
- Removing a member drops their pending changes in that space, on their devices.
- Changing a row's space (an update of `projectId`) moves it: the writer must belong to both spaces.
- Keep space ids stable: membership is stored by id.
- A space ends with its rows: to delete a project, delete its rows with `write` and remove its members. A space whose members all left but whose rows stayed is never claimed again.

### Invites

An invite is an endpoint of the backend. Check what an invite means in the app (a token, a seat limit, billing), then add the member. The invited user's devices download the project as soon as the call returns:

```ts
import { Hono } from 'hono';

import { syncServer } from './sync-server';

const app = new Hono();

app.post('/invites/:token/accept', async (c) => {
  const session = await getSession(c.req.raw);
  const invite = await findInvite(c.req.param('token'));
  if (session === null || invite === null) {
    return c.json({ error: 'Not found' }, 404);
  }
  await syncServer.spaces.addMember(session.userId, `project:${invite.projectId}`);
  return c.json({ ok: true });
});
```

### `claimSpace`

A user creates a project on a phone, offline. When the phone syncs, the project's space has no members, so the write would be `forbidden`. `claimSpace` lets the first writer become the first member, in the same transaction as the write. The server asks only when a write puts a row in a space with no members and no rows.

```ts
import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  // A project's own row founds its space; nothing else does.
  claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
});
```

Decide from the row, so only the row that creates a space can found it. The context also has `actor` (`{ type: 'user', userId, clientId }`). Returning `false` refuses as `forbidden`.

### Private spaces

A table without a space function (or a row whose function returns `null`) is private to its creator: `user:<userId>` on the server. Writing a private row as `system` needs `{ owner }`: `tx.notes.create(input, { owner: userId })`.

## Verify with a test

Every sharing rule gets a harness test: see [ferrysync-testing](../../ferrysync-testing/SKILL.md).
