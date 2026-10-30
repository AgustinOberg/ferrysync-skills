# Migration checklist

Tick per phase. Do not start the next phase with an open item. Say plainly which items you could not check.

## Phase 0: assessment

- [ ] Every dataset classified: sync (private), sync (space), device-only, stays on the API
- [ ] Per-user volume fits in memory, with the worst user considered
- [ ] Nothing server-authoritative is marked sync
- [ ] Counters and appended lists modelled as rows
- [ ] Id plan per table; delete plan per table; NOT NULL columns without defaults listed
- [ ] Other writers listed (admin tools, jobs, triggers, other services, old app versions)
- [ ] `auth` yields a stable user id; sign-out and shared-device behavior decided
- [ ] Rules to port listed as `validate` hooks, invites or `addMember` calls
- [ ] The user approved the assessment

## Phase 1: Ferry beside the old backend

- [ ] Package exists and is installed on app and server
- [ ] Schema compiles; `spaces` match the assessment; table names are final (they are stored and sent)
- [ ] Table shape migration written as a script, run on a backed-up copy, with its DOWN migration ([cutover-and-rollback](cutover-and-rollback.md)); never run at server start
- [ ] Mirror declared with `fields`; `await store.ready()` passes
- [ ] Route mounted; curl gives 401 then 200
- [ ] Old app unchanged

## Phase 2: data and writers

- [ ] `backfill` ran per table; `rejected` is empty or explained
- [ ] Members loaded with `spaces.addMember`
- [ ] Every writer of a mirrored table calls `write` or `log`
- [ ] Counts match between the old table and Ferry
- [ ] Harness test over one server, legacy endpoints and Ferry clients: old endpoint write shows on a Ferry client, and the reverse ([recipe](adoption-code.md))
- [ ] On SQLite drivers: no old code writes a mirrored table itself (there is no `log`)
- [ ] Legacy reads filter `deleted_at IS NULL`; legacy writes moved to `write` are reviewed for the new role and `validate` checks

## Phase 3: client feature

- [ ] One client at module level; `SyncProvider` once
- [ ] Reads replaced by queries; writes by table calls; old optimistic code, loading states and offline queue deleted behind the flag
- [ ] `onRejected` shows a useful message
- [ ] Offline, restart and two-device checks pass
- [ ] Flag off still works

## Phase 4: cutover

- [ ] Staged rollout and monitoring in place; rollback owner named
- [ ] Old endpoints removed only when no supported version uses them
- [ ] Security review and production readiness run: [ferrysync-security-review](../../ferrysync-security-review/SKILL.md), [ferrysync-production-readiness](../../ferrysync-production-readiness/SKILL.md)
