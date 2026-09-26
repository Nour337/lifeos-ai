"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { getTasks } from "@/lib/queries/tasks";
import { getGoals } from "@/lib/queries/goals";
import { getProjects } from "@/lib/queries/projects";
import { getAssessments } from "@/lib/queries/assessments";
import { getProfile } from "@/lib/queries/persona";
import { quickStartDone, sectionStatus } from "@/lib/persona/sections";
import { blockIntervals, scheduleInput } from "@/lib/schedule";
import { useTaskActions } from "@/lib/useTaskActions";
import { useQuickAdd, useTasksChanged } from "@/lib/QuickAdd";
import FocusCard from "@/components/FocusCard";
import RecoveryCard from "@/components/RecoveryCard";
import DayCheckIn from "@/components/DayCheckIn";
import FocusTimer from "@/components/FocusTimer";
import TaskForm from "@/components/TaskForm";
import WeekStrip from "@/components/WeekStrip";
import WeeklyProgress from "@/components/WeeklyProgress";
import ProgressBar from "@/components/ProgressBar";
import { getGoalProgress } from "@/lib/progress";
import { TaskCard } from "@/components/TaskList";
import { ErrorState, Modal, Skeleton } from "@/components/ui";
import { BrainIcon, PlusIcon, TargetIcon } from "@/components/icons";
import {
  addDays,
  describeDue,
  getDayPart,
  getGreeting,
  minutesToTime,
  toLocalDateString,
  type DayPart,
} from "@/utils/date";
import { isDone, isOpen, type Task } from "@/types/task";
import type { Goal } from "@/types/goal";
import type { Assessment, Project } from "@/types/project";
import type { Profile } from "@/types/persona";

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

const BANNER_KEY = "lifeos-persona-banner-hidden";

