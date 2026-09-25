import { addDays, timeToMinutes } from "@/utils/date";
import type { Goal } from "@/types/goal";
import type { Project, ProjectKind } from "@/types/project";
import type { Importance } from "@/types/persona";
import type { Task } from "@/types/task";

// Facts computed from the user's own data. The AI gets these instead of
// raw history, so its reasons ("you haven't studied Database in 5 days")
// are grounded in real numbers. Everything here is pure, so the browser
// can show the same facts on the profile page.

const DEFAULT_MINUTES = 30;

export function taskMinutes(task: Task): number {
  if (task.estimated_duration) return task.estimated_duration;
  if (task.due_time && task.end_time) {
    const span = timeToMinutes(task.end_time) - timeToMinutes(task.due_time);
    if (span > 0) return span;
  }
  return DEFAULT_MINUTES;
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

// ---------------------------------------------------------------- areas

export type Area = {
  id: string;
  type: "project" | "goal";
  kind: ProjectKind | "goal";
  name: string;
  importance: Importance | null;
  deadline: string | null; // exam date / deadline / goal target
  daysLeft: number | null;
  weeklyTargetMinutes: number | null;
  minutesLast7: number; // done in the last 7 days
  sessionsLast7: number;
  lastDone: string | null;
  daysSinceLast: number | null;
  openTasks: number;
  plannedNext7: number; // open tasks scheduled in the next 7 days
  progress: number; // the user's own estimate, 0-100
  ignored: number; // how often suggestions for it were ignored
  aiHelp: boolean; // false = the user doesn't want suggestions for it
};

export function computeAreas(
  projects: Project[],
  goals: Goal[],
  tasks: Task[],
  today: string,
  ignored: Record<string, number> = {}
): Area[] {
  const weekAgo = addDays(today, -6);
  const nextWeek = addDays(today, 7);
  const projectGoal = new Map(projects.map((p) => [p.id, p.goal_id]));

  const build = (
    base: Pick<Area, "id" | "type" | "kind" | "name" | "importance" | "deadline" | "progress" | "aiHelp"> & {
      weeklyHours: number | null;
    },
    belongs: (t: Task) => boolean
  ): Area => {
    const own = tasks.filter(belongs);
    const done = own.filter((t) => t.status === "done" && t.due_date);
    const recent = done.filter((t) => t.due_date! >= weekAgo && t.due_date! <= today);
    const lastDone = done
      .map((t) => t.due_date!)
      .filter((d) => d <= today)
      .sort()
      .pop() ?? null;
    const open = own.filter((t) => t.status !== "done" && t.status !== "skipped");
    return {
      id: base.id,
      type: base.type,
      kind: base.kind,
      name: base.name,
      importance: base.importance,
      deadline: base.deadline,
      daysLeft: base.deadline ? daysBetween(today, base.deadline) : null,
      weeklyTargetMinutes: base.weeklyHours ? Math.round(base.weeklyHours * 60) : null,
      minutesLast7: recent.reduce((sum, t) => sum + taskMinutes(t), 0),
      sessionsLast7: recent.length,
      lastDone,
      daysSinceLast: lastDone ? daysBetween(lastDone, today) : null,
      openTasks: open.length,
      plannedNext7: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= nextWeek).length,
      progress: base.progress,
      ignored: ignored[base.name] ?? 0,
      aiHelp: base.aiHelp,
    };
  };

  const byName = (name: string) => (t: Task) =>
    !!t.category && t.category.toLowerCase() === name.toLowerCase();

  return [
    ...projects.map((p) =>
      build(
        {
          id: p.id,
          type: "project",
          kind: p.kind,
          name: p.name,
          importance: p.importance,
          deadline: p.deadline,
          progress: p.progress ?? 0,
          weeklyHours: p.weekly_hours,
          aiHelp: p.ai_help !== false,
        },
        (t) => t.project_id === p.id || (!t.project_id && byName(p.name)(t))
      )
    ),
    ...goals.map((g) =>
      build(
        {
          id: g.id,
          type: "goal",
          kind: "goal",
          name: g.name,
          importance: g.priority,
          deadline: g.target_date,
          progress: g.progress ?? 0,
          weeklyHours: g.weekly_hours,
          aiHelp: true,
        },
        (t) =>
          t.goal_id === g.id ||
          (!!t.project_id && projectGoal.get(t.project_id) === g.id) ||
          (!t.project_id && !t.goal_id && byName(g.name)(t))
      )
    ),
  ];
}

// ---------------------------------------------------------------- learned behaviour

