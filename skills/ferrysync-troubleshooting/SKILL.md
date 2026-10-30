---
name: ferrysync-troubleshooting
description: "Diagnose Ferry (ferrysync) problems from symptom to cause to fix: nothing syncs, pending never reaches zero, a write disappeared or was rolled back, rejection and HTTP codes (forbidden, invalid, exists, not_found, deleted, conflict, forgotten, too_large, rejected, updateNeeded, mustRefetch, 401, 403, 404, 413, 500), duplicates, auth failures, other users not seeing rows, realtime delay or cutoffs, StorageLockedError, version and schema mismatches, Hermes and React Native pitfalls, mirror and store startup errors. Use when the user says sync is not working, data is missing or stale, a change reverted, status is offline or updateNeeded, I get a 401, 403 or 413, rows are duplicated, or it works on web but not on the phone."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# Troubleshooting Ferry

Work from evidence, not guesses. Never claim a fix works without running the check that proves it.

## Step 1: collect the facts (read-only, 2 minutes)

1. **Client state.** Log `sync.status` (`phase`, `pending`, `lastError`, `lastSyncId`, `lastSyncedAt`, `online`, `synced`). In React, `useSyncStatus()`. Add `onRejected`, `onInvalidRow` and `onUpdateNeeded` logging to `createSync` if absent.
2. **Network.** Do requests to `<url>/push`, `/pull`, `/bootstrap`, `/wait` appear? What status? (Network tab, Flipper, the Argent network tools, or the server access log.)
3. **Server.** Is `onError` set and logging? Read its output.
4. **Isolate.** Reproduce with `createTestHarness` (see [ferrysync-testing](../ferrysync-testing/SKILL.md)). A harness repro takes the network, the proxy and the platform out of the question.
5. **The route.** `curl -s -o /dev/null -w '%{http_code}\n' -X POST <url>/pull`: `401` means mounted and `auth` runs; `404` means the path or method is wrong.

```ts
import { sync } from './sync';

sync.onStatus((status) => console.log('ferry', status.phase, `pending=${status.pending}`, status.lastError));
```

## Step 2: find the symptom

[symptoms](references/symptoms.md) has the full symptom, cause, fix and check tables. Start here:

| Symptom | First thing to check |
| --- | --- |
| `phase` is `offline` with a `lastError` | The network error text: wrong `url`, CORS, `localhost` on a device, 401, a proxy cutting requests |
| `pending` stays above 0 | A push that keeps failing (a hook that throws, a 5xx), or the device is offline, or `updateNeeded` |
| A write appeared, then reverted | `onRejected`: the server refused it (the row was rolled back). The `code` says why: [error-codes](references/error-codes.md) |
| Another user does not see my rows | They are not a member of the row's space, or the table has no space function (private) |
| My create is `forbidden` | The space has no members: `claimSpace` is missing or returned `false` |
| 401 on every request | `auth` returns `null`: credentials not sent (`headers`, cookies, CORS) or not verified |
| 403 `forbidden` on every request | The device belongs to another user: sign-out must `sync.reset(local())` |
| Works on web, not on the phone | `url` host, cleartext HTTP, AppState sync, Hermes |
| Changes arrive 15 s late, or every 10 or 30 s | Several instances without a `broadcast`, or a proxy or Bun idle timeout |
| `StorageLockedError` | Second tab: error boundary or `onLocked: 'wait'` |
| `status.phase` is `updateNeeded` | The server's `versions` range does not include the app's schema version |
| Duplicates | Two writers (old API and Ferry), a second client, `create` run twice, a backfill with different ids |
| Edits overwritten | Last writer wins per field: model the data accordingly |

## Step 3: fix, then prove

Make the smallest fix, add the regression test (a harness test that failed before), run the project's checks, and say exactly what you ran. If the cause is outside the project (a proxy setting, a platform limit), say what the user must change and how they can verify it.

## Do not

- Do not delete the server's database, `ferry_*` tables or a user's local data to "reset" a problem without the user's explicit, named confirmation. Clearing local data loses pending writes.
- Do not run `afterRestore`, `refetch` in a loop, `reset`, or raise `maxBodyBytes` blindly: understand the cause first.
- Do not catch and swallow `WriteRejectedError`, `onRejected` codes or `onError` output to make a symptom disappear.
- Do not edit `ferry_*` tables by hand.
- Do not blame the network before reading `lastError` and the actual response.

## References

- [symptoms](references/symptoms.md): symptom, cause, fix, check.
- [error-codes](references/error-codes.md): rejection codes, HTTP codes, statuses, error classes.
