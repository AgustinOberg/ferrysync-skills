# Web: Vite and React

Install (use the project's package manager):

```sh
bun add ferrysync zod react react-dom
```

## 1. Client on the device alone

```ts
// src/sync.ts
import { createSync, indexedDbStorage } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({ schema, storage: indexedDbStorage('app') });
```

## 2. Provider and a live list

`SyncProvider` shows its `fallback` once while the local data opens. `useQuery` re-renders only when what it read changes and never shows a loading state.

```tsx
// src/App.tsx
import { SyncProvider, useQuery } from 'ferrysync/react';

import { type Project } from './schema';
import { sync } from './sync';

const ProjectTasks = ({ project }: { project: Project }) => {
  const tasks = useQuery(sync.tasks.where({ projectId: project.id }));
  const add = () => sync.tasks.create({ projectId: project.id, title: `Task ${tasks.length + 1}` });
  return (
    <section>
      <h2>{project.name}</h2>
      {tasks.map((task) => (
        <label key={task.id}>
          <input
            type="checkbox"
            checked={task.done}
            onChange={() => sync.tasks.update(task.id, { done: !task.done })}
          />
          {task.title}
        </label>
      ))}
      <button onClick={add}>Add a task</button>
    </section>
  );
};

const Projects = () => {
  const projects = useQuery(sync.projects.all());
  return (
    <main>
      <button onClick={() => sync.projects.create({ name: `Project ${projects.length + 1}` })}>
        New project
      </button>
      {projects.map((project) => (
        <ProjectTasks key={project.id} project={project} />
      ))}
    </main>
  );
};

export const App = () => (
  <SyncProvider sync={sync} fallback={<p>Opening...</p>}>
    <Projects />
  </SyncProvider>
);
```

**Verify:** press New project, Add a task, reload the page: both are still there.

If the app is opened in a second tab, `SyncProvider` rethrows `StorageLockedError`. Put an error boundary above it, or use `indexedDbStorage('app', { onLocked: 'wait' })`: see [ferrysync-client](../../ferrysync-client/SKILL.md).

## 3. Connect to the server

Same-origin in development through the dev server's proxy, so there is no CORS and the long-poll `wait` goes through too:

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api/sync': 'http://localhost:3000' } },
});
```

```ts
// src/sync.ts
import { createSync, http, indexedDbStorage } from 'ferrysync';

import { schema } from './schema';

export const sync = createSync({
  schema,
  storage: indexedDbStorage('app'),
  // Cookies go with same-origin requests. For a bearer token, pass `headers`.
  backend: http({ url: '/api/sync' }),
});
```

With a token:

```ts
import { http } from 'ferrysync';

export const backend = http({
  url: '/api/sync',
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  onUnauthorized: () => showToast('Please sign in again'),
});
```

## 4. Show the sync state

```tsx
import { useSyncStatus } from 'ferrysync/react';

export const SaveIndicator = () => {
  const { synced, online, pending } = useSyncStatus();
  if (synced) return <span>Saved</span>;
  return <span>{online ? `Saving ${pending}...` : 'Offline: changes will sync later'}</span>;
};
```

Call `sync.syncNow()` when the browser says it is back online, to skip the backoff wait:

```ts
import { sync } from './sync';

window.addEventListener('online', () => void sync.syncNow());
```

Server rendering: `SyncProvider` renders its fallback on the server, because `sync.ready` never resolves there. Components that read Ferry must be client components.
