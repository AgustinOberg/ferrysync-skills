# Queries, transactions and undo

## Queries

A query reads the rows of one table that match, in order, from memory on the device: no loading state, no network, works offline. No joins: read the project, then query its tasks.

```ts
import { sync } from './sync';

const open = sync.tasks.where({ projectId, done: false }).orderBy('title').limit(50);

open.get(); // the current result: a frozen array
const stop = open.subscribe((tasks) => render(tasks)); // each new result, not the current one
stop();

sync.tasks.where((task) => task.title.includes(search)); // any predicate
sync.tasks.where({ projectId }).where((task) => task.notes !== null); // chained: AND
sync.tasks.where({ title: { in: ['Visa', 'Hotel'] } });
sync.tasks.where({ projectId, done: { not: true } });
sync.tasks.where({ title: { gte: 'A', lt: 'M' } });
sync.tasks.where({ notes: { not: null } });
sync.tasks.all().orderBy('done').orderBy('title', 'desc');
sync.tasks.all().orderBy('title', 'asc', { locale: 'en', options: { numeric: true } });
sync.projects.where({ name: 'Japan' }).first(); // a query of one row, or null
```

| Fact | Detail |
| --- | --- |
| Object filter | Field equalities; arrays and objects compare by content; an `undefined` field is ignored, so optional filters pass as they are: `where({ projectId, done: showDone ? undefined : false })` |
| Operators | `eq`, `not`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`. Comparisons exist only on number and string fields, typed per field. `null` and absent are different values. Deleted rows are in no result |
| OR | Use a predicate |
| Order | Without `orderBy`, rows come by id: creation order (UUIDv7). Strings compare by code unit unless you pass a collation. Two devices can order the same strings differently with a locale: pass a fixed one when it must match |
| `get()` identity | The same array until the table changes in a way that changes the result; unchanged rows keep their objects |
| Interning | Queries made only of object filters, orders and limits are the same object every time they are written: write them inline. A predicate query is new on every call: build it once, or in React use the factory form with deps |
| Cost | A query recomputes when its table changes, by scanning it. Thousands of rows are fine; for a hot path over a huge table, keep a narrower query |

## Transactions

All or nothing, synced together, one undo step, reads its own writes. The callback must be synchronous.

```ts
import { sync } from './sync';

const project = sync.transaction((tx) => {
  const created = tx.projects.create({ name: 'Japan' });
  tx.tasks.create({ projectId: created.id, title: 'Visa' });
  tx.tasks.create({ projectId: created.id, title: 'Flights' });
  return created;
});

sync.transaction(
  (tx) => {
    for (const task of tx.tasks.all()) {
      if (task.projectId === project.id && task.done) {
        tx.tasks.delete(task.id);
      }
    }
  },
  { undoable: false, name: 'tasks.clear-done' },
);

// Await first, then write: an async callback throws.
const weather = await fetchWeather();
sync.transaction((tx) => {
  tx.projects.create({ name: `Japan (${weather})` });
});
```

`name` is what server hooks see (default `transaction.v<n>`; single writes are `tasks.create.v1`, `tasks.update.v1`, `tasks.delete.v1`; an undo is the name plus `.undo`). A transaction that writes nothing sends nothing and adds no undo step. On the server a transaction is applied whole or refused whole.

## Undo and redo

```ts
import { sync } from './sync';

sync.tasks.update(taskId, { done: true });
sync.canUndo(); // true
sync.undo(); // true: the task is not done any more
sync.redo(); // true: done again
sync.tasks.update(taskId, { done: true }, { undoable: false }); // a write the user did not make
```

- An undo is a new write, stored and synced like any other. It writes back only the fields the step changed; a later change to the same field from elsewhere is overwritten (last writer wins).
- The history is per device and survives a restart (stored in the client's storage): last 100 steps by default. Options: `createSync({ undo: { limit, persist } })`; `limit: 0` turns undo off; `persist: false` keeps it in memory, which also clears what an earlier run stored (deleted rows stay on the device inside the history until the step is forgotten).
- What leaves the history: a rejected write, the steps of a space the user loses, everything on `connect` and `reset`, a schema version change.
- Undo skips what it cannot revert and goes to the step before; `undo()` returns `false` only when the history is empty. It never brings back what another device deleted; undoing the user's own delete restores the row, on the server too.

## Modelling for last writer wins

Per field, the last write the server applies wins; different fields both survive. Updates carry only the fields that changed.

| Data | Model |
| --- | --- |
| A counter two devices increment | One row per increment, count the rows |
| A list two people append to | One row per item, not an array in one field |
| Long text edited together | Not Ferry's job: a CRDT for that field |
| A flag or title | A field |
