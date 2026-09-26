import { AIError } from "@/lib/ai/server";
import { completeJSON } from "@/lib/ai/llm";
import type { Meter } from "@/lib/ai/usage";
import { areaLine, describePersona, styleInstruction } from "@/lib/persona/describe";
import { doneDate, roleBalance, type Area } from "@/lib/persona/insights";
import type { PersonaData } from "@/lib/persona/server";
import type { AreaProgress, NowResult, NowStep, Suggestion, SuggestionSet, WeeklyReview } from "@/lib/persona/types";
import { busyIntervals, dayWindow, loadOf, scheduleInput, taskMinutes } from "@/lib/schedule";
import { cleanText, newId } from "@/types/persona";
import { addDays, minutesToTime, timeToMinutes } from "@/utils/date";
import { isOpen, PRIORITIES, type Task, type TaskPriority } from "@/types/task";

// Suggestions, "What should I do now?" / "I have free time", the weekly
// review and task steps. The numbers and the choice of what matters are
// computed here; the AI only words and explains them.

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const clampMinutes = (v: unknown, fallback = 30) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 ? Math.min(n, 240) : fallback;
};
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
const priorityOf = (v: unknown): TaskPriority => (PRIORITIES.includes(v as TaskPriority) ? (v as TaskPriority) : "medium");

function areaRef(areas: Area[], ref: unknown): Area | null {
  const match = /^a(\d+)$/.exec(String(ref ?? ""));
  return match ? areas[Number(match[1]) - 1] ?? null : null;
}

function areaLink(area: Area | null) {
  return {
    projectId: area?.type === "project" ? area.id : null,
    goalId: area?.type === "goal" ? area.id : null,
    areaId: area?.id ?? null,
    area: area?.name ?? null,
  };
}

function todaysSchedule(tasks: Task[], today: string): string {
  const todays = tasks
    .filter((t) => t.due_date === today)
    .sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
  if (!todays.length) return "Nothing scheduled today.";
  return todays
    .map(
      (t) =>
        `- ${t.due_time ? `${hhmm(t.due_time)}${t.end_time ? `-${hhmm(t.end_time)}` : ""}` : "anytime"} "${t.title}" (${t.status}, ${taskMinutes(t)} min)`
    )
    .join("\n");
}

function about(data: PersonaData): string {
  const { today, localTime } = data.clock;
  return `Today is ${today}, local time ${localTime}.

About the user:
${describePersona(data.profile, data.insights, data.series, today)}

Today's schedule:
${todaysSchedule(data.tasks, today)}`;
}

const system = (data: PersonaData, role: string) =>
  `${role} ${styleInstruction(data.profile)} Base everything ONLY on the facts given; never invent courses, deadlines or numbers. Write simply${
    data.profile.ai_profile.preferences.language ? `, in ${data.profile.ai_profile.preferences.language}` : ""
  }. Answer with JSON only.`;

// ---------------------------------------------------------------- suggestions

const IMPORTANCE_POINTS = { very_high: 15, high: 10, medium: 5, low: 0 } as const;

// How much an area needs attention now. Deadlines dominate; then weekly
// time targets not met, neglect, importance. Ignored suggestions count
// against it (less over time), unless a deadline is close.
export function scoreArea(area: Area): number {
  if (!area.aiHelp) return -1;
  let score = 0;
  const closeDeadline = area.daysLeft !== null && area.daysLeft >= 0 && area.daysLeft <= 7;
  if (area.daysLeft !== null && area.daysLeft >= 0) score += Math.max(0, 40 - area.daysLeft * 2.5);
  if (area.weeklyTargetMinutes) {
    const gap = area.weeklyTargetMinutes - area.minutesLast7;
    if (gap > 0) score += Math.min(25, (gap / area.weeklyTargetMinutes) * 25);
  }
  if (area.daysSinceLast === null) score += area.openTasks || area.deadline ? 8 : 2;
  else score += Math.min(15, area.daysSinceLast * 2);
  score += area.importance ? IMPORTANCE_POINTS[area.importance] : 3;
  if (area.suggestionsAccepted >= 2) score += (area.suggestionsDone / area.suggestionsAccepted) * 5;
  if (!closeDeadline) score -= area.ignored * 8;
  if (area.progress >= 100 && !closeDeadline) score -= 20;
  return Math.round(score * 10) / 10;
}

