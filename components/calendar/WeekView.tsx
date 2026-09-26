"use client";

import { useDroppable } from "@dnd-kit/core";
import TaskChip from "@/components/calendar/TaskChip";
import { PlusIcon } from "@/components/icons";
import { getWeekDays, minutesToTime } from "@/utils/date";
import type { Interval } from "@/lib/schedule";
import type { Task } from "@/types/task";

// Seven day columns on wide screens, stacked days on phones. Drag a task to
// another day to move it (its time stays the same).
export default function WeekView({
  anchor,
  today,
  tasksByDate,
  busyFor,
  onOpenTask,
  onOpenDay,
  onAdd,
}: {
  anchor: string;
  today: string;
  tasksByDate: Map<string, Task[]>;
  busyFor?: (date: string) => Interval[]; // work, university
  onOpenTask: (task: Task) => void;
  onOpenDay: (date: string) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-7">
      {getWeekDays(anchor).map((date) => (
        <DayColumn
          key={date}
          date={date}
          isToday={date === today}
          tasks={tasksByDate.get(date) ?? []}
          busy={busyFor?.(date) ?? []}
          onOpenTask={onOpenTask}
          onOpenDay={onOpenDay}
          onAdd={onAdd}
        />
      ))}
    </div>
  );
}

function DayColumn({
  date,
  isToday,
  tasks,
  busy,
  onOpenTask,
  onOpenDay,
  onAdd,
}: {
  date: string;
  isToday: boolean;
  tasks: Task[];
  busy: Interval[];
  onOpenTask: (task: Task) => void;
  onOpenDay: (date: string) => void;
  onAdd: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date|${date}` });
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-2xl p-2 shadow-card transition sm:min-h-[340px] ${
        isOver ? "bg-accent-soft ring-2 ring-accent/40" : "bg-surface"
      }`}
    >
      <div className="mb-2 flex items-center justify-between sm:flex-col sm:items-stretch sm:gap-1">
        <button onClick={() => onOpenDay(date)} className="flex items-center gap-2 sm:flex-col sm:gap-0.5">
          <span className="text-xs font-medium text-muted">{weekday}</span>
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
              isToday ? "bg-gradient-to-br from-grad-from to-grad-to text-white" : "text-ink"
            }`}
          >
            {d}
          </span>
        </button>
        <button
          onClick={() => onAdd(date)}
          aria-label={`Add task on ${date}`}
          className="flex h-7 w-7 items-center justify-center self-center rounded-full text-muted hover:bg-accent-soft hover:text-accent"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-1.5">
        {busy.map((b) => (
          <p
            key={`${b.label}-${b.start}`}
            className="truncate rounded-md border border-dashed border-line px-2 py-1 text-[11px] text-muted"
            title={`${b.label} (busy)`}
          >
            🔒 {minutesToTime(b.start)}–{b.end >= 1440 ? "24:00" : minutesToTime(b.end)} {b.label}
          </p>
        ))}
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} onOpen={onOpenTask} />
        ))}
        {tasks.length === 0 && (
          <p className="py-1 text-center text-xs text-muted/60 sm:py-4">No tasks</p>
        )}
      </div>
    </div>
  );
}
