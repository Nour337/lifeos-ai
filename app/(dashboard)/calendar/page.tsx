"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAuth } from "@/lib/AuthContext";
import { getTasks, moveTask } from "@/lib/queries/tasks";
import { useQuickAdd, useTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import TaskForm from "@/components/TaskForm";
import MonthView from "@/components/calendar/MonthView";
import WeekView from "@/components/calendar/WeekView";
import DayView from "@/components/calendar/DayView";
import { ChipContent, chipClass } from "@/components/calendar/TaskChip";
import { ErrorState, Modal, Skeleton } from "@/components/ui";
import { addDays, formatDate, getWeekDays, toLocalDateString } from "@/utils/date";
import type { Task } from "@/types/task";

type View = "day" | "week" | "month";

function shiftMonth(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  return toLocalDateString(new Date(y, m - 1 + months, 1));
}

function title(view: View, anchor: string): string {
  const [y, m, d] = anchor.split("-").map(Number);
  if (view === "month") {
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (view === "week") {
    const days = getWeekDays(anchor);
    return `${formatDate(days[0])} – ${formatDate(days[6])}`;
  }
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function CalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const openQuickAdd = useQuickAdd();
  const today = toLocalDateString();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);

  const refresh = useCallback(() => {
    getTasks()
      .then((data) => {
        setTasks(data);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  useTasksChanged(refresh);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.due_date) continue;
      map.set(task.due_date, [...(map.get(task.due_date) ?? []), task]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
    }
    return map;
  }, [tasks]);

  // Mouse: drag after moving 5px. Touch: press and hold briefly, so normal
  // swiping still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDragging((event.active.data.current?.task as Task) ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragging(null);
    const task = event.active.data.current?.task as Task | undefined;
    const target = event.over?.id ? String(event.over.id) : null;
    if (!task || !target) return;

    // "date|2026-09-24" keeps the time; "slot|2026-09-24|09:30" (or "|none") sets it
    const [kind, date, slotTime] = target.split("|");
    const time = kind === "slot" ? (slotTime === "none" ? null : slotTime) : undefined;
    const sameTime = time === undefined || time === (task.due_time?.slice(0, 5) ?? null);
    if (date === task.due_date && sameTime) return;

    const previous = tasks;
    // Move it on screen right away, then save
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, due_date: date, ...(time !== undefined && { due_time: time, end_time: time ? t.end_time : null }) }
          : t
      )
    );
    const saved = await moveTask(task, date, time);
    if (!saved) {
      setTasks(previous);
      toast("Couldn't move the task. Try again.", { tone: "error" });
      return;
    }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...saved } : t)));
    toast(
      `Moved “${task.title}” to ${formatDate(date)}${time ? ` at ${time}` : ""}`,
      {
        action: {
          label: "Undo",
          onClick: async () => {
            const undone = await moveTask(
              { ...task, ...saved } as Task,
              task.due_date!,
              task.due_time ? task.due_time.slice(0, 5) : null
            );
            if (!undone) toast("Couldn't undo.", { tone: "error" });
            refresh();
          },
        },
      }
    );
  };

  const step = (direction: 1 | -1) => {
    setAnchor((a) =>
      view === "month" ? shiftMonth(a, direction) : addDays(a, direction * (view === "week" ? 7 : 1))
    );
  };

  const openDay = (date: string) => {
    setAnchor(date);
    setView("day");
  };

  const unscheduled = tasks.filter((t) => !t.due_date && t.status !== "done" && t.status !== "skipped");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Calendar</h1>
        <div className="flex rounded-xl bg-surface p-1 shadow-card" role="tablist">
          {(["day", "week", "month"] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium capitalize transition ${
                view === v ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <NavButton label="Previous" onClick={() => step(-1)} d="M15 18l-6-6 6-6" />
        <NavButton label="Next" onClick={() => step(1)} d="M9 6l6 6-6 6" />
        <p className="min-w-0 flex-1 truncate font-semibold text-ink">{title(view, anchor)}</p>
        {anchor !== today && (
          <button
            onClick={() => setAnchor(today)}
            className="rounded-xl bg-surface px-3 py-1.5 text-sm font-medium text-accent shadow-card"
          >
            Today
          </button>
        )}
      </div>

      {!loaded ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refresh} />
      ) : (
        <DndContext
          id="calendar-dnd" // stable ids for server and browser renders
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          {view === "month" && (
            <MonthView
              anchor={anchor}
              today={today}
              tasksByDate={tasksByDate}
              onOpenTask={setEditing}
              onOpenDay={openDay}
            />
          )}
          {view === "week" && (
            <WeekView
              anchor={anchor}
              today={today}
              tasksByDate={tasksByDate}
              onOpenTask={setEditing}
              onOpenDay={openDay}
              onAdd={(date) => openQuickAdd({ dueDate: date })}
            />
          )}
          {view === "day" && (
            <DayView
              date={anchor}
              isToday={anchor === today}
              tasks={tasksByDate.get(anchor) ?? []}
              onOpenTask={setEditing}
              onAdd={(date, time) => openQuickAdd({ dueDate: date, dueTime: time })}
            />
          )}

          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div
                className={`w-44 rotate-2 rounded-md border-l-[3px] px-2 py-1.5 text-sm shadow-xl ${chipClass(dragging)}`}
              >
                <ChipContent task={dragging} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {loaded && !loadError && (
        <p className="text-center text-xs text-muted">
          Drag a task to move it{view === "day" ? " to another time" : " to another day"}. On a phone, press and hold first.
          {unscheduled.length > 0 && ` ${unscheduled.length} open task${unscheduled.length > 1 ? "s have" : " has"} no date.`}
        </p>
      )}

      <Modal open={editing !== null} title="Edit task" onClose={() => setEditing(null)}>
        {editing && (
          <TaskForm
            editingTask={editing}
            onTaskSaved={() => {
              setEditing(null);
              refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function NavButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-ink shadow-card hover:text-accent"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}
