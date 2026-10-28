import { createSync, http, indexedDbStorage } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({
  schema,
  storage: indexedDbStorage('app'),
  backend: http({ url: '/api/sync' }),
});
