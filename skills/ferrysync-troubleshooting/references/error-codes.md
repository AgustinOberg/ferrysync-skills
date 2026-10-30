# Error codes, statuses and error classes

## Rejection codes

A rejected transaction is a `200` answer with a permanent code. The device rolls it back and `onRejected({ code, message, name, changes, transaction })` fires. Never retry the same write expecting a different outcome.

| Code | Meaning | Typical cause | Fix |
| --- | --- | --- | --- |
| `forbidden` | The row's space (before or after the change) is not one of the user's | The user is not a member; a project created offline with no `claimSpace`; a row moved to a space the writer is not in | `syncServer.spaces.addMember`; add `claimSpace` for the founding row; make the writer a member of both spaces |
| `invalid` | A resulting row fails the model's schema, has no space, changes `id`, or a string holds U+0000 | The server's schema differs from the app's (a breaking change without a version bump); bad data | Align schemas; bump `version`; strip U+0000 |
| `exists` | `create` of an id that is alive | Two writers creating the same id; a retry with a fixed id | Use `createId()`; do not reuse ids |
| `not_found` | `update` of an id that never existed | The create was refused earlier, or never reached the server | Fix the earlier rejection |
| `deleted` | `update` of a tombstone | Another device deleted the row (delete wins) | Expected: the row stays deleted. Undo of a delete restores it by re-creating |
| `unknown_model` | The server does not know the table | Server schema older than the app's | Deploy the server first |
| `local_only` | The table is `localOnly` | A write to a local-only table reached `syncServer.write` | Do not sync it, or remove it from `localOnly` |
| `rejected` | A `validate` hook returned a bare string | Your rule | The message is yours: show it |
| your code | A `validate` hook returned `{ code }` (`read_only`, `no_project`...) | Your rule | Handle in `onRejected` |
| `too_large` | Raised by the device: a transaction pushed alone was refused with a 413 (the server's `maxBodyBytes`, or a proxy's limit) | A bulk write in one transaction; nginx `client_max_body_size` (1 MiB by default, under Ferry's 5 MiB) | The device rolled it back and keeps going. Split bulk writes into several transactions; raise the proxy limit |
| `forgotten` | Raised by the device: a resend whose answer the server pruned (retention), and the rows do not show the change | The device was offline longer than `retention.days`; or the server refused it earlier, or someone changed those rows since | The device already shows what the server has. Raise `retention.days` above offline spans. A delete reports `forgotten` even if applied |

Update and delete of a missing row on the client return `false` and reject nothing.

## Push statuses (per transaction)

| Status | Meaning |
| --- | --- |
| `applied` | Confirmed once the cursor reaches its `syncId` |
| `rejected` | Permanent: rolled back, with a `code` |
| `forgotten` | The server processed the seq before but no longer remembers its answer: nothing applied twice; the device settles it from the rows |
| `conflict` | Applies nothing and ends the results. Another install shares the client id and already used that seq (a copied device), or the seq comes after a gap (the server's database was restored). The client takes a new client id, renumbers its unprocessed transactions from 1 and resends. Automatic |

## Pull, bootstrap and push answer kinds

| Kind | Meaning |
| --- | --- |
| `mustRefetch` | The cursor is older than the retained log, or newer than the log (the backend was restored or recreated). The client downloads everything again; pending changes are kept. Automatic |
| `forgottenClient` (a push answer) | The server forgot this device (no push for `retention.clients.days`, default 365) and applied nothing. The device pulls, confirms the changes the data already shows, takes a new client id and sends the rest again from seq 1. Automatic. A device on an older release gets `conflict` instead |
| `updateNeeded` | The server no longer accepts this schema version. Phase `'updateNeeded'`, `onUpdateNeeded`, writes keep queueing |

## HTTP errors (non-2xx, body `{ "error": { "code", "message" } }`)

| Status | Code | When | What to do |
| --- | --- | --- | --- |
| 400 | `invalid_request` | Body not JSON, not a valid request; with `toNodeHandler`, a bad `Host` header | A proxy rewrote the body, or the wrong URL |
| 401 | `unauthenticated` | `auth` returned `null` or `''` | Credentials not sent or not verified. Client calls `onUnauthorized`, retries with backoff |
| 403 | `forbidden` | The client id belongs to another user | Sign-out must wipe: `sync.reset(local())` |
| 404 | `unknown_endpoint` | Not a `POST`, or the last path segment is not `push`, `pull`, `bootstrap` or `wait` (a 404 from the framework's router, with no Ferry body, means the path is not mounted) | Wrong mount path or method; the client `url` is the mount, with no endpoint at the end |
| 413 | `too_large` | Body over `maxBodyBytes` (5 MiB), `fetch` only; a proxy's own 413 has no Ferry body | A framework parser limit may apply first (Express `json` 100 kB, Fastify `bodyLimit` 1 MiB). The client halves the batch; a transaction refused alone is rolled back and `onRejected` gets `too_large` (see above) |
| 500 | `internal` | Something failed; the cause goes to `onError`, never to the client | Read `onError` |
| 503 | `unavailable` | The server was closed (`close()`) | Expected during deploys: devices retry |

Client-side transport codes (`SyncHttpError.code`, with `status`, exported from `ferrysync/engine`): `unexpected_status` (a proxy's 502 and similar: the status is not Ferry's), `invalid_response` (a 2xx body that fails validation: something between answered with HTML), `timeout`, `network`. The client treats every non-2xx as temporary and retries with backoff, except a push's 413 (above).

## Error classes

| Class | From | Fields | Meaning |
| --- | --- | --- | --- |
| `ValidationError` | `ferrysync` | `table`, `issues` (paths and messages) | A client write failed the schema; nothing changed |
| `StorageLockedError` | `ferrysync` | `code: 'locked'` | Another tab owns the web storage. Rejects `sync.ready` |
| `WriteRejectedError` | `ferrysync/server` | `code`, `message` | `syncServer.write` or `log` was refused |
| `D1ConflictError` | `ferrysync/server` | | A second writer on D1: nothing written, devices retry. Two coordinators for one database |
| `TransportFaultError` | `ferrysync/testing` | `fault` | Injected by `faultyTransport` |

Errors a developer sees as plain `Error` messages: a write before ready ("await sync.ready"), `sync.tasks.create` inside a transaction, an `async` transaction callback (`TypeError`), `pollIntervalMs` without `realtime: false`, `defineSchema` mistakes at startup (unknown table in `spaces` or `localOnly`, local-only table with a space, reserved table name, a value that is not a Standard Schema).
