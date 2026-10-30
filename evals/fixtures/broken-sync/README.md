# Fixture: broken-sync

Build it from the blank-app result of eval 1 (or any working Ferry app with a Hono server and a `projects`/`tasks` schema whose `projects` rows found a `project:<id>` space), then plant these three defects. Do not tell the agent what they are.

1. **Missing `claimSpace`.** Remove the `claimSpace` option from `createSyncServer`. Symptom: a project created on device A is rolled back after a second and never appears on device B. `onRejected` gets `forbidden`.
2. **Client `url` with a wrong prefix.** Change the client to `http({ url: '/api/syncs' })` while the server is mounted at `/api/sync`. Symptom: every request answers `404` and nothing reaches the server. Ferry routes by the last path segment, so a `url` that wrongly includes the endpoint (`/api/sync/push`) still works on a Hono catch-all mount and is not a defect there.
3. **A hook that throws.** Add `tables: { tasks: { validate: ({ after }) => { if (after?.title === '') throw new Error('empty'); } } }`. Symptom: a task with an empty title keeps `pending` above zero forever and blocks that device's later writes.

The three symptoms appear one after the other, as each is fixed.
