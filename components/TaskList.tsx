"use client";

import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  FolderIcon,
  RepeatIcon,
  TrashIcon,
} from "@/components/icons";
import {
  describeDue,
  formatDuration,
  toLocalDateString,
  type DueTone,
} from "@/utils/date";
import type { Task } from "@/types/task";

const priorityStyles: Record<string, { dot: string; label: string }> = {
  high: { dot: "bg-danger", label: "High" },
  medium: { dot: "bg-warn", label: "Medium" },
  low: { dot: "bg-muted/50", label: "Low" },
};

const dueStyles: Record<DueTone, string> = {
  overdue: "text-danger",
  today: "text-accent font-medium",
  soon: "text-ink",
  later: "text-muted",
};

export default function TaskList({
  tasks,
  projectNames = {},
  onEditTask,
  onDeleteTask,
  onToggleStatus,
}: {
  tasks: Task[];
  projectNames?: Record<string, string>;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
}) {
  const today = toLocalDateString();

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {tasks.map((task) => {
        const done = task.status === "done";
        const priority = priorityStyles[task.priority] ?? priorityStyles.low;
        const due = task.due_date ? describeDue(task.due_date, today) : null;
        const projectName = task.project_id ? projectNames[task.project_id] : null;

        return (
          <li
            key={task.id}
            className="group flex items-start gap-3 px-4 py-3.5 transition hover:bg-surface-2/60"
          >
            <TaskCheckbox
              done={done}
              title={task.title}
              onToggle={() => onToggleStatus(task)}
            />

            <button
              onClick={() => onEditTask(task)}
              className="min-w-0 flex-1 text-left"
            >
              <p
                className={`text-[15px] leading-snug ${
                  done ? "text-muted line-through" : "text-ink"
                }`}
              >
                {task.title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${priority.dot}`} />
                  {priority.label}
                </span>
                {task.status === "in_progress" && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                    In progress
                  </span>
                )}
                {due && !done && (
                  <span className={`flex items-center gap-1 ${dueStyles[due.tone]}`}>
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {due.label}
                  </span>
                )}
                {task.repeat && (
                  <span className="flex items-center gap-1 capitalize">
                    <RepeatIcon className="h-3.5 w-3.5" />
                    {task.repeat}
                  </span>
                )}
                {task.estimated_duration && (
                  <span className="flex items-center gap-1">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {formatDuration(task.estimated_duration)}
                  </span>
                )}
                {projectName && (
                  <span className="flex items-center gap-1">
                    <FolderIcon className="h-3.5 w-3.5" />
                    {projectName}
                  </span>
                )}
                {task.category && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5">
                    {task.category}
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => onDeleteTask(task)}
              className="-mr-1 rounded-lg p-1.5 text-muted opacity-60 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
              aria-label={`Delete "${task.title}"`}
            >
              <TrashIcon className="h-[18px] w-[18px]" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TaskCheckbox({
  done,
  title,
  onToggle,
}: {
  done: boolean;
  title: string;
  onToggle: () => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={done}
      aria-label={`Mark "${title}" ${done ? "not done" : "done"}`}
      onClick={onToggle}
      className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition ${
        done
          ? "border-ok bg-ok text-white"
          : "border-line text-transparent hover:border-accent hover:text-accent/40"
      }`}
    >
      <CheckIcon className="h-3.5 w-3.5" />
    </button>
  );
}
