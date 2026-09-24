"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { getTasks } from "@/lib/queries/tasks";
import { getGoals } from "@/lib/queries/goals";
import { getProjects } from "@/lib/queries/projects";
import { getDisplayName } from "@/lib/queries/profiles";
import { useTaskActions } from "@/lib/useTaskActions";
import { useQuickAdd, useTasksChanged } from "@/lib/QuickAdd";
import AIPanel from "@/components/AIPanel";
import TaskForm from "@/components/TaskForm";
import WeekStrip from "@/components/WeekStrip";
import { TaskCard } from "@/components/TaskList";
import { ErrorState, Modal, Skeleton } from "@/components/ui";
import { FolderIcon, PlusIcon, TargetIcon } from "@/components/icons";
import {
  addDays,
  describeDue,
  getDayPart,
  getGreeting,
  toLocalDateString,
  type DayPart,
} from "@/utils/date";
import type { Task } from "@/types/task";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";

const dayParts: { key: DayPart; label: string; icon: string; tint: string }[] = [
  { key: "morning", label: "Morning", icon: "☀️", tint: "bg-warn-soft" },
  { key: "afternoon", label: "Afternoon", icon: "⛅", tint: "bg-accent-soft" },
  { key: "evening", label: "Evening", icon: "🌙", tint: "bg-surface-2" },
  { key: "anytime", label: "Anytime", icon: "📌", tint: "bg-surface-2" },
];

// Timeline order: by time of day; done tasks stay in place (shown crossed out)
function byTime(a: Task, b: Task) {
  return (a.due_time ?? "99").localeCompare(b.due_time ?? "99");
}

export default function DashboardPage() {
  const { user } = useAuth();
  const openQuickAdd = useQuickAdd();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const today = toLocalDateString(now);
  const [selectedDay, setSelectedDay] = useState(today);
  const [editing, setEditing] = useState<Task | null>(null);

  const refresh = useCallback(() => {
    Promise.all([getTasks(), getGoals(), getProjects()])
      .then(([t, g, p]) => {
        setTasks(t);
        setGoals(g);
        setProjects(p);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    getDisplayName(user.id).then(setDisplayName);
  }, [user, refresh]);

  useTasksChanged(refresh);

  // Keep the greeting and "today" correct if the app stays open
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { toggle, remove } = useTaskActions(setTasks, refresh);

  const isToday = selectedDay === today;

  const dayTasks = useMemo(
    () => tasks.filter((t) => t.due_date === selectedDay),
    [tasks, selectedDay]
  );

  const overdue = useMemo(
    () =>
      isToday
        ? tasks.filter((t) => t.status !== "done" && t.due_date !== null && t.due_date < today)
        : [],
    [tasks, today, isToday]
  );

  const busyDays = useMemo(
    () =>
      new Set(
        tasks
          .filter((t) => t.status !== "done" && t.due_date)
          .map((t) => t.due_date!)
      ),
    [tasks]
  );

  const groups = useMemo(() => {
    const result = new Map<DayPart, Task[]>();
    for (const task of [...dayTasks].sort(byTime)) {
      const part = getDayPart(task.due_time);
      result.set(part, [...(result.get(part) ?? []), task]);
    }
    return result;
  }, [dayTasks]);

  // Project / goal deadlines in the next 7 days
  const deadlines = useMemo(() => {
    const end = addDays(today, 7);
    const inRange = (d: string | null): d is string => !!d && d >= today && d <= end;
    return [
      ...projects
        .filter((p) => inRange(p.deadline))
        .map((p) => ({ id: p.id, name: p.name, date: p.deadline!, href: `/projects/${p.id}`, Icon: FolderIcon })),
      ...goals
        .filter((g) => inRange(g.target_date))
        .map((g) => ({ id: g.id, name: g.name, date: g.target_date!, href: "/goals", Icon: TargetIcon })),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }, [projects, goals, today]);

  const completed = dayTasks.filter((t) => t.status === "done").length;
  const pending = dayTasks.length - completed + overdue.length;
  const name = displayName ?? user?.email?.split("@")[0] ?? "there";
  const [y, m, d] = selectedDay.split("-").map(Number);
  const selectedLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const cardProps = {
    showDate: false,
    onEditTask: setEditing,
    onDeleteTask: remove,
    onToggleStatus: toggle,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {getGreeting(now)}, {name} 👋
        </h1>
        <p className="mt-0.5 text-muted">
          {selectedLabel}
          {!isToday && (
            <button
              onClick={() => setSelectedDay(today)}
              className="ml-2 font-medium text-accent hover:underline"
            >
              Back to today
            </button>
          )}
        </p>
      </div>

      <WeekStrip
        selected={selectedDay}
        today={today}
        busyDays={busyDays}
        onSelect={setSelectedDay}
      />

      {!loaded ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refresh} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Tasks" value={dayTasks.length + overdue.length} className="text-ink" />
            <Stat label="Completed" value={completed} className="text-ok" />
            <Stat label="Pending" value={pending} className="text-warn" />
          </div>

          {isToday && <AIPanel tasks={tasks} onToggle={toggle} />}

          {overdue.length > 0 && (
            <Group icon="⏰" label="Overdue" tint="bg-danger-soft">
              {overdue.map((task) => (
                <TaskCard key={task.id} task={task} {...cardProps} showDate />
              ))}
            </Group>
          )}

          {dayTasks.length === 0 && overdue.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl bg-surface px-6 py-10 text-center shadow-card">
              <p className="text-3xl">🎉</p>
              <p className="mt-2 font-semibold text-ink">
                {isToday ? "Nothing planned for today" : "Nothing planned for this day"}
              </p>
              <p className="mt-1 text-sm text-muted">Enjoy it, or add something.</p>
              <button
                onClick={() => openQuickAdd({ dueDate: selectedDay })}
                className="mt-4 flex items-center gap-1.5 rounded-xl bg-accent-soft px-4 py-2 text-sm font-semibold text-accent"
              >
                <PlusIcon className="h-4 w-4" />
                Add a task
              </button>
            </div>
          ) : (
            dayParts
              .filter((part) => groups.has(part.key))
              .map((part) => (
                <Group key={part.key} icon={part.icon} label={part.label} tint={part.tint}>
                  {groups.get(part.key)!.map((task) => (
                    <TaskCard key={task.id} task={task} {...cardProps} />
                  ))}
                </Group>
              ))
          )}

          {dayTasks.length > 0 && (
            <button
              onClick={() => openQuickAdd({ dueDate: selectedDay })}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line py-3 text-sm font-medium text-muted transition hover:border-accent/40 hover:text-accent"
            >
              <PlusIcon className="h-4 w-4" />
              Add to {isToday ? "today" : "this day"}
            </button>
          )}

          {deadlines.length > 0 && (
            <Group icon="🏁" label="Deadlines this week" tint="bg-ok-soft">
              {deadlines.map((item) => (
                <li key={item.href + item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-card transition hover:ring-2 hover:ring-accent/20"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <item.Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                      {item.name}
                    </span>
                    <span className="text-sm text-muted">
                      {describeDue(item.date, today).label}
                    </span>
                  </Link>
                </li>
              ))}
            </Group>
          )}
        </>
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

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${className}`}>{value}</p>
    </div>
  );
}

function Group({
  icon,
  label,
  tint,
  children,
}: {
  icon: string;
  label: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-ink">
        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-base ${tint}`}>
          {icon}
        </span>
        {label}
      </h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}
