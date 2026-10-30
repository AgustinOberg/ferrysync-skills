# Evals

Task prompts with pass criteria, for a **fresh agent** given only these skills. They measure whether the skills alone are enough to adopt Ferry, which is the goal in Ferry's roadmap ("an agent dropped into someone's app should understand Ferry and wire it from the schema to deploy, without a human explaining it").

| Eval | Skills it exercises | Fixture |
| --- | --- | --- |
| [01-blank-app](01-blank-app.md): add offline sync to a blank app | `ferrysync`, `ferrysync-create-app`, `ferrysync-server`, `ferrysync-testing` | a blank Bun, Hono and Vite React workspace |
| [02-migrate-legacy](02-migrate-legacy.md): migrate an app with its own backend and TanStack Query | `ferrysync`, `ferrysync-migrate`, `ferrysync-server`, `ferrysync-client` | [`fixtures/legacy-tasks`](fixtures/legacy-tasks) |
| [03-troubleshoot](03-troubleshoot.md): fix an app that does not sync | `ferrysync-troubleshooting`, `ferrysync-testing` | [`fixtures/broken-sync`](fixtures/broken-sync/README.md) |
| [04-security-review](04-security-review.md): review a risky integration | `ferrysync-security-review` | [`fixtures/risky-server`](fixtures/risky-server/sync-server.ts) |

## How to run one

1. Make a scratch directory under your projects folder (not a synced or protected folder). Prepare the fixture as the eval says. Keep it out of this repo.
2. Install the skills locally: `bunx skills add /path/to/ferrysync-skills` (or copy `skills/*` into the agent's skills folder). Install nothing else that mentions Ferry: no Ferry `AGENTS.md`, no docs open.
3. `ferrysync` 0.1.0 is on npm (and `@ferrysync/zustand`, `@ferrysync/jotai`, `@ferrysync/legend-state`), so the agent installs it from the registry. To test an unreleased build instead, give the agent a tarball or workspace path **only when it asks where to install from**.
4. Start a fresh agent session in the scratch directory. Paste the prompt exactly. Do not answer technical questions beyond the "Operator answers" in the eval.
5. Save the transcript. Grade each criterion pass or fail from the transcript and the resulting files. Record a row in the results table.

## Grading

Every eval lists criteria in four groups. A run **passes** when every `must` criterion passes. `should` criteria are scored but do not fail the run.

- **Process.** The agent loaded the right skill, followed its order (for example, assessed before editing), and asked instead of guessing where the skills say to.
- **Outcome.** The files and checks that must exist or pass, verified by running commands, not by reading the agent's claims.
- **Safety.** Nothing from the "Do not" lists happened: no destructive command, no invented API, no secret echoed.
- **Report.** The final message says what was done, what ran, and what could not run, in a way that matches the transcript.

Automated checks (run in the scratch project after the agent finishes):

```sh
bunx tsc --noEmit                  # the project's type check passes
bunx vitest run                    # the tests the agent wrote pass
grep -rn "demo-user" src server    # empty, or called out in the report as development only
grep -rn "memoryStore\|memoryStorage" src server | grep -v test   # none in production paths
grep -rnE "\bas any\b|@ts-ignore" src server                       # none
```

## Results

Fill in per run. Keep failures: each one is a skill bug to fix.

| Date | Eval | Agent and version | Skill versions | Result | Failed criteria and the fix made |
| --- | --- | --- | --- | --- | --- |
| 2026-10-30 | audit of `ferrysync-create-app` by an agent that had read Ferry's docs (not a fresh agent): the Vite React and Hono recipe built from an empty folder with `ferrysync@0.1.0` from npm: type-checked schema and client, `vite build`, Hono server over `node:sqlite` (401 then 200 curl check, a real client pushing over HTTP), the `verify-two-devices` harness test and the security-review harness tests all pass | the auditing agent | 0.1.0 | partial: no browser, no second device by hand, no Expo, Next.js, Postgres or Cloudflare | found and fixed: the recipe did not say `node:sqlite` is missing on Bun 1.3.6 (use `bunSqlite`), nor to install `hono` and `@hono/node-server`; the Cloudflare recipe lacked `maxBodyBytes: 2_000_000` |
| 2026-10-28 | partial dry run of 01 and 02 by the agent that wrote the skills (not a fresh agent: it had read Ferry's docs, so it proves the steps and snippets work, not that the skills are enough on their own) | the authoring agent | 0.1.0 | partial: server, route, curl check, two real clients over HTTP, harness tests (sharing, rules, stranger, restart, virtual clock), conformance kits, mirror and `backfill` on SQLite. Not run: browser, React render, Expo, Next.js, Postgres, Cloudflare, `within`, `log` | one skill bug found and fixed: the realtime test example lacked `claimSpace` |
