import { createSyncServer, memoryStore } from 'ferrysync/server';

import { schema } from './schema';

export const syncServer = createSyncServer({
  schema,
  store: memoryStore(),
  auth: async (request) => (await getSession(request))?.userId ?? null,
  claimSpace: ({ table, space, row }) => table === 'projects' && space === `project:${row.id}`,
});
