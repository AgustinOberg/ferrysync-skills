# Fixture: broken-sync

Build it from the blank-app result of eval 1 (or any working Ferry app with a Hono server and a `projects`/`tasks` schema whose `projects` rows found a `project:<id>` space), then plant these three defects. Do not tell the agent what they are.

1. **Missing `claimSpace`.** Remove the `claimSpace` option from `createSyncServer`. Symptom: a project created on device A is rolled back after a second and never appears on device B. `onRejected` gets `forbidden`.
2. **Client `url` includes the endpoint.** Change the client to `http({ url: '/api/sync/push' })`. Symptom: requests go to `/api/sync/push/push` and answer `404 unknown_endpoint`; `status.phase` is `offline`.
3. **A hook that throws.** Add `tables: { tasks: { validate: ({ after }) => { if (after?.title === '') throw new Error('empty'); } } }`. Symptom: a task with an empty title keeps `pending` above zero forever and blocks that device's later writes.

The three symptoms appear one after the other, as each is fixed.
