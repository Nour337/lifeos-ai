"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { getTasks, toggleTaskStatus } from "@/lib/queries/tasks";
import { getGoals } from "@/lib/queries/goals";
import { getProjects } from "@/lib/queries/projects";
import { getDisplayName } from "@/lib/queries/profiles";
import AIPanel from "@/components/AIPanel";
import {
  addDays,
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

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(() => {
    Promise.all([getTasks(), getGoals(), getProjects()]).then(([t, g, p]) => {
      setTasks(t);
      setGoals(g);
      setProjects(p);
      setLoaded(true);
    });
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

  const handleToggle = async (task: Task) => {
    if (await toggleTaskStatus(task.id, task.status)) refresh();
  };

  const name = displayName ?? user?.email?.split("@")[0] ?? "there";
  const doneToday = todaysTasks.filter((t) => t.status === "done").length;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-black dark:text-white">
          {getGreeting(now)}, {name}
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          {now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {!loaded ? (
        <p className="text-zinc-500">Loading...</p>
      ) : (
        <>
          <Card title="Highest priority">
            {topTask ? (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => handleToggle(topTask)}
                  className="h-5 w-5 cursor-pointer"
                  aria-label={`Mark "${topTask.title}" done`}
                />
                <div>
                  <p className="font-medium text-black dark:text-white">
                    {topTask.title}
                  </p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {topTask.priority} priority
                    {topTask.due_date && ` · Due ${formatDate(topTask.due_date)}`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-zinc-500 dark:text-zinc-400">
                Nothing open. You&apos;re all caught up.
              </p>
            )}
          </Card>

          <Card
            title={`Today${todaysTasks.length ? ` · ${doneToday}/${todaysTasks.length} done` : ""}`}
          >
            {todaysTasks.length === 0 && overdueTasks.length === 0 ? (
              <p className="text-zinc-500 dark:text-zinc-400">
                No tasks due today — nice!{" "}
                <Link href="/tasks" className="underline">
                  Add one
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {overdueTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    note={`Overdue · ${formatDate(task.due_date!)}`}
                    onToggle={handleToggle}
                  />
                ))}
                {todaysTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={handleToggle} />
                ))}
              </ul>
            )}
          </Card>

          <Card title="Next 7 days">
            {upcoming.length === 0 ? (
              <p className="text-zinc-500 dark:text-zinc-400">
                No deadlines this week.
              </p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span className="text-black dark:text-white">
                        <span className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {item.kind}
                        </span>
                        {item.name}
                      </span>
                      <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
                        {formatDate(item.date)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <AIPanel hasTasks={tasks.some((t) => t.status !== "done")} />
        </>
      )}
    </div>
  );
}

function TaskRow({
  task,
  note,
  onToggle,
}: {
  task: Task;
  note?: string;
  onToggle: (task: Task) => void;
}) {
  const done = task.status === "done";
  return (
    <li className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        className="h-5 w-5 cursor-pointer"
        aria-label={`Toggle "${task.title}"`}
      />
      <span
        className={`flex-1 text-black dark:text-white ${done ? "line-through opacity-50" : ""}`}
      >
        {task.title}
      </span>
      {note ? (
        <span className="text-xs text-red-500">{note}</span>
      ) : (
        <span className="text-xs text-zinc-500">{task.priority}</span>
      )}
    </li>
  );
}
