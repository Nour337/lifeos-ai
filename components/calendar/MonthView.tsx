"use client";

import { useDroppable } from "@dnd-kit/core";
import TaskChip from "@/components/calendar/TaskChip";
import { addDays, getWeekDays } from "@/utils/date";
import type { Task } from "@/types/task";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

export default function MonthView({
  anchor,
  today,
  tasksByDate,
  onOpenTask,
  onOpenDay,
}: {
  anchor: string; // any date in the month
  today: string;
  tasksByDate: Map<string, Task[]>;
  onOpenTask: (task: Task) => void;
  onOpenDay: (date: string) => void;
}) {
  const month = anchor.slice(0, 7);
  const firstOfMonth = `${month}-01`;
  const gridStart = getWeekDays(firstOfMonth)[0];
  // 6 rows always fit any month
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2 text-center text-xs font-medium text-muted">
            <span className="sm:hidden">{label[0]}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => (
          <DayCell
            key={date}
            date={date}
            inMonth={date.startsWith(month)}
            isToday={date === today}
            tasks={tasksByDate.get(date) ?? []}
            onOpenTask={onOpenTask}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  date,
  inMonth,
  isToday,
  tasks,
  onOpenTask,
  onOpenDay,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onOpenDay: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date|${date}` });
  const hidden = tasks.length - MAX_CHIPS;

  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpenDay(date)}
      className={`min-h-[76px] cursor-pointer border-b border-r border-line p-1 transition sm:min-h-[110px] sm:p-1.5 [&:nth-child(7n)]:border-r-0 ${
        isOver ? "bg-accent-soft" : inMonth ? "hover:bg-surface-2/60" : "bg-surface-2/40"
      }`}
    >
      <span
        className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
          isToday
            ? "bg-gradient-to-br from-grad-from to-grad-to text-white"
            : inMonth
              ? "text-ink"
              : "text-muted/60"
        }`}
      >
        {Number(date.slice(8))}
      </span>
      <div className="space-y-0.5">
        {tasks.slice(0, MAX_CHIPS).map((task) => (
          <TaskChip key={task.id} task={task} compact onOpen={onOpenTask} />
        ))}
        {hidden > 0 && (
          <p className="px-1 text-[10px] font-medium text-muted sm:text-xs">+{hidden} more</p>
        )}
      </div>
    </div>
  );
}