// Today answers three questions, in order: what should I do now (Focus),
// what's today (the timeline), and what's slipping (recovery). The week is
// one compact card at the end.
export default function DashboardPage() {
  const { user } = useAuth();
  const openQuickAdd = useQuickAdd();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const today = toLocalDateString(now);
  const [selectedDay, setSelectedDay] = useState(today);
  const [editing, setEditing] = useState<Task | null>(null);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [bannerHidden, setBannerHidden] = useState(() => {
    try {
      return localStorage.getItem(BANNER_KEY) === "1";
    } catch {
      return false;
    }
  });

  const refresh = useCallback(() => {
    Promise.all([getTasks(), getGoals(), getProjects(), getAssessments().catch(() => [])])
      .then(([t, g, p, a]) => {
        setTasks(t);
        setGoals(g);
        setProjects(p);
        setAssessments(a);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    getProfile(user.id).then(setProfile).catch(() => setProfile(null));
  }, [user, refresh]);

  useTasksChanged(refresh);

  // Keep the greeting and "today" correct if the app stays open
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { toggle, remove } = useTaskActions(setTasks, refresh);

  const isToday = selectedDay === today;
  const aiProfile = profile?.ai_profile ?? null;

  const dayTasks = useMemo(() => tasks.filter((t) => t.due_date === selectedDay), [tasks, selectedDay]);

  const busyDays = useMemo(
    () => new Set(tasks.filter((t) => isOpen(t) && t.due_date).map((t) => t.due_date!)),
    [tasks]
  );

  // Work / university hours of the day, shown in the timeline for context
  const fixedBlocks = useMemo(
    () => blockIntervals(scheduleInput(aiProfile, []), selectedDay),
    [aiProfile, selectedDay]
  );

  const groups = useMemo(() => {
    const result = new Map<DayPart, Task[]>();
    for (const task of [...dayTasks].sort(byTime)) {
      const part = getDayPart(task.due_time);
      result.set(part, [...(result.get(part) ?? []), task]);
    }
    return result;
  }, [dayTasks]);

  // Project / exam / goal deadlines in the next 7 days
  const deadlines = useMemo(() => {
    const end = addDays(today, 7);
    const inRange = (d: string | null): d is string => !!d && d >= today && d <= end;
    return [
      ...projects
        .filter((p) => p.kind !== "milestone" && inRange(p.deadline))
        .map((p) => ({ id: p.id, name: p.name, date: p.deadline!, href: `/projects/${p.id}` })),
      ...assessments
        .filter((a) => !a.done && inRange(a.due_date))
        .map((a) => ({ id: a.id, name: a.title, date: a.due_date, href: `/projects/${a.project_id}` })),
      ...goals
        .filter((g) => inRange(g.target_date))
        .map((g) => ({ id: g.id, name: g.name, date: g.target_date!, href: "/goals" })),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }, [projects, goals, assessments, today]);

  const upcoming = useMemo(() => {
    const end = addDays(selectedDay, 7);
    return tasks
      .filter((t) => isOpen(t) && t.due_date && t.due_date > selectedDay && t.due_date <= end && !t.series_id)
      .sort(
        (a, b) => a.due_date!.localeCompare(b.due_date!) || (a.due_time ?? "99").localeCompare(b.due_time ?? "99")
      )
      .slice(0, 5);
  }, [tasks, selectedDay]);

  const goalProgress = useMemo(
    () =>
      goals
        .map((goal) => ({ goal, progress: getGoalProgress(goal, tasks, projects) }))
        .filter(({ progress }) => progress.manual || (progress.total > 0 && progress.done < progress.total))
        .slice(0, 3),
    [goals, tasks, projects]
  );

  const completed = dayTasks.filter(isDone).length;
  const counted = dayTasks.filter((t) => t.status !== "skipped").length;
  const name = profile?.display_name ?? user?.email?.split("@")[0] ?? "there";
  const quickStart = profile ? quickStartDone(sectionStatus(profile.ai_profile, projects, goals)) : true;
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
    onStartTask: setFocusTask,
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
            <button onClick={() => setSelectedDay(today)} className="ml-2 font-medium text-accent hover:underline">
              Back to today
            </button>
          )}
        </p>
      </div>

      <WeekStrip selected={selectedDay} today={today} busyDays={busyDays} onSelect={setSelectedDay} />

      {!loaded ? (
        <div className="space-y-4">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-12 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refresh} />
      ) : (
        <>
          {isToday && (
            <>
              {profile && !quickStart && !bannerHidden && (
                <div className="flex items-center gap-3 rounded-2xl bg-hero p-4 text-hero-ink shadow-card">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-grad-from to-grad-to text-white">
                    <BrainIcon className="h-5 w-5" />
                  </span>
                  <Link href="/onboarding" className="min-w-0 flex-1">
                    <span className="block font-semibold">Tell your AI about you · 1 min</span>
                    <span className="block text-sm opacity-75">
                      Who you are, what you&apos;re working on, when you&apos;re busy. Plans get much better.
                    </span>
                  </Link>
                  <button
                    onClick={() => {
                      setBannerHidden(true);
                      try {
                        localStorage.setItem(BANNER_KEY, "1");
                      } catch {}
                    }}
                    className="shrink-0 text-sm opacity-60 hover:opacity-100"
                    aria-label="Hide"
                  >
                    ✕
                  </button>
                </div>
              )}
              <DayCheckIn
                tasks={tasks}
                today={today}
                hour={now.getHours()}
                profile={aiProfile}
                deadlines={deadlines}
              />
              <FocusCard tasks={tasks} profile={aiProfile} />
              <RecoveryCard
                tasks={tasks}
                today={today}
                profile={aiProfile}
                projects={projects}
                assessments={assessments}
              />
            </>
          )}

          {counted > 0 && (
            <DayProgress done={completed} total={counted} label={isToday ? "Today's progress" : "Progress"} />
          )}

          {dayTasks.length === 0 ? (
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
              .filter((part) => groups.has(part.key) || fixedBlocks.some((b) => getDayPart(minutesToTime(b.start)) === part.key))
              .map((part) => (
                <Group key={part.key} icon={part.icon} label={part.label} tint={part.tint}>
                  {fixedBlocks
                    .filter((b) => getDayPart(minutesToTime(b.start)) === part.key)
                    .map((b) => (
                      <li
                        key={`${b.label}-${b.start}`}
                        className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-2.5 text-sm text-muted"
                      >
                        <span aria-hidden="true">🔒</span>
                        <span className="flex-1">{b.label}</span>
                        <span className="tabular-nums">
                          {minutesToTime(b.start)}–{b.end >= 1440 ? "24:00" : minutesToTime(b.end)}
                        </span>
                      </li>
                    ))}
                  {(groups.get(part.key) ?? []).map((task) => (
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

          {upcoming.length > 0 && (
            <Group icon="🗓️" label="Coming up" tint="bg-accent-soft">
              {upcoming.map((task) => (
                <TaskCard key={task.id} task={task} {...cardProps} showDate />
              ))}
            </Group>
          )}

          <WeeklyProgress tasks={tasks} weekOf={selectedDay} today={today}>
            {deadlines.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-sm font-semibold text-ink">🏁 Deadlines</p>
                <ul className="space-y-1.5">
                  {deadlines.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href} className="flex items-center gap-2 text-sm hover:text-accent">
                        <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                        <span className="text-muted">{describeDue(item.date, today).label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {goalProgress.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
                  <span>🎯 Goals</span>
                  <Link href="/goals" className="font-normal text-accent hover:underline">
                    All goals
                  </Link>
                </p>
                <ul className="space-y-3">
                  {goalProgress.map(({ goal, progress }) => (
                    <li key={goal.id}>
                      <p className="mb-1 flex items-center gap-2 text-sm text-ink">
                        <TargetIcon className="h-4 w-4 text-accent" />
                        {goal.name}
                      </p>
                      <ProgressBar progress={progress} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link
              href="/review"
              className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm font-medium text-accent hover:underline"
            >
              📊 Weekly review: what you finished, what slipped, what&apos;s next
              <span>›</span>
            </Link>
          </WeeklyProgress>
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
      <FocusTimer key={focusTask?.id ?? "none"} task={focusTask} onClose={() => setFocusTask(null)} />
    </div>
  );
}

function DayProgress({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">{label}</h2>
        <span className="text-2xl font-bold tabular-nums text-ink">{percent}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            percent === 100 ? "bg-ok" : "bg-gradient-to-r from-grad-from to-grad-to"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-sm text-muted">
        {done} / {total} tasks completed{percent === 100 && " 🎉"}
      </p>
    </section>
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
        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-base ${tint}`}>{icon}</span>
        {label}
      </h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}
