# Known gaps

Snapshot from Ferry's `ROADMAP.md` and docs as of 2026-10-28 (Ferry 0.1.0). Verify against the current `ROADMAP.md` ("Road to production ready") and the installed version: items get fixed. Each row: what is open, what it means for an integration, what to do now.

| Gap | Impact | Mitigation now |
| --- | --- | --- |
| **No external security review** of the server surface | Unknown vulnerabilities in the library; the roadmap puts a review before 1.0 | Run [ferrysync-security-review](../../ferrysync-security-review/SKILL.md) on the integration; keep the route behind the app's normal edge protections; say this to the user |
| **No server metrics.** Only `onError` | Nobody can see push or pull latency, held waits, log size or rejections by code unless the app logs them | Log from `onError` and the client's `onRejected`; monitor the route and the database; a metrics API is planned (RFC first) |
| **No account deletion API** (GDPR) | A deleted user's rows stay in `ferry_records`, the log and push results | A manual procedure: remove the user from their spaces (`spaces.removeMember`), delete their private and sole-owned rows with `syncServer.write` (rows become tombstones and the log keeps history until retention drops it), then decide with the user and counsel how long the log and tombstones may remain. Treat as a legal question: recommend human review |
| **`ferry_clients` is not pruned** | One small row per install grows forever | Acceptable at small scale; watch the table. Pruning is planned |
| **A transaction larger than `maxBodyBytes` retries forever** and blocks the outbox behind it | A big bulk import in one transaction can wedge a device | Split bulk writes into several transactions; keep pushes well under 5 MiB; no skip exists without a protocol change |
| **Waking many held `wait` requests is expensive.** One write waking 1,000 waits ran about 13,580 statements in a benchmark | Many users online in one shared space could multiply load per write | Load-test your shape; prefer many small spaces; do not run thousands of users in one space without measuring |
| **Write throughput of one space is ordered.** 16 devices writing at once are only about 1.3 times faster than one after another on Postgres in one benchmark | Hot spaces serialize | Measure; split data across spaces |
| **No load test past thousands of online users; no realtime latency benchmark** | Capacity is unproven | Run a load test on your infrastructure first |
| **No real-device Hermes numbers** (startup with real data) | Unknown cold-start cost on low-end phones | Measure on a device with a realistic dataset |
| **D1 and Durable Objects are unconfirmed on real Cloudflare**: the roadmap says the docs' limits are from memory and that SQL run inside a Durable Object's async `storage.transaction()` is unverified (it plans to label both experimental in the docs; they did not carry that label when this was written) | Production use on Cloudflare is unproven | Prefer Postgres (Hyperdrive) for production, or test on the real platform first |
| **One tab at a time on the web** (exclusive lock; sharing one database between tabs is paused work) | A second tab errors or waits | Error boundary, or `onLocked: 'wait'`; tell users |
| **Realtime is long polling**, no WebSockets | Held requests per device; proxies must allow 30 s of silence | See the deploy checklist |
| **Versioning policy is partly undecided** (which release number a change calls for, deprecations, storage versions of localStorage, MMKV and key-value storages) | Upgrades between 0.x releases may be breaking by policy | Pin versions; read release notes; upgrade the server first; rolling a release back is unsupported after the store tables upgraded |
| **Last-writer-wins only** | No merging of concurrent text edits | Model the data for it, or use a CRDT for that field |
| **No per-member read-only roles** built in | Membership gives read and write | A `validate` hook with a role lookup |
| **Encryption at rest on the device is not described** | Rows sit in plaintext in IndexedDB or SQLite | Do not sync secrets; use platform keychains; OS-level device encryption |

## Reporting to the user

State the gaps that apply to their deployment, not all of them. For each: the risk in one sentence, the mitigation they have chosen or the one you recommend, and who owns it. If a gap blocks their launch criteria (for example account deletion for a GDPR product), say so first.
