import { addDays, daysBetween, nowInZone, timeToMinutes } from "@/utils/date";
import { taskMinutes } from "@/lib/schedule";
import type { Goal } from "@/types/goal";
import { ROLE_OF_KIND, type Assessment, type Project, type ProjectKind } from "@/types/project";
import type { AIProfile, Importance, Role } from "@/types/persona";
import type { Task, TaskEvent } from "@/types/task";

// Facts computed from the user's own data. The AI gets these instead of
// raw history, so its reasons ("you haven't studied Database in 5 days")
// are grounded in real numbers. Everything here is pure, so the browser
// can show the same facts on the profile page.

export { taskMinutes, daysBetween };

// ---------------------------------------------------------------- areas

export type Area = {
  id: string;
  type: "project" | "goal";
  kind: ProjectKind | "goal";
  role: Role | null; // student / working / entrepreneur..., for balance
  name: string;
  importance: Importance | null;
  deadline: string | null; // next exam / assessment / deadline / goal target
  deadlineLabel: string | null; // "Midterm", "deadline", "target"
  daysLeft: number | null;
  weeklyTargetMinutes: number | null;
  minutesLast7: number; // done in the last 7 days
  sessionsLast7: number;
  lastDone: string | null;
  daysSinceLast: number | null;
  openTasks: number;
  overdueTasks: number;
  plannedNext7: number; // open tasks scheduled in the next 7 days
  progress: number; // calculated from tasks, or the user's own estimate
  ignored: number; // how often suggestions for it were ignored (fades over time)
  suggestionsAccepted: number; // tasks made from suggestions for it
  suggestionsDone: number;
  aiHelp: boolean; // false = the user doesn't want suggestions for it
};

// When was a task actually done (user-local date)? Falls back to its due date
export function doneDate(task: Task, timeZone: string): string | null {
  if (task.status !== "done") return null;
  if (task.completed_at) return nowInZone(timeZone, new Date(task.completed_at)).today;
  return task.due_date;
}

// Ignoring a suggestion counts less as time passes (half-life of 3 weeks)
export function ignoredWeight(entry: { count: number; last: string } | undefined, today: string): number {
  if (!entry) return 0;
  const age = Math.max(0, daysBetween(entry.last.slice(0, 10), today));
  return Math.round(entry.count * Math.pow(0.5, age / 21) * 10) / 10;
}

export function computeAreas(
  projects: Project[],
  goals: Goal[],
  tasks: Task[],
  today: string,
  ignored: AIProfile["ignored"] = {},
  assessments: Assessment[] = [],
  timeZone = "UTC"
): Area[] {
  const weekAgo = addDays(today, -6);
  const nextWeek = addDays(today, 7);
  const projectGoal = new Map(projects.map((p) => [p.id, p.goal_id]));

  const build = (
    base: Pick<
      Area,
      "id" | "type" | "kind" | "role" | "name" | "importance" | "deadline" | "deadlineLabel" | "aiHelp"
    > & { weeklyHours: number | null; manualProgress: number | null },
    belongs: (t: Task) => boolean
  ): Area => {
    const own = tasks.filter((t) => !t.parent_id && belongs(t));
    const doneDates = own.map((t) => doneDate(t, timeZone)).filter((d): d is string => !!d && d <= today);
    const recent = own.filter((t) => {
      const d = doneDate(t, timeZone);
      return d && d >= weekAgo && d <= today;
    });
    const lastDone = doneDates.sort().pop() ?? null;
    const open = own.filter((t) => t.status !== "done" && t.status !== "skipped");
    const counted = own.filter((t) => t.status !== "skipped");
    const fromSuggestions = own.filter((t) => t.source === "suggestion");
    return {
      id: base.id,
      type: base.type,
      kind: base.kind,
      role: base.role,
      name: base.name,
      importance: base.importance,
      deadline: base.deadline,
      deadlineLabel: base.deadlineLabel,
      daysLeft: base.deadline ? daysBetween(today, base.deadline) : null,
      weeklyTargetMinutes: base.weeklyHours ? Math.round(base.weeklyHours * 60) : null,
      minutesLast7: recent.reduce((sum, t) => sum + taskMinutes(t), 0),
      sessionsLast7: recent.length,
      lastDone,
      daysSinceLast: lastDone ? daysBetween(lastDone, today) : null,
      openTasks: open.length,
      overdueTasks: open.filter((t) => t.due_date && t.due_date < today).length,
      plannedNext7: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= nextWeek).length,
      progress:
        base.manualProgress ??
        (counted.length ? Math.round((counted.filter((t) => t.status === "done").length / counted.length) * 100) : 0),
      ignored: ignoredWeight(ignored[base.id] ?? ignored[base.name], today),
      suggestionsAccepted: fromSuggestions.length,
      suggestionsDone: fromSuggestions.filter((t) => t.status === "done").length,
      aiHelp: base.aiHelp,
    };
  };

  const byName = (name: string) => (t: Task) =>
    !!t.category && t.category.toLowerCase() === name.toLowerCase();

  // A course's next deadline is its nearest open assessment
  const nextAssessment = (projectId: string) =>
    assessments
      .filter((a) => a.project_id === projectId && !a.done && a.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  const milestonesOf = (goalId: string) =>
    new Set(projects.filter((p) => p.kind === "milestone" && p.goal_id === goalId).map((p) => p.id));

  return [
    ...projects
      .filter((p) => p.kind !== "milestone")
      .map((p) => {
        const next = nextAssessment(p.id);
        const deadline =
          next && (!p.deadline || p.deadline < today || next.due_date <= p.deadline) ? next.due_date : p.deadline;
        return build(
          {
            id: p.id,
            type: "project",
            kind: p.kind,
            role: ROLE_OF_KIND[p.kind] ?? null,
            name: p.name,
            importance: p.importance,
            deadline,
            deadlineLabel:
              next && deadline === next.due_date ? next.title : p.kind === "course" ? "exam" : "deadline",
            aiHelp: p.ai_help !== false,
            weeklyHours: p.weekly_hours,
            manualProgress: p.progress_manual ? (p.progress ?? 0) : null,
          },
          (t) => t.project_id === p.id || (!t.project_id && byName(p.name)(t))
        );
      }),
    ...goals.map((g) => {
      const milestones = milestonesOf(g.id);
      return build(
        {
          id: g.id,
          type: "goal",
          kind: "goal",
          role: null,
          name: g.name,
          importance: g.priority,
          deadline: g.target_date,
          deadlineLabel: "target",
          aiHelp: true,
          weeklyHours: g.weekly_hours,
          manualProgress: g.progress_manual ? (g.progress ?? 0) : null,
        },
        (t) =>
          t.goal_id === g.id ||
          (!!t.project_id && (projectGoal.get(t.project_id) === g.id || milestones.has(t.project_id))) ||
          (!t.project_id && !t.goal_id && byName(g.name)(t))
      );
    }),
  ];
}

