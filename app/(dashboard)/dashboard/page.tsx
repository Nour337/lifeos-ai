"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { getTasks } from "@/lib/queries/tasks";
import { useTaskActions } from "@/lib/useTaskActions";
import { getGoals } from "@/lib/queries/goals";
import { getProjects } from "@/lib/queries/projects";
import { getDisplayName } from "@/lib/queries/profiles";
import AIPanel from "@/components/AIPanel";
import TaskForm from "@/components/TaskForm";
import { TaskCheckbox } from "@/components/TaskList";
import {
  Button,
  Card,
  ErrorState,
  Modal,
  SectionTitle,
  Skeleton,
} from "@/components/ui";
import {
  CalendarIcon,
  ChecklistIcon,
  FolderIcon,
  PlusIcon,
  TargetIcon,
} from "@/components/icons";
import {
  addDays,
  describeDue,
  formatDate,
  getGreeting,
  toLocalDateString,
} from "@/utils/date";
import type { Task } from "@/types/task";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";

const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

type Deadline = {
  id: string;
  kind: "Task" | "Project" | "Goal";
  name: string;
  date: string;
  href: string;
};

const deadlineIcons = {
  Task: ChecklistIcon,
  Project: FolderIcon,
  Goal: TargetIcon,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);

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

  // Keep the greeting and "today" correct if the app stays open
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const today = toLocalDateString(now);

  const todaysTasks = useMemo(
    () => tasks.filter((task) => task.due_date === today),
    [tasks, today]
  );

  const overdueTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== "done" && task.due_date !== null && task.due_date < today
      ),
    [tasks, today]
  );

  const openCount = tasks.filter((t) => t.status !== "done").length;

  // Most urgent open task: highest priority first, then earliest due date
  const topTask = useMemo(() => {
    const open = tasks.filter((task) => task.status !== "done");
    open.sort((a, b) => {
      const byPriority = priorityRank[b.priority] - priorityRank[a.priority];
      if (byPriority !== 0) return byPriority;
      return (a.due_date ?? "9999-12-31").localeCompare(
        b.due_date ?? "9999-12-31"
      );
    });
    return open[0] ?? null;
  }, [tasks]);

  const upcoming = useMemo(() => {
    const start = addDays(today, 1);
    const end = addDays(today, 7);
    const inRange = (date: string | null): date is string =>
      date !== null && date >= start && date <= end;

    const items: Deadline[] = [
      ...tasks
        .filter((t) => t.status !== "done" && inRange(t.due_date))
        .map((t) => ({
          id: t.id,
          kind: "Task" as const,
          name: t.title,
          date: t.due_date!,
          href: "/tasks",
        })),
      ...projects
        .filter((p) => inRange(p.deadline))
        .map((p) => ({
          id: p.id,
          kind: "Project" as const,
          name: p.name,
          date: p.deadline!,
          href: `/projects/${p.id}`,
        })),
      ...goals
        .filter((g) => inRange(g.target_date))
        .map((g) => ({
          id: g.id,
          kind: "Goal" as const,
          name: g.name,
          date: g.target_date!,
          href: "/goals",
        })),
    ];
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [tasks, projects, goals, today]);

  const { toggle: handleToggle } = useTaskActions(setTasks, refresh);

  const name = displayName ?? user?.email?.split("@")[0] ?? "there";
  const doneToday = todaysTasks.filter((t) => t.status === "done").length;
  const todayList = [...overdueTasks, ...todaysTasks];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">
            {now.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {getGreeting(now)}, {name}
          </h1>
        </div>
        <Button onClick={() => setFormOpen(true)} aria-label="New task">
          <PlusIcon className="h-4 w-4" />
          <span className="hidden sm:inline">New task</span>
        </Button>
      </div>

      {!loaded ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refresh} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Done today"
              value={todaysTasks.length ? `${doneToday}/${todaysTasks.length}` : "0"}
            />
            <Stat
              label="Overdue"
              value={String(overdueTasks.length)}
              tone={overdueTasks.length > 0 ? "danger" : undefined}
            />
            <Stat label="Open" value={String(openCount)} />
          </div>

          {topTask && (
            <section className="rounded-2xl bg-hero p-5 text-hero-ink">
              <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
                Focus on
              </p>
              <div className="mt-2 flex items-start gap-3">
                <button
                  onClick={() => handleToggle(topTask)}
                  aria-label={`Mark "${topTask.title}" done`}
                  className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-current opacity-60 transition hover:opacity-100"
                />
                <div className="min-w-0">
                  <p className="text-lg font-medium leading-snug">
                    {topTask.title}
                  </p>
                  <p className="mt-1 text-sm opacity-60">
                    <span className="capitalize">{topTask.priority}</span> priority
                    {topTask.due_date &&
                      ` · ${describeDue(topTask.due_date, today).label}`}
                  </p>
                </div>
              </div>
            </section>
          )}

          <AIPanel tasks={tasks} onToggle={handleToggle} />

          <Card>
            <SectionTitle
              action={
                <Link href="/tasks" className="text-sm text-accent hover:underline">
                  All tasks
                </Link>
              }
            >
              Today
            </SectionTitle>
            {todayList.length === 0 ? (
              <p className="py-4 text-center text-muted">
                Nothing due today — nice! 🎉
              </p>
            ) : (
              <ul className="-mx-1 space-y-0.5">
                {todayList.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    overdue={task.due_date! < today}
                    onToggle={handleToggle}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle>Next 7 days</SectionTitle>
            {upcoming.length === 0 ? (
              <p className="py-4 text-center text-muted">
                No deadlines this week.
              </p>
            ) : (
              <ul className="-mx-1 space-y-0.5">
                {upcoming.map((item) => {
                  const Icon = deadlineIcons[item.kind];
                  return (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-surface-2"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">
                          {item.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
                          <CalendarIcon className="h-3.5 w-3.5" />
                          {describeDue(item.date, today).label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      <Modal open={formOpen} title="New task" onClose={() => setFormOpen(false)}>
        {formOpen && (
          <TaskForm
            categories={[
              ...new Set(tasks.map((t) => t.category).filter((c): c is string => !!c)),
            ]}
            onTaskSaved={() => {
              setFormOpen(false);
              refresh();
            }}
            onCancel={() => setFormOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div
      className={`rounded-2xl border p-3 sm:p-4 ${
        tone === "danger"
          ? "border-transparent bg-danger-soft text-danger"
          : "border-line bg-surface text-ink"
      }`}
    >
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className={`text-xs ${tone === "danger" ? "" : "text-muted"}`}>{label}</p>
    </div>
  );
}

function TaskRow({
  task,
  overdue,
  onToggle,
}: {
  task: Task;
  overdue: boolean;
  onToggle: (task: Task) => void;
}) {
  const done = task.status === "done";
  return (
    <li className="flex items-center gap-3 rounded-lg px-1 py-2">
      <TaskCheckbox done={done} title={task.title} onToggle={() => onToggle(task)} />
      <span
        className={`min-w-0 flex-1 truncate ${done ? "text-muted line-through" : "text-ink"}`}
      >
        {task.title}
      </span>
      {overdue ? (
        <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
          {formatDate(task.due_date!)}
        </span>
      ) : (
        task.priority === "high" &&
        !done && (
          <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
            High
          </span>
        )
      )}
    </li>
  );
}
