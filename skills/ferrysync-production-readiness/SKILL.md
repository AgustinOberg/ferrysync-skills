---
name: ferrysync-production-readiness
description: "Go-live checklist and honest risk list for a Ferry (ferrysync) deployment: package pinned and published, store and migrations, timeouts and proxies, shared database and broadcast for several instances, retention versus offline spans, backups with a rehearsed afterRestore, monitoring with onError and client status, schema version policy, capacity expectations, and Ferry's known gaps (no external security review, no metrics API, no account deletion API, ferry_clients growth, oversized transactions, unconfirmed D1 and Durable Objects, one tab on the web). Use when the user asks if Ferry is ready for production, wants a launch or go-live checklist, plans capacity or an on-call runbook, asks about GDPR or deleting a user, or asks what could go wrong at scale."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# Production readiness for a Ferry deployment

Load [ferrysync](../ferrysync/SKILL.md) first. Ferry is at version 0.1.0 and its own roadmap lists what stands between it and "production ready". Tell the user the gaps plainly, check the deployment against the list below, and produce a report with each item marked `ok`, `gap` or `not verified`. Never mark an item `ok` that you did not check.

## Procedure

1. Read the current Ferry `ROADMAP.md` (Road to production ready) and `docs/versioning.md` if you have the checkout, and `npm view ferrysync version`: the gap list below is a snapshot, and the roadmap wins. See [known-gaps](references/known-gaps.md).
2. Walk the checklist, reading the project's config and code. Run the commands that are safe (type check, tests, curl against staging). Never run restores, resets or migrations against production.
3. Report: a table `area | status | evidence | action`, then the known gaps that apply to this deployment and what mitigation the user is choosing, then the unverified items.

## Checklist

| Area | Check | Evidence |
| --- | --- | --- |
| Package | `ferrysync` and `@ferrysync/*` versions are pinned and published; app and server upgrade server first; release notes read for store changes | `package.json`, lockfile |
| Storage | No `memoryStorage()` / `memoryStore()` outside tests | grep |
| Store | SQLite: one process, a volume that outlives deploys, backups. Several instances or serverless: Postgres | config |
| Migrations | `migrate` mode decided; `syncTablesSql` in the migration tool if `migrate: false`; upgrade path for the next release known | migrations |
| Auth | Real `auth`; no demo user; see [ferrysync-security-review](../ferrysync-security-review/SKILL.md) | review |
| Timeouts | Every hop allows 30 s of silence: proxy, load balancer, function (Vercel `maxDuration = 60`, Lambda above 30 s), Bun `idleTimeout: 40` | config; no repeating 504 |
| Several instances | Shared database; `broadcast` (Redis or Postgres `LISTEN`/`NOTIFY`) if instant realtime matters; `waitUntil` on serverless | config |
| Open requests | File descriptor limit, balancer connection limits, serverless billing of held invocations considered: about one held request per online device | capacity note |
| Retention | `retention.days` above the longest time a device stays offline (default 90) | config |
| Schema versions | `versions` accepts every app version in the wild; policy for raising `min`; server deployed before the app | config |
| Errors | `onError` logs to the team's logger (hooks, publishes, 500 causes); client logs `onRejected`, `onInvalidRow`, status | code |
| Shutdown | `SIGTERM` calls `syncServer.close()` | code |
| Backups | A backup exists, and a restore **with `afterRestore`** was rehearsed on a copy; the runbook names who runs it | runbook |
| CORS and TLS | Exact origins; HTTPS | config |
| Client | One client per app; foreground `syncNow()`; sign-out resets; sync status visible to users; second-tab handling on web | code |
| Data | Counters and lists modelled as rows; no secrets in synced rows; length limits | schema |
| Tests | Harness tests for sharing, rules, offline, accounts; the project's check passes | CI |
| Account deletion | A procedure exists (Ferry has no API): see known gaps | runbook |
| Monitoring | Alerts on route 5xx, p95 latency, held waits, database CPU and storage, `ferry_log` size | dashboards |

## Capacity expectations (measured by Ferry, in process, not a promise)

Ferry's own benchmark page (`docs/benchmarks.md`) reports, on a laptop, about 800 `server.write` per second on Postgres 17 in Docker with 2 CPUs, about 470 single-row pushes per second, and about 7 KB of server memory per held `wait`. Its roadmap says some benchmark findings are not yet explained: waking 1,000 held waits with one write ran about 13,580 SQL statements, and a timing differs by about 50 times between a laptop and a CI runner. Do not promise numbers to the user: say these are single-instance in-process measurements, a load test with thousands of users online has not been run, and recommend one on their own infrastructure before launch.

Client side, opening 100,000 rows takes about 250 ms to 550 ms depending on storage, in Node: no real-device Hermes number exists yet. The dataset a user can see must fit in memory.

## Do not

- Do not call Ferry "production ready" or "battle tested": say version 0.1.0, no external security review, and list the gaps that apply.
- Do not run `afterRestore`, change `retention`, raise `versions.min`, run migrations, or delete data in production as part of a review. Describe the step and wait for the user's explicit confirmation naming the environment.
- Do not invent metrics, SLAs or throughput numbers.
- Do not leave `auth: () => 'demo-user'`, `memoryStore()` or `memoryStorage()` in a production path.

## References

- [known-gaps](references/known-gaps.md): the snapshot of Ferry's open production items, each with its impact on an integration and a mitigation.
