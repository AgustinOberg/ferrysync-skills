# Known gaps

Snapshot from Ferry's `ROADMAP.md` and docs as of 2026-10-30 (Ferry 0.1.0). Verify against the current `ROADMAP.md` ("Road to production ready") and the installed version: items get fixed. Each row: what is open, what it means for an integration, what to do now.

| Gap | Impact | Mitigation now |
| --- | --- | --- |
| **No external security review** of the server surface | Unknown vulnerabilities in the library; the roadmap puts a review before 1.0 | Run [ferrysync-security-review](../../ferrysync-security-review/SKILL.md) on the integration; keep the route behind the app's normal edge protections; say this to the user |
| **Write throughput is bounded by one counter.** Every push takes its sync ids from one counter row per server, held for two round trips and a flush. Measured on Postgres in Docker: about 460 pushes per second one at a time, about 1,600 with 16 devices at once. Group commit and per-group counters (a wire and schema change) are open on the roadmap | A very hot server serializes, and spaces do not scale independently | Measure your shape; do not promise numbers |
| **A change in a space with hundreds of members wakes every member's device**, and they pull at once (the cost of a wake itself is now near zero: no SQL, about 11 ms for 1,000 held waits). The roadmap lists large shared spaces as work for after production | Many users online in one shared space multiply the pulls per write | Load-test your shape; prefer many small spaces |
| **No load test with thousands of users online; no realtime latency benchmark.** Deferred by the project: its only infrastructure is shared CI runners | Capacity is unproven | Run a load test on your infrastructure first |
| **No real-device Hermes numbers** (startup with real data); Tavi's migration is meant to give one | Unknown cold-start cost on low-end phones | Measure on a device with a realistic dataset |
| **D1 and Durable Objects have not run on real Cloudflare.** Their store and protocol kits pass inside workerd with local D1 and SQLite Durable Objects (`bun run test:workerd`); D1's queries per invocation, storage caps, and latency, throughput, placement, evictions and deploys mid-request are untested, and a 500-change push is one batch of under 100 statements | Production use on Cloudflare is unproven | Prefer Postgres (Hyperdrive) for production, or run a smoke test on the real platform first; set `maxBodyBytes: 2_000_000` |
| **One tab at a time on the web** (exclusive lock; sharing one database between tabs is built on a branch and paused) | A second tab errors or waits | Error boundary, or `onLocked: 'wait'`; tell users |
| **Realtime is long polling**, no WebSockets (a Durable Objects broadcast is planned) | Held requests per device; proxies must allow 30 s of silence | See the deploy checklist |
| **Versioning policy is partly undecided** (which release number a change calls for, deprecations; `docs/versioning.md` says what is not decided yet) | Upgrades between 0.x releases may be breaking by policy | Pin versions; read release notes; upgrade the server first; rolling a release back is unsupported after the store tables upgraded |
| **A change applied, its answer lost, then undone by someone during a silence longer than `retention.clients.days` (default 365) lands as a late write** (documented limit of client pruning) | A rare resurrected edit after a very long absence | Raise `clients.days` for long-lived devices; the device otherwise settles by itself |
| **A deleted user's devices get no protocol answer of their own**: the app's `auth` must refuse them (a 401, then `onUnauthorized` and `reset`) | A device that `auth` still lets in writes the user's data again | Revoke the account in `auth` before `deleteUser`; see `docs/server/deleting-users.md` |
| **Last-writer-wins only** | No merging of concurrent text edits | Model the data for it, or use a CRDT for that field |
| **No per-member read-only roles** built in | Membership gives read and write | A `validate` hook with a role lookup |
| **Encryption at rest on the device is not described** | Rows sit in plaintext in IndexedDB or SQLite | Do not sync secrets; use platform keychains; OS-level device encryption |

## Closed since the first drafts of this list

Do not report these as gaps: they are in Ferry 0.1.0.

| Was a gap | Now |
| --- | --- |
| No server metrics | `createSyncServer({ metrics })`: request latency, transactions, rejections by code, held waits, log size, retention, errors (`docs/server/metrics.md`). Off by default; you write a small adapter for Prometheus, OpenTelemetry or Datadog |
| No account deletion API (GDPR) | `syncServer.deleteUser(userId)` erases the user's private rows, history, memberships and devices, in one transaction; rows of shared spaces stay, and so does their history until retention drops it. A legal question beyond that: recommend human review (`docs/server/deleting-users.md`) |
| `ferry_clients` grew forever | Retention forgets a device after `retention.clients.days` (default 365); it recovers by itself (`forgottenClient`) |
| A transaction larger than the body limit retried forever and blocked the outbox | The client halves the batch and rolls back a transaction refused alone with `onRejected` code `too_large` |
| Waking many held waits was expensive (13,580 statements for 1,000) | A wake runs no SQL: about 11 ms for 1,000 held waits |

## Reporting to the user

State the gaps that apply to their deployment, not all of them. For each: the risk in one sentence, the mitigation they have chosen or the one you recommend, and who owns it. If a gap blocks their launch criteria (for example account deletion for a GDPR product), say so first.