export type Insight = { key: string; text: string };

type PartKey = "early" | "morning" | "afternoon" | "evening";

function partOf(time: string): PartKey {
  const m = timeToMinutes(time);
  if (m < 8 * 60) return "early";
  if (m < 12 * 60) return "morning";
  if (m < 17 * 60) return "afternoon";
  return "evening";
}

const PART_LABELS: Record<PartKey, string> = {
  early: "before 8:00",
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
};

const rate = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

// Patterns in the last 30 days of past tasks. Each insight needs enough
// examples before it is reported, so one bad day doesn't teach the AI much.
export function computeInsights(tasks: Task[], today: string): Insight[] {
  const from = addDays(today, -30);
  const past = tasks.filter(
    (t) => !t.parent_id && t.due_date && t.due_date >= from && t.due_date < today
  );
  const done = past.filter((t) => t.status === "done");
  const insights: Insight[] = [];

  // Time of day
  const parts = new Map<PartKey, { done: number; total: number }>();
  for (const t of past) {
    if (!t.due_time) continue;
    const key = partOf(t.due_time);
    const entry = parts.get(key) ?? { done: 0, total: 0 };
    entry.total++;
    if (t.status === "done") entry.done++;
    parts.set(key, entry);
  }
  const early = parts.get("early");
  if (early && early.total >= 3 && rate(early.done, early.total) < 40) {
    insights.push({
      key: "early",
      text: `Rarely completes tasks scheduled before 8:00 (${early.done} of ${early.total} done). Avoid early-morning tasks.`,
    });
  }
  const measured = [...parts.entries()].filter(([, v]) => v.total >= 4);
  if (measured.length >= 2) {
    measured.sort((a, b) => rate(b[1].done, b[1].total) - rate(a[1].done, a[1].total));
    const [bestKey, best] = measured[0];
    const [, worst] = measured[measured.length - 1];
    if (rate(best.done, best.total) - rate(worst.done, worst.total) >= 20) {
      insights.push({
        key: "best_time",
        text: `Completes the most tasks ${PART_LABELS[bestKey]} (${rate(best.done, best.total)}%). Prefer that time for important work.`,
      });
    }
  }

  // Session length
  const doneLengths = done.filter((t) => t.estimated_duration || t.end_time).map(taskMinutes).sort((a, b) => a - b);
  if (doneLengths.length >= 4) {
    const median = doneLengths[Math.floor(doneLengths.length / 2)];
    insights.push({
      key: "session",
      text: `Usually completes sessions of about ${median} minutes.`,
    });
  }
  const long = past.filter((t) => (t.estimated_duration || t.end_time) && taskMinutes(t) >= 90);
  const longDone = long.filter((t) => t.status === "done").length;
  if (long.length >= 3 && rate(longDone, long.length) < 40) {
    insights.push({
      key: "long",
      text: `Often doesn't finish long tasks of 90+ minutes (${longDone} of ${long.length}). Split big work into shorter sessions.`,
    });
  }

  // Postponing and skipping
  // (a rescheduled task moved into the future still counts as postponed)
  const movedAhead = tasks.filter(
    (t) => !t.parent_id && t.status === "rescheduled" && t.due_date && t.due_date >= today
  ).length;
  const postponed =
    past.filter((t) => t.status === "skipped" || t.status === "rescheduled").length + movedAhead;
  const judged = past.length;
  if (judged + movedAhead >= 6 && rate(postponed, judged + movedAhead) >= 30) {
    insights.push({
      key: "postpone",
      text: "Often postpones or skips tasks. Plan fewer tasks per day and leave buffer time.",
    });
  }

  // Daily throughput over the last 14 days
  const twoWeeks = addDays(today, -14);
  const recentDone = done.filter((t) => t.due_date! >= twoWeeks);
  const activeDays = new Set(recentDone.map((t) => t.due_date)).size;
  if (activeDays >= 3) {
    const perDay = Math.round((recentDone.length / activeDays) * 10) / 10;
    insights.push({
      key: "throughput",
      text: `On active days, completes about ${perDay} task${perDay === 1 ? "" : "s"}.`,
    });
  }

  // Missed tasks overall
  const missed = past.filter((t) => t.status !== "done" && t.status !== "skipped").length;
  if (judged >= 8 && rate(done.length, judged) < 50) {
    insights.push({
      key: "completion",
      text: `Completed ${done.length} of ${judged} past tasks (${missed} still open). Schedules should be lighter and more realistic.`,
    });
  }

  return insights;
}
