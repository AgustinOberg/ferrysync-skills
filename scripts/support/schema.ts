import { defineSchema } from 'ferrysync';
import { z } from 'zod';

export const schema = defineSchema(
  {
    projects: z.object({ id: z.string(), name: z.string() }),
    tasks: z.object({
      id: z.string(),
      projectId: z.string(),
      title: z.string(),
      done: z.boolean().default(false),
    }),
    drafts: z.object({ id: z.string(), text: z.string() }),
  },
  {
    spaces: {
      projects: (project) => `project:${project.id}`,
      tasks: (task) => `project:${task.projectId}`,
    },
    localOnly: ['drafts'],
  },
);

export type Project = typeof schema.$infer.projects;
export type Task = typeof schema.$infer.tasks;
