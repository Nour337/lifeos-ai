import type { Task } from "@/types/task";

const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const statusLabels: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export default function TaskList({
  tasks,
  onEditTask,
  onDeleteTask,
}: {
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <p className="p-8 text-center text-zinc-500 dark:text-zinc-400">
        No tasks yet. Add one to get started.
      </p>
    );
  }

  return (
    <ul className="w-full max-w-2xl space-y-3">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div
            onClick={() => onEditTask(task)}
            className="flex-1 cursor-pointer"
          >
            <p className="font-medium text-black dark:text-white">
              {task.title}
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {statusLabels[task.status] ?? task.status}
              {task.due_date && ` · Due ${task.due_date}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                priorityColors[task.priority] ?? priorityColors.low
              }`}
            >
              {task.priority}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${task.title}"?`)) {
                  onDeleteTask(task.id);
                }
              }}
              className="rounded-md px-2 py-1 text-sm text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}