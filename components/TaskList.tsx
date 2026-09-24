"use client";

import {
  CalendarIcon,
  CheckIcon,
  FolderIcon,
  RepeatIcon,
  TrashIcon,
} from "@/components/icons";
import {
  describeDue,
  formatDuration,
  formatTime,
  toLocalDateString,
  type DueTone,
} from "@/utils/date";
import { isOpen, type Task } from "@/types/task";

// Left edge color: green when done, otherwise by priority
const edgeColors: Record<string, string> = {
  high: "border-l-danger",
  medium: "border-l-warn",
  low: "border-l-accent",
};

const dueStyles: Record<DueTone, string> = {
  overdue: "text-danger font-medium",
  today: "text-accent font-medium",
  soon: "text-ink",
  later: "text-muted",
};

type TaskActions = {
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
};

export default function TaskList({
  tasks,
  projectNames = {},
  ...actions
}: {
  tasks: Task[];
  projectNames?: Record<string, string>;
} & TaskActions) {
  return (
    <ul className="space-y-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          projectName={task.project_id ? projectNames[task.project_id] : undefined}
          {...actions}
        />
      ))}
    </ul>
  );
}

export function TaskCard({
  task,
  projectName,
  showDate = true,
  onEditTask,
  onDeleteTask,
  onToggleStatus,
}: {
  task: Task;
  projectName?: string;
  showDate?: boolean;
} & TaskActions) {
  const done = task.status === "done";
  const skipped = task.status === "skipped";
  const open = isOpen(task);
  const due =
    showDate && task.due_date ? describeDue(task.due_date, toLocalDateString()) : null;

  // "06:30–08:00 • 1h 30m" like a calendar entry
  const timeRange = task.due_time
    ? formatTime(task.due_time) + (task.end_time ? `–${formatTime(task.end_time)}` : "")
    : null;
  const timeLine = [
    timeRange,
    task.estimated_duration ? formatDuration(task.estimated_duration) : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const showProgress = open && task.progress > 0;

  return (
    <li
      className={`group flex items-center gap-3 rounded-2xl border-l-4 bg-surface py-3.5 pl-4 pr-2 shadow-card transition ${
        done
          ? "border-l-ok"
          : skipped
            ? "border-l-line opacity-60"
            : (edgeColors[task.priority] ?? "border-l-accent")
      }`}
    >
      <TaskCheckbox
        done={done}
        title={task.title}
        onToggle={() => onToggleStatus(task)}
      />

      <button onClick={() => onEditTask(task)} className="min-w-0 flex-1 text-left">
        <p
          className={`truncate text-[15px] font-semibold ${
            !open ? "text-muted line-through decoration-muted/60" : "text-ink"
          }`}
        >
          {task.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted">
          {timeLine && <span>{timeLine}</span>}
          {skipped && <span className="font-medium">Skipped</span>}
          {task.status === "rescheduled" && (
            <span className="rounded-full bg-warn-soft px-2 py-px text-xs font-medium text-warn">
              Rescheduled
            </span>
          )}
          {due && open && (
            <span className={`flex items-center gap-1 ${dueStyles[due.tone]}`}>
              <CalendarIcon className="h-3.5 w-3.5" />
              {due.label}
            </span>
          )}
          {task.status === "in_progress" && (
            <span className="font-medium text-accent">In progress</span>
          )}
          {task.repeat && (
            <span className="flex items-center gap-1 capitalize">
              <RepeatIcon className="h-3.5 w-3.5" />
              {task.repeat}
            </span>
          )}
          {projectName && (
            <span className="flex items-center gap-1">
              <FolderIcon className="h-3.5 w-3.5" />
              {projectName}
            </span>
          )}
          {task.category && (
            <span className="rounded-full bg-surface-2 px-2 py-px text-xs">
              {task.category}
            </span>
          )}
          {!timeLine && !due && !task.category && !projectName && !task.repeat && (
            <span className="capitalize">{task.priority} priority</span>
          )}
        </div>
        {showProgress && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-grad-from to-grad-to"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted">{task.progress}%</span>
          </div>
        )}
      </button>

      <button
        onClick={() => onDeleteTask(task)}
        className="rounded-lg p-2 text-muted/60 transition hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
        aria-label={`Delete "${task.title}"`}
      >
        <TrashIcon className="h-[18px] w-[18px]" />
      </button>
    </li>
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
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90 ${
        done
          ? "border-ok bg-ok text-white"
          : "border-line text-transparent hover:border-accent hover:text-accent/50"
      }`}
    >
      <CheckIcon className="h-3.5 w-3.5" />
    </button>
  );
}
