"use client";

import { useDraggable } from "@dnd-kit/core";
import { formatTime } from "@/utils/date";
import { isOpen, type Task } from "@/types/task";

export const chipColors: Record<string, string> = {
  high: "border-l-danger bg-danger-soft",
  medium: "border-l-warn bg-warn-soft",
  low: "border-l-accent bg-accent-soft",
};

export function chipClass(task: Task): string {
  if (task.status === "done") return "border-l-ok bg-ok-soft";
  if (task.status === "skipped") return "border-l-line bg-surface-2 opacity-60";
  return chipColors[task.priority] ?? chipColors.low;
}

// A task you can drag to another day or time. Tapping it opens the editor.
export default function TaskChip({
  task,
  compact = false,
  onOpen,
  className = "",
  style,
}: {
  task: Task;
  compact?: boolean;
  onOpen: (task: Task) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(task);
      }}
      style={style}
      className={`block w-full touch-manipulation overflow-hidden rounded-md border-l-[3px] text-left transition ${chipClass(task)} ${
        isDragging ? "opacity-30" : ""
      } ${compact ? "px-1 py-0.5 text-[10px] leading-tight sm:text-xs" : "px-2 py-1.5 text-xs sm:text-sm"} ${className}`}
    >
      <ChipContent task={task} compact={compact} />
    </button>
  );
}

export function ChipContent({ task, compact }: { task: Task; compact?: boolean }) {
  const open = isOpen(task);
  return (
    <>
      {!compact && task.due_time && (
        <span className="block text-[11px] font-medium text-muted">
          {formatTime(task.due_time)}
          {task.end_time && `–${formatTime(task.end_time)}`}
        </span>
      )}
      <span className={`block truncate font-medium ${open ? "text-ink" : "text-muted line-through"}`}>
        {compact && task.due_time && (
          <span className="mr-1 hidden font-normal text-muted sm:inline">{formatTime(task.due_time)}</span>
        )}
        {task.title}
      </span>
    </>
  );
}
