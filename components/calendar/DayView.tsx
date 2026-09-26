"use client";

import { useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import TaskChip from "@/components/calendar/TaskChip";
import { minutesToTime, timeToMinutes } from "@/utils/date";
import type { Interval } from "@/lib/schedule";
import type { Task } from "@/types/task";

const HOUR_HEIGHT = 56; // px
const SLOT_MINUTES = 30;
const DEFAULT_MINUTES = 30;

type Placed = { task: Task; top: number; height: number; lane: number; lanes: number };

// Side-by-side lanes for overlapping tasks, like a calendar app
function layout(tasks: Task[]): Placed[] {
  const items = tasks
    .map((task) => {
      const start = timeToMinutes(task.due_time!);
      const end = task.end_time
        ? timeToMinutes(task.end_time)
        : start + (task.estimated_duration ?? DEFAULT_MINUTES);
      return { task, start, end: Math.max(end, start + 15) };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: Placed[] = [];
  let cluster: (typeof items[number] & { lane: number })[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) {
      placed.push({
        task: c.task,
        top: (c.start / 60) * HOUR_HEIGHT,
        height: Math.max(((c.end - c.start) / 60) * HOUR_HEIGHT, 26),
        lane: c.lane,
        lanes,
      });
    }
    cluster = [];
  };

  for (const item of items) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.end);
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return placed;
}

export default function DayView({
  date,
  isToday,
  tasks,
  busy = [],
  onOpenTask,
  onAdd,
}: {
  date: string;
  isToday: boolean;
  tasks: Task[];
  busy?: Interval[]; // work, university: shown as grey bands
  onOpenTask: (task: Task) => void;
  onAdd: (date: string, time?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timed = tasks.filter((t) => t.due_time);
  const untimed = tasks.filter((t) => !t.due_time);
  const placed = layout(timed);

  // Start scrolled to 07:00 (or the first task, if earlier)
  useEffect(() => {
    const first = timed.length ? Math.min(...timed.map((t) => timeToMinutes(t.due_time!))) : 7 * 60;
    scrollRef.current?.scrollTo({ top: (Math.min(first, 7 * 60) / 60) * HOUR_HEIGHT - 8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the day changes
  }, [date]);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="space-y-3">
      <AnytimeStrip date={date} tasks={untimed} onOpenTask={onOpenTask} />

      <div
        ref={scrollRef}
        className="relative max-h-[65dvh] overflow-y-auto rounded-2xl bg-surface shadow-card"
      >
        <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
          {/* Half-hour drop targets; tapping an empty one adds a task there */}
          {Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => (
            <Slot key={i} date={date} minutes={i * SLOT_MINUTES} onAdd={onAdd} />
          ))}

          {/* Fixed busy time (work, university) behind everything */}
          {busy.map((b) => (
            <div
              key={`${b.label}-${b.start}`}
              className="pointer-events-none absolute left-12 right-0 border-l-[3px] border-line bg-[repeating-linear-gradient(135deg,var(--surface-2),var(--surface-2)_6px,transparent_6px,transparent_12px)]"
              style={{ top: (b.start / 60) * HOUR_HEIGHT, height: ((b.end - b.start) / 60) * HOUR_HEIGHT }}
            >
              <span className="ml-2 text-[11px] font-semibold text-muted">
                🔒 {b.label} {minutesToTime(b.start)}–{b.end >= 1440 ? "24:00" : minutesToTime(b.end)}
              </span>
            </div>
          ))}

          {/* Hour labels */}
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              className="pointer-events-none absolute left-2 -translate-y-1/2 text-[11px] tabular-nums text-muted"
              style={{ top: h * HOUR_HEIGHT }}
            >
              {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
            </span>
          ))}

          {isToday && (
            <div
              className="pointer-events-none absolute left-12 right-0 z-10 flex items-center"
              style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
            >
              <span className="-ml-1 h-2 w-2 rounded-full bg-danger" />
              <span className="h-px flex-1 bg-danger" />
            </div>
          )}

          {/* Pass clicks through to the slots; only the chips catch them */}
          <div className="pointer-events-none absolute inset-y-0 left-14 right-2">
            {placed.map(({ task, top, height, lane, lanes }) => (
              <TaskChip
                key={task.id}
                task={task}
                onOpen={onOpenTask}
                className="pointer-events-auto absolute shadow-sm"
                style={{
                  top: top + 1,
                  height: height - 2,
                  left: `${(lane / lanes) * 100}%`,
                  width: `calc(${100 / lanes}% - 4px)`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Slot({
  date,
  minutes,
  onAdd,
}: {
  date: string;
  minutes: number;
  onAdd: (date: string, time?: string) => void;
}) {
  const time = minutesToTime(minutes);
  const { setNodeRef, isOver } = useDroppable({ id: `slot|${date}|${time}` });
  return (
    <div
      ref={setNodeRef}
      onClick={() => onAdd(date, time)}
      className={`absolute left-12 right-0 cursor-pointer ${
        minutes % 60 === 0 ? "border-t border-line" : "border-t border-dashed border-line/50"
      } ${isOver ? "bg-accent-soft" : "hover:bg-surface-2/50"}`}
      style={{ top: (minutes / 60) * HOUR_HEIGHT, height: (SLOT_MINUTES / 60) * HOUR_HEIGHT }}
    >
      {isOver && <span className="ml-2 text-xs font-semibold text-accent">{time}</span>}
    </div>
  );
}

function AnytimeStrip({
  date,
  tasks,
  onOpenTask,
}: {
  date: string;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  // Dropping here removes the time and keeps the date
  const { setNodeRef, isOver } = useDroppable({ id: `slot|${date}|none` });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl p-3 shadow-card transition ${isOver ? "bg-accent-soft ring-2 ring-accent/40" : "bg-surface"}`}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Anytime</p>
      {tasks.length === 0 ? (
        <p className="text-xs text-muted/70">Tasks without a time. Drag here to remove a time.</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {tasks.map((task) => (
            <TaskChip key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </div>
      )}
    </div>
  );
}