// What the day's suggestions depend on: when this changes, they're made again
export function suggestionHash(data: PersonaData): string {
  const p = data.profile.ai_profile;
  const parts = [
    ...data.areas.map((a) => `${a.id}:${a.deadline}:${a.importance}:${a.aiHelp}:${a.weeklyTargetMinutes}`),
    p.interests.join(","),
    p.skills.map((s) => `${s.name}:${s.status}`).join(","),
  ].join("|");
  let hash = 0;
  for (let i = 0; i < parts.length; i++) hash = (hash * 31 + parts.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

const RECOVERY_BACKLOG = 5;

// Overdue backlog is high: catch up before adding anything new (no AI)
export function recoverySet(data: PersonaData): SuggestionSet | null {
  const items = recoverySuggestions(data);
  return items ? { day: data.clock.today, items, handled: [], recovery: true } : null;
}

function recoverySuggestions(data: PersonaData): Suggestion[] | null {
  const { today } = data.clock;
  const overdue = data.tasks.filter(
    (t) => isOpen(t) && t.due_date && t.due_date < today && !t.series_id && !t.parent_id
  );
  if (overdue.length < RECOVERY_BACKLOG) return null;
  const scores = new Map(data.areas.map((a) => [a.id, scoreArea(a)]));
  const rank = (t: Task) =>
    PRIORITIES.indexOf(t.priority) * 10 + (scores.get(t.project_id ?? t.goal_id ?? "") ?? 0);
  return overdue
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 4)
    .map((t) => {
      const area = data.areas.find((a) => a.id === t.project_id || a.id === t.goal_id) ?? null;
      return {
        id: newId(),
        title: t.title,
        minutes: taskMinutes(t),
        emoji: "⏰",
        reason: `Overdue since ${t.due_date}${area ? ` · ${area.name}` : ""}`,
        why: `You have ${overdue.length} overdue tasks. Catching up on the important ones first keeps your plan realistic before adding new work.`,
        priority: t.priority,
        energy: t.energy,
        ...areaLink(area),
        kind: "recover" as const,
        taskId: t.id,
      };
    });
}

// New ideas from the highest-scoring areas (uses the AI)
export async function suggestTasks(data: PersonaData, meter: Meter): Promise<SuggestionSet> {
  const { today } = data.clock;
  const input = scheduleInput(data.profile.ai_profile, data.tasks);
  const load = loadOf(input, today);
  const room = Math.max(0, load.capacity - load.planned);
  const ranked = data.areas
    .map((a, i) => ({ area: a, ref: `a${i + 1}`, score: scoreArea(a) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const learning = data.profile.ai_profile.skills.filter((s) => s.status !== "have").map((s) => s.name);

  const raw = (await completeJSON(
    system(data, "You are the proactive planning coach inside LifeOS, an AI planner."),
    `${about(data)}

The areas that need attention most, highest first (the app ranked them by deadlines, weekly targets, neglect and importance):
${ranked.map((c) => `[${c.ref}] score ${c.score}: ${areaLine(c.area)}`).join("\n") || "(none)"}
${learning.length ? `Skills they're learning or want to learn: ${learning.join(", ")}` : ""}

Room left today: about ${room} minutes of realistic work${load.over ? " (today is already overloaded: suggest short things or things for later)" : ""}.

Suggest 3 to 5 useful tasks for today, mostly from the top areas (in that order); at most one may be for a skill they want to learn (area null). Rules:
- Don't repeat something already scheduled today, and don't suggest their routines (already on the calendar).
- Session length: follow what the user completes (see "learned" facts), their default durations and session preference; 15-120 minutes. Together they should fit the room left today.
- reason: max 14 words, concrete ("Your Database midterm is in 7 days.").
- why: 1-2 sentences explaining with the real numbers (days left, minutes this week vs target, last session).
- energy: "deep" for focus work, "light" for small tasks.

JSON: {"suggestions": [{"title": "...", "minutes": 45, "emoji": "📚", "area": "a1" | null, "priority": "low|medium|high|very_high", "energy": "deep|light", "reason": "...", "why": "..."}]}`,
    { maxTokens: 1500, meter }
  )) as { suggestions?: unknown };

  const items = list(raw?.suggestions)
    .map((s): Suggestion | null => {
      const title = cleanText(s.title, 120);
      if (!title) return null;
      const area = areaRef(data.areas, s.area);
      return {
        id: newId(),
        title,
        minutes: clampMinutes(s.minutes, 45),
        emoji: cleanText(s.emoji, 8) ?? "✨",
        reason: cleanText(s.reason, 160) ?? "",
        why: cleanText(s.why, 500) ?? "",
        priority: priorityOf(s.priority),
        energy: s.energy === "deep" || s.energy === "light" ? s.energy : null,
        ...areaLink(area),
        kind: "new",
        taskId: null,
      };
    })
    .filter((s): s is Suggestion => !!s)
    .slice(0, 5);

  if (!items.length) throw new AIError("The AI couldn't come up with suggestions. Try again.", 502);
  return { day: today, items, handled: [], recovery: false };
}

// ---------------------------------------------------------------- now / free time

// Minutes from now until the next busy thing today (or bedtime), capped
export function freeWindow(data: PersonaData): number {
  const { today, localTime } = data.clock;
  const now = timeToMinutes(localTime);
  const input = scheduleInput(data.profile.ai_profile, data.tasks);
  let end = Math.max(dayWindow(input.schedule).end, now);
  for (const b of busyIntervals(input, today)) {
    if (b.start > now && b.start < end) end = b.start;
    if (b.start <= now && b.end > now && !b.taskId) end = now; // inside work / class now
  }
  return Math.max(0, Math.min(end - now, 180));
}

export async function planNow(
  data: PersonaData,
  requestedMinutes: number | null,
  exclude: string[],
  meter: Meter
): Promise<NowResult> {
  const { today, localTime } = data.clock;
  // At least 15 minutes, so there's always something useful to suggest
  const minutes = Math.max(requestedMinutes ?? freeWindow(data), 15);
  const freeTime = requestedMinutes !== null;

  // Tasks the plan may use: recent overdue, today's untimed, the next 7
  // days, undated. Timed tasks today and fixed ones are appointments.
  const horizon = addDays(today, 7);
  const candidates = data.tasks
    .filter(
      (t) =>
        isOpen(t) &&
        !t.is_fixed &&
        !t.series_id &&
        !(t.due_date === today && t.due_time) &&
        (!t.due_date || (t.due_date >= addDays(today, -14) && t.due_date <= horizon))
    )
    .slice(0, 40);
  const taskLines = candidates
    .map(
      (t, i) =>
        `[t${i + 1}] "${t.title}" ${
          t.due_date
            ? t.due_date < today
              ? `OVERDUE since ${t.due_date}`
              : t.due_date === today
                ? "today, any time"
                : `due ${t.due_date}`
            : "no date"
        }, priority ${t.priority}, ${taskMinutes(t)} min${t.energy ? `, ${t.energy} work` : ""}`
    )
    .join("\n");

  const nowMinutes = timeToMinutes(localTime);
  const nextBusy = busyIntervals(scheduleInput(data.profile.ai_profile, data.tasks), today).find(
    (b) => b.start > nowMinutes
  );

  const ranked = data.areas
    .map((a, i) => ({ area: a, ref: `a${i + 1}`, score: scoreArea(a) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const raw = (await completeJSON(
    system(data, "You are the focus coach inside LifeOS. The user asked what to do right now."),
    `${about(data)}

Areas that need attention most (ranked by the app):
${ranked.map((c) => `[${c.ref}] ${areaLine(c.area)}`).join("\n") || "(none)"}

Open tasks:
${taskLines || "(none)"}

The user has ${minutes} minutes ${freeTime ? "of free time, starting now" : "free right now"}.${
      !freeTime && nextBusy
        ? ` Next up: "${nextBusy.label}" at ${minutesToTime(nextBusy.start)}; the plan must end before it and must NOT include it.`
        : ""
    }
${exclude.length ? `They don't want these right now: ${exclude.join("; ")}.` : ""}

Make a plan for this time: 1-4 steps that fit in ${minutes} minutes in total (including breaks). Use existing tasks (by ref) when they fit, otherwise create new useful steps linked to an area (a1...). Most important and urgent first (overdue, exams and deadlines soon, weekly targets not met); match deep work to their best time of day. Add a short break (5-10 min) between focus blocks over 45 minutes. Follow their session length and learned behaviour. Don't pick things that only make sense at another time of day, and don't pick their routines.
${freeTime ? "Also give 3 different single-activity options (each one work session that could fill most of the time) so the user can choose." : "options must be an empty list."}
message: 2-3 short sentences, e.g. "You have 90 minutes free. I recommend Database revision then your graduation project. This moves two important goals forward."
Each reason: max 12 words.
Steps have type "work" or "break". A break's title is just "Break".

JSON: {"message": "...", "plan": [{"type": "work", "task": "t3" | null, "area": "a1" | null, "title": "...", "minutes": 45, "reason": "..."}, {"type": "break", "title": "Break", "minutes": 10}], "options": [{"task": "t2" | null, "area": "a2" | null, "title": "...", "minutes": 60, "reason": "..."}]}`,
    { maxTokens: 1400, meter }
  )) as { message?: unknown; plan?: unknown; options?: unknown };

  const toStep = (s: Record<string, unknown>): NowStep | null => {
    const match = /^t(\d+)$/.exec(String(s.task ?? ""));
    const task = match ? candidates[Number(match[1]) - 1] : undefined;
    const isBreak = s.type === "break";
    const title = isBreak ? "Break" : (cleanText(s.title, 120) ?? task?.title);
    if (!title) return null;
    const area = areaRef(data.areas, s.area);
    return {
      taskId: isBreak ? null : (task?.id ?? null),
      title: isBreak ? title : (task?.title ?? title),
      minutes: clampMinutes(s.minutes, isBreak ? 10 : 30),
      reason: cleanText(s.reason, 140) ?? "",
      isBreak,
      projectId: task?.project_id ?? areaLink(area).projectId,
      goalId: task?.goal_id ?? areaLink(area).goalId,
      area: area?.name ?? null,
    };
  };

  const plan = list(raw?.plan).map(toStep).filter((s): s is NowStep => !!s).slice(0, 6);
  const options = freeTime
    ? list(raw?.options)
        .map((s) => toStep({ ...s, type: "work" }))
        .filter((s): s is NowStep => !!s)
        .slice(0, 4)
    : [];
  if (!plan.length && !options.length) {
    throw new AIError("The AI couldn't make a plan. Try again.", 502);
  }
  return {
    minutes,
    message: cleanText(raw?.message, 600) ?? `You have ${minutes} minutes. Here's my suggestion.`,
    plan,
    options,
  };
}

// ---------------------------------------------------------------- weekly review

function areaOfTask(task: Task, data: PersonaData): Area | null {
  const byId = (id: string | null) => (id ? (data.areas.find((a) => a.id === id) ?? null) : null);
  const milestone = task.project_id ? data.projects.find((p) => p.id === task.project_id && p.kind === "milestone") : null;
  return (
    byId(milestone?.goal_id ?? task.project_id) ??
    byId(task.goal_id) ??
    (task.category ? (data.areas.find((a) => a.name.toLowerCase() === task.category!.toLowerCase()) ?? null) : null)
  );
}

function kindLabel(area: Area | null, task: Task): string {
  if (task.series_id) return "routine sessions";
  if (!area) return task.category ? `${task.category} tasks` : "other tasks";
  if (area.kind === "course") return "study sessions";
  if (area.type === "goal") return "goal sessions";
  return "project sessions";
}

export function weeklyStats(
  data: PersonaData,
  weekStart: string,
  previous: AreaProgress[] | null
): WeeklyReview["stats"] {
  const { today } = data.clock;
  const tz = data.profile.timezone;
  const weekEnd = addDays(weekStart, 6);
  const inWeek = data.tasks.filter((t) => t.due_date && t.due_date >= weekStart && t.due_date <= weekEnd);
  // Done this week = completed during the week (even if planned earlier)
  const done = data.tasks.filter((t) => {
    const d = doneDate(t, tz);
    return d && d >= weekStart && d <= weekEnd;
  });

  const byKind = new Map<string, number>();
  const byArea = new Map<string, { count: number; minutes: number }>();
  for (const t of done) {
    const area = areaOfTask(t, data);
    const label = kindLabel(area, t);
    byKind.set(label, (byKind.get(label) ?? 0) + 1);
    const name = area?.name ?? t.category ?? (t.series_id ? "Routines" : "Other");
    const entry = byArea.get(name) ?? { count: 0, minutes: 0 };
    entry.count++;
    entry.minutes += taskMinutes(t);
    byArea.set(name, entry);
  }

  const missed = inWeek
    .filter((t) => !t.series_id && (t.status === "skipped" || (isOpen(t) && t.due_date! < today)))
    .map((t) => ({ title: t.title, date: t.due_date!, area: areaOfTask(t, data)?.name ?? null }))
    .slice(0, 20);

  const moved = data.events.filter(
    (e) =>
      e.type === "moved" &&
      e.source !== "system" &&
      e.created_at.slice(0, 10) >= weekStart &&
      e.created_at.slice(0, 10) <= addDays(weekEnd, 1) &&
      e.from_date &&
      e.to_date &&
      e.to_date > e.from_date
  ).length;

  const routines = data.series
    .filter((s) => s.is_routine)
    .map((s) => {
      const sessions = inWeek.filter((t) => t.series_id === s.id && t.due_date! <= today);
      return { title: s.title, done: sessions.filter((t) => t.status === "done").length, total: sessions.length };
    })
    .filter((r) => r.total > 0);

  const before = new Map((previous ?? []).map((p) => [p.id, p.now]));
  const progress: AreaProgress[] = data.areas.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    now: a.progress,
    before: before.get(a.id) ?? null,
  }));

  const balance = roleBalance(
    data.areas,
    data.tasks,
    weekStart,
    weekEnd,
    data.profile.ai_profile.preferences.balance,
    tz
  );

  return {
    completed: done.length,
    planned: inWeek.filter((t) => t.status !== "skipped").length,
    minutes: done.reduce((sum, t) => sum + taskMinutes(t), 0),
    byKind: [...byKind].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    byArea: [...byArea].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.minutes - a.minutes),
    missed,
    moved,
    routines,
    progress,
    balance: balance.length ? balance : undefined,
  };
}

export async function reviewWeek(
  data: PersonaData,
  weekStart: string,
  previous: AreaProgress[] | null,
  meter: Meter
): Promise<WeeklyReview> {
  const stats = weeklyStats(data, weekStart, previous);
  const weekEnd = addDays(weekStart, 6);

  const raw = (await completeJSON(
    system(data, "You are the weekly review coach inside LifeOS."),
    `${about(data)}

Week reviewed: ${weekStart} to ${weekEnd}.
Completed ${stats.completed} of ${stats.planned} planned tasks (${stats.minutes} minutes).
By type: ${stats.byKind.map((k) => `${k.count} ${k.label}`).join(", ") || "nothing completed"}.
By area: ${stats.byArea.map((a) => `${a.name}: ${a.count} sessions, ${a.minutes} min`).join("; ") || "none"}.
Routines: ${stats.routines.map((r) => `${r.title} ${r.done}/${r.total}`).join("; ") || "none"}.
Missed or skipped: ${stats.missed.map((m) => `${m.title} (${m.date})`).join("; ") || "none"}.
Postponed ${stats.moved} times.
${stats.balance ? `Time per role: ${stats.balance.map((b) => `${b.role} ${b.share}%${b.target !== null ? ` (wanted ${b.target}%)` : ""}`).join(", ")}.` : ""}
Progress: ${stats.progress.map((p) => `${p.name}: ${p.before !== null ? `${p.before}% → ` : ""}${p.now}%`).join("; ") || "none"}.

Write the review:
- headline: one encouraging, honest sentence about the week.
- highlights: 2-3 short things that went well (use real numbers).
- suggestions: 2-4 concrete recommendations for next week, e.g. "Give more time to Database: your exam is in 9 days." or "Work took 70% of your time but you wanted 50%: protect two evenings for your business."

JSON: {"headline": "...", "highlights": ["..."], "suggestions": ["..."]}`,
    { maxTokens: 900, meter }
  )) as { headline?: unknown; highlights?: unknown; suggestions?: unknown };

  const strings = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((s) => cleanText(s, 240)).filter((s): s is string => !!s).slice(0, max);

  return {
    weekStart,
    weekEnd,
    stats,
    ai: {
      headline: cleanText(raw?.headline, 240) ?? "Here's how your week went.",
      highlights: strings(raw?.highlights, 4),
      suggestions: strings(raw?.suggestions, 5),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- steps

export async function breakIntoSteps(task: Task, data: PersonaData, meter: Meter): Promise<string[]> {
  const raw = (await completeJSON(
    system(
      data,
      "You help people start big tasks by breaking them into small, concrete next actions. Each step starts with a verb and takes 15-60 minutes."
    ),
    `Break this task into 3 to 6 steps: "${task.title}"${task.description ? ` — notes: ${task.description.slice(0, 300)}` : ""}${
      task.estimated_duration ? ` (about ${task.estimated_duration} min in total)` : ""
    }

JSON: {"steps": ["<step>", ...]}`,
    { maxTokens: 600, meter }
  )) as { steps?: unknown };
  const steps = (Array.isArray(raw?.steps) ? raw.steps : [])
    .map((s) => cleanText(s, 120))
    .filter((s): s is string => !!s)
    .slice(0, 8);
  if (!steps.length) throw new AIError("The AI couldn't split this task. Try again.", 502);
  return steps;
}