// ---------------------------------------------------------------- learned behaviour

export type Insight = { key: string; text: string };

type PartKey = "early" | "morning" | "afternoon" | "evening";

function partOf(minutes: number): PartKey {
  if (minutes < 8 * 60) return "early";
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  return "evening";
}

const PART_LABELS: Record<PartKey, string> = {
  early: "before 8:00",
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
};

const rate = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

// Patterns in the last 30 days. Built from what actually happened
// (completion times, moves and skips from the event log) when that history
// exists, and from task states otherwise. Each insight needs enough
// examples before it is reported, so one bad day doesn't teach the AI much.
export function computeInsights(
  tasks: Task[],
  today: string,
  events: TaskEvent[] = [],
  timeZone = "UTC"
): Insight[] {
  const from = addDays(today, -30);
  const past = tasks.filter(
    (t) => !t.parent_id && !t.series_id && t.due_date && t.due_date >= from && t.due_date < today
  );
  const done = past.filter((t) => t.status === "done");
  const insights: Insight[] = [];

  // Planned early-morning work that doesn't happen
  const early = past.filter((t) => t.due_time && timeToMinutes(t.due_time) < 8 * 60);
  const earlyDone = early.filter((t) => t.status === "done").length;
  if (early.length >= 3 && rate(earlyDone, early.length) < 40) {
    insights.push({
      key: "early",
      text: `Rarely completes tasks scheduled before 8:00 (${earlyDone} of ${early.length} done). Avoid early-morning tasks.`,
    });
  }

  // When they actually get things done: the local time of completion
  const completedAt = tasks
    .filter((t) => !t.parent_id && t.completed_at && t.completed_at.slice(0, 10) >= from)
    .map((t) => nowInZone(timeZone, new Date(t.completed_at!)).localTime);
  if (completedAt.length >= 8) {
    const counts = new Map<PartKey, number>();
    for (const time of completedAt) {
      const part = partOf(timeToMinutes(time));
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
    const [bestKey, best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (rate(best, completedAt.length) >= 45) {
      insights.push({
        key: "best_time",
        text: `Gets most things done ${PART_LABELS[bestKey]} (${rate(best, completedAt.length)}% of completions). Put important work there.`,
      });
    }
  } else {
    // Not enough history yet: compare completion rates by planned time
    const parts = new Map<PartKey, { done: number; total: number }>();
    for (const t of past) {
      if (!t.due_time) continue;
      const key = partOf(timeToMinutes(t.due_time));
      const entry = parts.get(key) ?? { done: 0, total: 0 };
      entry.total++;
      if (t.status === "done") entry.done++;
      parts.set(key, entry);
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
  }

  // Session length: what they finish, and how long things really take
  const doneLengths = done.filter((t) => t.estimated_duration || t.end_time).map(taskMinutes).sort((a, b) => a - b);
  if (doneLengths.length >= 4) {
    insights.push({
      key: "session",
      text: `Usually completes sessions of about ${doneLengths[Math.floor(doneLengths.length / 2)]} minutes.`,
    });
  }
  const timed = tasks.filter((t) => {
    if (!t.started_at || !t.completed_at || !t.estimated_duration) return false;
    const minutes = (Date.parse(t.completed_at) - Date.parse(t.started_at)) / 60_000;
    return minutes >= 5 && minutes <= 6 * 60;
  });
  if (timed.length >= 4) {
    const ratios = timed
      .map((t) => (Date.parse(t.completed_at!) - Date.parse(t.started_at!)) / 60_000 / t.estimated_duration!)
      .sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    if (median >= 1.25 || median <= 0.75) {
      insights.push({
        key: "estimates",
        text: `Tasks usually take about ${Math.round(median * 100)}% of the planned time. ${
          median > 1 ? "Plan longer sessions." : "Sessions can be shorter."
        }`,
      });
    }
  }
  const long = past.filter((t) => (t.estimated_duration || t.end_time) && taskMinutes(t) >= 90);
  const longDone = long.filter((t) => t.status === "done").length;
  if (long.length >= 3 && rate(longDone, long.length) < 40) {
    insights.push({
      key: "long",
      text: `Often doesn't finish long tasks of 90+ minutes (${longDone} of ${long.length}). Split big work into shorter sessions.`,
    });
  }

  // Postponing and skipping, from the event log (the user's own moves only)
  const recentEvents = events.filter((e) => e.created_at.slice(0, 10) >= from && e.source !== "system");
  const postponed = recentEvents.filter(
    (e) => e.type === "moved" && e.from_date && e.to_date && e.to_date > e.from_date
  ).length;
  const skipped = recentEvents.filter((e) => e.type === "skipped").length;
  // (routine sessions are created weeks ahead automatically: not planning decisions)
  const created = recentEvents.filter((e) => e.type === "created" && !e.series_id).length;
  if (recentEvents.length && created + postponed >= 6 && rate(postponed + skipped, created + postponed) >= 30) {
    insights.push({
      key: "postpone",
      text: `Moved ${postponed} and skipped ${skipped} tasks in the last month. Plan fewer tasks per day and leave buffer time.`,
    });
  }

  // Finishing late: completed after the day it was planned for
  const late = done.filter((t) => {
    const d = doneDate(t, timeZone);
    return d && t.due_date && d > t.due_date;
  }).length;
  if (done.length >= 6 && rate(late, done.length) >= 40) {
    insights.push({
      key: "late",
      text: `Finishes ${rate(late, done.length)}% of tasks after their planned day. Deadlines need a few days of buffer.`,
    });
  }

  // Daily throughput over the last 14 days
  const twoWeeks = addDays(today, -14);
  const doneDays = tasks
    .filter((t) => !t.parent_id)
    .map((t) => doneDate(t, timeZone))
    .filter((d): d is string => !!d && d >= twoWeeks && d < today);
  const activeDays = new Set(doneDays).size;
  if (activeDays >= 3) {
    const perDay = Math.round((doneDays.length / activeDays) * 10) / 10;
    insights.push({
      key: "throughput",
      text: `On active days, completes about ${perDay} task${perDay === 1 ? "" : "s"}.`,
    });
  }

  // Missed tasks overall
  const missed = past.filter((t) => t.status !== "done" && t.status !== "skipped").length;
  if (past.length >= 8 && rate(done.length, past.length) < 50) {
    insights.push({
      key: "completion",
      text: `Completed ${done.length} of ${past.length} past tasks (${missed} still open). Schedules should be lighter and more realistic.`,
    });
  }

  return insights;
}

// ---------------------------------------------------------------- balance

export type Balance = { role: Role; minutes: number; share: number; target: number | null }[];

// Time spent per role in a date range (done tasks), against the intended split
export function roleBalance(
  areas: Area[],
  tasks: Task[],
  from: string,
  to: string,
  targets: Partial<Record<Role, number>> = {},
  timeZone = "UTC"
): Balance {
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const minutes = new Map<Role, number>();
  for (const t of tasks) {
    if (t.parent_id) continue;
    const d = doneDate(t, timeZone);
    if (!d || d < from || d > to) continue;
    const role = (t.project_id && areaById.get(t.project_id)?.role) || null;
    if (!role) continue;
    minutes.set(role, (minutes.get(role) ?? 0) + taskMinutes(t));
  }
  const total = [...minutes.values()].reduce((a, b) => a + b, 0);
  const roles = new Set<Role>([...minutes.keys(), ...(Object.keys(targets) as Role[])]);
  return [...roles]
    .map((role) => ({
      role,
      minutes: minutes.get(role) ?? 0,
      share: total ? Math.round(((minutes.get(role) ?? 0) / total) * 100) : 0,
      target: targets[role] ?? null,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}
