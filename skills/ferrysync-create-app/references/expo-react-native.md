# Expo and React Native

Install with the Expo CLI so versions match the SDK:

```sh
bunx expo install expo-sqlite
bun add ferrysync zod
```

No native code of its own, nothing to polyfill: Ferry runs on Hermes. Ids need no polyfill (without Web Crypto the random part uses `Math.random`, which is enough for ids).

## 1. Client on the device alone

```ts
// src/sync.ts
import { createSync, sqliteStorage } from 'ferrysync';
import { openDatabaseSync } from 'expo-sqlite';

import { schema } from './schema';

export const sync = createSync({ schema, storage: sqliteStorage(openDatabaseSync('app.db')) });
```

The database must be a file. It creates `sync_records`, `sync_outbox`, `sync_meta` (and a version table): keep the app's own tables out of those names, or pass `{ prefix }`. For op-sqlite use `opSqliteStorage(open({ name: 'app.db' }))`; for MMKV, `mmkvStorage(createMMKV({ id: 'sync' }))` with an instance of its own.

## 2. Provider and a live list

```tsx no-check
// src/TasksApp.tsx
// no-check: react-native components are not compiled by this repo's checker; the hooks are the
// same as in web-vite-react.md.
import { SyncProvider, useQuery } from 'ferrysync/react';
import { Button, Switch, Text, View } from 'react-native';

import { type Project } from './schema';
import { sync } from './sync';

const ProjectTasks = ({ project }: { project: Project }) => {
  const tasks = useQuery(sync.tasks.where({ projectId: project.id }));
  return (
    <View>
      <Text>{project.name}</Text>
      {tasks.map((task) => (
        <View key={task.id} style={{ flexDirection: 'row' }}>
          <Switch
            value={task.done}
            onValueChange={() => sync.tasks.update(task.id, { done: !task.done })}
          />
          <Text>{task.title}</Text>
        </View>
      ))}
      <Button
        title="Add a task"
        onPress={() => sync.tasks.create({ projectId: project.id, title: `Task ${tasks.length + 1}` })}
      />
    </View>
  );
};

const Projects = () => {
  const projects = useQuery(sync.projects.all());
  return (
    <View>
      <Button
        title="New project"
        onPress={() => sync.projects.create({ name: `Project ${projects.length + 1}` })}
      />
      {projects.map((project) => (
        <ProjectTasks key={project.id} project={project} />
      ))}
    </View>
  );
};

export const TasksApp = () => (
  <SyncProvider sync={sync} fallback={<Text>Opening...</Text>}>
    <Projects />
  </SyncProvider>
);
```

**Verify:** run the app (use the Argent tools or the simulator the project already uses), add a project and a task, kill and reopen the app: both persist.

## 3. Connect to the server

A device has no origin: give the full URL of the backend.

```ts
// src/sync.ts
import { createSync, http, sqliteStorage } from 'ferrysync';
import { openDatabaseSync } from 'expo-sqlite';

import { schema } from './schema';

export const sync = createSync({
  schema,
  storage: sqliteStorage(openDatabaseSync('app.db')),
  backend: http({
    url: 'https://api.example.com/api/sync',
    headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  }),
});
```

| Where the server runs | Use as the host in `url` |
| --- | --- |
| iOS simulator, server on the same Mac | `http://localhost:<port>` |
| Android emulator | `http://10.0.2.2:<port>` |
| A real phone | The computer's LAN address, `http://192.168.x.y:<port>` (and allow cleartext HTTP in dev builds) |

Native apps send no CORS preflight.

## 4. Foreground sync

The OS pauses the network in the background. Sync when the app comes back:

```ts
import { AppState } from 'react-native';

import { sync } from './sync';

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void sync.syncNow();
  }
});
```

## Gotchas

- Keep the client in `sync.ts`. Fast Refresh re-runs an edited module, and a second client over the same storage is trouble: reload the app after editing that module.
- `useQuery` with a predicate needs the factory form: `useQuery(() => sync.tasks.where((t) => ...), [deps])`.
- expo-sqlite on web has no exclusive transactions: see `docs/client/storages.md` for the driver to pass.
