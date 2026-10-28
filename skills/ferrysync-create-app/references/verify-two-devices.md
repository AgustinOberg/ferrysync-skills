# Verify: the route, two devices, offline

## 1. The route is mounted and `auth` runs

`auth` runs before the body is read, so an anonymous request is a clean 401. With a user, a valid pull body is a 200:

```sh
# Mounted and rejecting anonymous callers: expect 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/sync/pull

# With credentials the app uses (a cookie or a bearer token): expect 200
curl -s -X POST http://localhost:3000/api/sync/pull \
  -H 'content-type: application/json' -H 'authorization: Bearer <token>' \
  -d '{"clientId":"c1","schemaVersion":1,"after":0}'
```

| Answer | Meaning |
| --- | --- |
| `404 unknown_endpoint` | Wrong path or not a `POST`. The client `url` is the mount without the endpoint |
| `401 unauthenticated` | `auth` returned `null`: expected without credentials |
| `400 invalid_request` | The body is not a valid request |
| `403 forbidden` | The `clientId` already belongs to another user |
| `413 too_large` | Body over `maxBodyBytes` (5 MiB) |
| `500 internal` | Failure: the cause went to `onError`, never to the client |

## 2. Two devices converge (automated)

`createTestHarness` runs the real server and any number of clients in one process: no network, no mocks.

```ts
import { createTestHarness } from 'ferrysync/testing';
import { expect, test } from 'vitest';

import { schema } from './schema';

test('a project reaches the members of its space, and an offline edit syncs', async () => {
  const harness = createTestHarness({
    schema,
    server: {
      claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
    },
  });
  const alice = await harness.client('alice');
  const project = alice.projects.create({ name: 'Japan' });
  await harness.settle();

  // Membership is the backend's call: here the test plays the invite endpoint.
  await harness.server.spaces.addMember('bob', `project:${project.id}`);
  const bob = await harness.client('bob');
  await harness.settle();
  expect(bob.projects.get(project.id)).toEqual(project);

  const task = alice.tasks.create({ projectId: project.id, title: 'Visa' });
  await harness.settle();
  expect(bob.tasks.get(task.id)).toEqual(task);

  await harness.close();
});
```

The harness authenticates its clients by the user id you pass: test your real `auth` separately with requests that carry real cookies or tokens (the curl check).

## 3. By hand, with real devices

1. Open the app in two windows (web) or two simulators, signed in as the same user. A row created in one appears in the other within a moment.
2. Take one offline: browser dev tools, Network, Offline; phone: airplane mode. Add and tick things: they apply at once.
3. Reload or relaunch while offline: the changes are still there (they wait in the outbox).
4. Edit the same field on both while offline, then reconnect: both converge on the value the server applied last.
5. Restart the server. Everything is still there and both apps carry on.

On the web the second window must be another browser profile or a private window if the storage is IndexedDB: one tab at a time owns the local database (`StorageLockedError`).

**Verify:** the harness test passes and the five manual checks hold. If one fails, load [ferrysync-troubleshooting](../../ferrysync-troubleshooting/SKILL.md).
