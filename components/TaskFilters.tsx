"use client";

export type TaskFilterState = {
  status: string;
  priority: string;
  search: string;
};

export default function TaskFilters({
  filters,
  onChange,
}: {
  filters: TaskFilterState;
  onChange: (filters: TaskFilterState) => void;
}) {
  return (
    <div className="flex w-full max-w-2xl flex-wrap gap-3">
      <input
        type="text"
        placeholder="Search tasks..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />

      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      >
        <option value="all">All statuses</option>
        <option value="todo">To Do</option>
        <option value="in_progress">In Progress</option>
        <option value="done">Done</option>
      </select>

      <select
        value={filters.priority}
        onChange={(e) => onChange({ ...filters, priority: e.target.value })}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      >
        <option value="all">All priorities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </div>
  );
}