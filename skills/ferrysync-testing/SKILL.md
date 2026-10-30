---
name: ferrysync-testing
description: "Test an app that uses Ferry (ferrysync) and the plug points under it: client tests on memory storage and local(), virtual clock and predictable ids, createTestHarness for the real server plus many clients in one process, React component tests, restart and offline cases, conformance kits for a custom storage, server store or backend, and the seeded multi-device simulator with fault injection. Use when the user asks to test sync, write a regression test for a sync bug, test spaces or permissions or hooks, test offline behavior or a rejected write, prove a custom storage or database driver correct, stress concurrency, or add sync tests to CI."
license: MIT
metadata:
  author: AgustinOberg
  version: 0.1.0
---

# Testing with Ferry

Load [ferrysync](../ferrysync/SKILL.md) first. Everything runs in one process with no network and timers you control, so tests are fast and deterministic. Never mock the engine, the server or a store: use the real ones (memory, in-process SQLite, PGlite). Fakes are for things outside the process (fetch, IndexedDB, MMKV).

## Which tool for which question

| The question | Tool | Import | Reference |
| --- | --- | --- | --- |
| Does this component or logic work with Ferry data? | A client over `memoryStorage()` and `local()` (the defaults) | `ferrysync` | [harness](references/harness.md) |
| What survives a restart? | Two clients sharing one `memoryStorage()`, `settle()` between | `ferrysync`, `ferrysync/testing` | [harness](references/harness.md) |
| Does a change reach another device or user? A rejection? A space or hook? | `createTestHarness` | `ferrysync/testing` | [harness](references/harness.md) |
| Backoff, retries, realtime timing | `createVirtualClock` | `ferrysync/testing` | [harness](references/harness.md) |
| Does my `auth` work? | A request with real cookies or tokens to the mounted route. The harness authenticates clients by user id itself | the app's framework | [harness](references/harness.md) |
| Is my custom storage, server store, SQL driver or backend correct? | Conformance kits | `ferrysync/testing` | [conformance-and-simulator](references/conformance-and-simulator.md) |
| Does it converge under faults, many devices, restores? | `runSimulation`, `faultyTransport` | `ferrysync/testing` | [conformance-and-simulator](references/conformance-and-simulator.md) |

## Procedure for a test task

1. Read the project's test runner config (Vitest is what Ferry and its examples use) and an existing test, and copy its shape. If there is no test setup, ask before adding a runner.
2. Pick the row above. Import the app's real schema, so the test checks what ships.
3. Write the test through the public entry points a user would call. Await `sync.ready` (or use `harness.client`, which resolves ready). Close every client or harness at the end (`sync.close()`, `await harness.close()`): timers from one test must not run into the next.
4. Run it. **A bug fix gets a test that fails before the fix.** For a failing simulator seed, turn the seed into a regression test.
5. Run the project's full check. Report what ran and what did not.

## What an app's sync tests should cover

| Area | Cases |
| --- | --- |
| Sharing | A creates a shared row; B sees it only after `addMember`; B loses it after `removeMember`; a private row never reaches B |
| Rules | Every `validate` hook: the refused write rolls back on the client and `onRejected` gets your code and message |
| Conflicts | Two clients edit different fields (both survive) and the same field (the later applied wins); an edit of a deleted row is rejected |
| Offline | Writes while the backend is unreachable stay pending, survive a restart, and go out when it returns |
| Accounts | `connect({ upload: true })` uploads local rows; `reset(local())` leaves nothing of the previous user |
| Schema versions | Server `versions: { min: 1, max: 1 }` with a schema at `version: 2`: the client reaches `updateNeeded` and keeps its write pending (`harness.settle()` throws for such a client: advance a virtual clock and assert on `status`). The harness cannot change `versions` afterwards, so "syncs once the range includes it" needs a second harness |
| Hooks with effects | `afterCommit` fires once per applied change and never for a refused one |

## Do not

- Do not mock `createSync`, the server or a store. Do not stub `fetch` for sync: use the harness (the real HTTP protocol, in process).
- Do not use `setTimeout` sleeps. Use `harness.settle()` or a virtual clock (`await clock.advance(ms)`).
- Do not test `auth` with the harness's user ids: they bypass it. Test it against the real route.
- Do not leave a harness or client open.
- Do not lower coverage thresholds or delete a failing seed's test to go green.
- Do not run tests against a production database. Real Postgres only through a disposable URL the user provides.

## References

- [harness](references/harness.md): client tests, `createTestHarness`, virtual clock, components, restarts.
- [conformance-and-simulator](references/conformance-and-simulator.md): conformance kits, `runSimulation`, `faultyTransport`.
