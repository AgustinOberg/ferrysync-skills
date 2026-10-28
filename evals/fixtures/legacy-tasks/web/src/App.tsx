import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Task = { id: number; project_id: number; title: string; done: 0 | 1 };

const token = () => localStorage.getItem('token') ?? '';
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
};

const Tasks = ({ projectId }: { projectId: number }) => {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ['tasks', projectId], queryFn: () => api<Task[]>(`/projects/${projectId}/tasks`) });
  const toggle = useMutation({
    mutationFn: (task: Task) => api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ done: !task.done }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }),
  });
  if (tasks.isPending) return <p>Loading...</p>;
  if (tasks.isError) return <p>Could not load tasks. Are you offline?</p>;
  return (
    <ul>
      {tasks.data.map((task) => (
        <li key={task.id} onClick={() => toggle.mutate(task)}>
          {task.done ? 'done' : 'open'}: {task.title}
        </li>
      ))}
    </ul>
  );
};

const client = new QueryClient();
export const App = () => (
  <QueryClientProvider client={client}>
    <Tasks projectId={1} />
  </QueryClientProvider>
);
