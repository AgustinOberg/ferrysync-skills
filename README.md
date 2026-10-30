# ferrysync-skills

[Agent Skills](https://agentskills.io) that let a coding agent adopt [Ferry](https://ferrysync.pages.dev) (`ferrysync`), offline-first sync for TypeScript, end to end: understand when it fits, wire it into a new or existing app from the schema to deploy, test it, and fix it when it misbehaves, without a human explaining it.

They are plain `SKILL.md` files with `references/`, so Claude Code, Codex, Cursor, OpenCode and any other agent that supports the open format load them. Each skill loads only when its description matches the task.

## Install

With the [skills CLI](https://github.com/vercel-labs/skills), in your project:

```sh
bunx skills add AgustinOberg/ferrysync-skills
```

One skill, or for every project on your machine:

```sh
bunx skills add AgustinOberg/ferrysync-skills --skill ferrysync
bunx skills add AgustinOberg/ferrysync-skills --skill ferrysync-migrate -g
```

Claude Code, as a plugin marketplace (the manifest is in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)):

```text
/plugin marketplace add AgustinOberg/ferrysync-skills
/plugin install ferrysync-skills@ferrysync-agent-skills
```

> **Status.** These skills describe `ferrysync` 0.1.x, which is on npm together with `@ferrysync/zustand`, `@ferrysync/jotai` and `@ferrysync/legend-state`. The skills tell the agent to check that the packages resolve (`npm view ferrysync version`) and to ask where to install from instead of guessing.

## The skills

| Skill | Loads when the user... |
| --- | --- |
| [`ferrysync`](skills/ferrysync/SKILL.md) | mentions Ferry, `createSync`, offline-first or local-first sync, or wants an app to work offline or sync devices. The entry point: fit check ("use it when / look elsewhere"), vocabulary, how to pick storage, backend, store and UI binding, and the 10-step path with a check after each step. Routes to the others |
| [`ferrysync-create-app`](skills/ferrysync-create-app/SKILL.md) | starts a new app or feature with sync. Recipes for Expo and React Native, Vite and React, Next.js, with Hono, Express, Node, Bun or Cloudflare backends over SQLite, Postgres or D1, and a two-device offline check |
| [`ferrysync-migrate`](skills/ferrysync-migrate/SKILL.md) | has an existing app (REST, TanStack Query, SWR, Redux, Zustand, Firebase, Supabase, an existing Postgres with Prisma or Drizzle) and wants to move to Ferry. Assessment, mirrors, `backfill`, `log`, per-stack mapping tables, cutover, rollback, checklist |
| [`ferrysync-server`](skills/ferrysync-server/SKILL.md) | works on the server: `auth`, spaces and invites, `claimSpace`, hooks, `syncServer.write`, stores and drivers, migrations, retention, realtime and `broadcast`, deploy per platform, backups and `afterRestore` |
| [`ferrysync-client`](skills/ferrysync-client/SKILL.md) | works on the client: schema evolution and versions, queries, transactions and undo, status and offline UI, storages, `connect` and `reset`, React and the Zustand, Jotai and Legend-State adapters |
| [`ferrysync-testing`](skills/ferrysync-testing/SKILL.md) | writes tests: client tests, `createTestHarness`, virtual clock, components, conformance kits, the seeded simulator |
| [`ferrysync-troubleshooting`](skills/ferrysync-troubleshooting/SKILL.md) | has a symptom: nothing syncs, a write vanished, a 401/403/413, `forbidden`, `forgotten`, `updateNeeded`, duplicates, realtime delays, Hermes pitfalls. Symptom, cause, fix, check tables |
| [`ferrysync-security-review`](skills/ferrysync-security-review/SKILL.md) | asks for a review of auth, spaces, hooks and server writes. Review only: findings with severity, plus cross-user tests |
| [`ferrysync-production-readiness`](skills/ferrysync-production-readiness/SKILL.md) | asks if it is ready for production, wants a go-live checklist, capacity or account deletion. Includes Ferry's open gaps, stated plainly, and `deleteUser` |

### Why these boundaries and names

- **Prefix `ferrysync-` on every skill.** Harnesses load skills into one flat namespace, so generic names such as `create-offline-first-app` or `testing` collide with other skills. The prefix also groups them. `create-offline-first-app` became `ferrysync-create-app`, and `migrate-to-offline-first` became `ferrysync-migrate`.
- **One entry skill, then one skill per job.** The entry skill is small and routes; each other skill has a description that names its trigger phrases, so an agent loads a skill only when needed.
- **Two skills beyond the brief.** `ferrysync-security-review` (auth, spaces and hooks are where a Ferry integration goes wrong, and a review must not edit access control) and `ferrysync-production-readiness` (Ferry is 0.1.0 and its roadmap lists real gaps, such as no external security review, no load test and no run on real Cloudflare, which an agent must surface before launch). They are separate so they load for a review or a launch, not on every task.
- **Detail lives in `references/`**, loaded on demand, and `SKILL.md` stays short and procedural.

## What the skills do not copy: the docs

The skills point at Ferry's docs for the long tail instead of copying them: [`skills/ferrysync/references/docs-map.md`](skills/ferrysync/references/docs-map.md) maps every topic to its page and names the machine-readable files the docs site publishes (`llms.txt`, `llms-full.txt`).

**Docs base URL:** https://ferrysync.pages.dev. The skills point agents at `llms.txt` and `llms-full.txt` there, and fall back to the Markdown under `docs/` in a Ferry checkout. To move the site, change the one line `DOCS_BASE_URL` in `docs-map.md` (the linter fails if the placeholder appears anywhere else).

## Layout

```text
.claude-plugin/marketplace.json   plugin manifest listing every skill
skills/<name>/SKILL.md            frontmatter (name, description) + short procedure
skills/<name>/references/*.md     detail, loaded on demand, every file linked from SKILL.md
evals/                            task prompts and pass criteria for fresh agents
scripts/check-snippets.ts         type-checks every ts/tsx block against the Ferry packages
scripts/lint-skills.ts            frontmatter, links, orphans, manifest and README coverage
scripts/support/                  the schema, client and server that snippets import
```

## Checks

```sh
bun run check
```

- `lint:skills`: `name` equals the folder, `description` is 100 to 1024 characters and says "Use when", `SKILL.md` is under 500 lines, every relative link resolves, every reference is linked, every skill is in the manifest and this table, no emoji or em dash, the docs URL placeholder lives in one file.
- `check:snippets`: extracts every `ts` and `tsx` fence and type-checks it with Ferry's own `docs/tsconfig.json`, against the Ferry sources, as an app would compile it. A renamed export, a wrong option or a mistyped method fails the check. It needs a Ferry checkout with `node_modules` installed, found at `../ferrysync` or at `FERRY_REPO`, and never writes there. A block that cannot compile says `no-check` in its fence and why in the text.

The checks do not prove prose claims (a default value in a table, a behavior). Those come from the Ferry docs and source, and the evals test the skills end to end.

## Keeping in sync with Ferry releases

1. On every Ferry release (or any change to a public entry point, option, default, error code or docs page): check out the release next to this repo and run `bun run check`. Fix what fails.
2. Read the release notes and the diff of `docs/` and `ROADMAP.md` for behavior the checks cannot see: defaults, limits, new error codes, store migrations, items closed in "Road to production ready" (update `ferrysync-production-readiness/references/known-gaps.md`).
3. Update the docs map if pages moved, bump `metadata.version` in the changed skills and `.claude-plugin/marketplace.json`, and re-run the evals in [`evals/`](evals/README.md) when behavior the procedures rely on changed.
4. Tag this repo's release next to Ferry's (this repo's version follows the Ferry minor it describes).

## Contributing

Read [`AGENTS.md`](AGENTS.md): the rules for editing a skill (Ferry is the source of truth, code blocks compile, one job per skill, honest limits). Open a pull request with `bun run check` green. A change to a skill should say which Ferry page or source file it follows.

## License

MIT, see [`LICENSE`](LICENSE).
