# Schema evolution

Clients and the server run different schema versions for a while: app store reviews, users who never update. Four numbers exist (package version, the schema's `version`, `schemaVersion` on the wire, the store's layout version); only the schema's `version` is yours to change.

## Decide

| Change | Compatible? | Do |
| --- | --- | --- |
| Add a field with `.default(x)`, `.optional()` or `.nullable()` | Yes | Nothing else. Old rows stay valid; older clients ignore the new field |
| Add a table | Yes | Add it, with its space function. Older clients do not know it |
| Make a field optional or nullable | Usually yes | Check older clients still validate what they write |
| Rename a field or a table | No | Bump `version`; do not rename in place |
| Change a field's type, tighten a validation | No | Bump `version` |
| Remove a field | Treat as breaking | Keep it (nullable) until old versions are gone |
| Change a space function | Careful | Rows move spaces: the writer must belong to both; members of the old space see the row deleted, members of the new see it created |

Defaults run at `create`. A default added later does not rewrite stored rows: the schema fills it in each time it reads an old row.

## A breaking change, step by step

```ts
import { defineSchema } from 'ferrysync';
import { z } from 'zod';

export const schema = defineSchema(
  { tasks: z.object({ id: z.string(), title: z.string(), dueAt: z.number().nullable() }) },
  { version: 2 },
);
```

1. Bump `version` in the shared schema file.
2. Deploy the server with `versions: { min: 1, max: 2 }` (max defaults to `schema.version`). The server must go first: a client newer than `max` is refused too.
3. Release the app. A refused client keeps working offline, queues writes, reports phase `'updateNeeded'` and calls `onUpdateNeeded`; once updated, queued writes go out. `syncNow()` retries.
4. When few old clients remain, raise `min` to 2. It is the only step that turns anyone away: do it last, and tell the user which versions it will lock out.

```ts
import { createSync } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({
  schema,
  onUpdateNeeded: (message) => promptToUpdate(message ?? 'Please update the app to keep syncing.'),
});
```

## What happens to old data

Rows and queued transactions written under an older schema outlive the upgrade. A row that no longer fits the model is skipped and reported through `onInvalidRow` (`{ model, id, source: 'storage' | 'network', issues }`); a queued transaction whose result fails is rejected `invalid`. Keep changes additive so neither happens. The undo history is cleared after an update that changes the schema version.

## Rules that always hold

- Table names are stored and sent: treat them as stable.
- A schema must accept its own output.
- Mistakes throw at startup: an unknown table in `spaces` or `localOnly`, a local-only table with a space, a reserved name.
- Rolling back a `ferrysync` release is not supported once a newer one upgraded the store's tables.
