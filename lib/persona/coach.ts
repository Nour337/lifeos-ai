import { AIError } from "@/lib/ai/planDay";
import { askJSON } from "@/lib/ai/openai";
import { describeAreas, describePersona, styleInstruction } from "@/lib/persona/describe";
import { taskMinutes, type Area } from "@/lib/persona/insights";
import type { PersonaData } from "@/lib/persona/server";
import type {
  AreaProgress,
  NowResult,
  NowStep,
  Suggestion,
  WeeklyReview,
} from "@/lib/persona/types";
import { blocksOn, cleanText, newId } from "@/types/persona";
import { addDays, timeToMinutes } from "@/utils/date";
import type { Task, TaskPriority } from "@/types/task";

// Suggestions, "What should I do now?" / "I have free time", and the weekly
// review. The numbers are computed here; the AI only chooses and explains.

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const clampMinutes = (v: unknown, fallback = 30) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 ? Math.min(n, 240) : fallback;
};
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

function areaRef(areas: Area[], ref: unknown): Area | null {
  const match = /^a(\d+)$/.exec(String(ref ?? ""));
  return match ? areas[Number(match[1]) - 1] ?? null : null;
}

function areaLink(area: Area | null) {
  return {
    projectId: area?.type === "project" ? area.id : null,
    goalId: area?.type === "goal" ? area.id : null,
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

function context(data: PersonaData, today: string, localTime: string): string {
  return `Today is ${today}, local time ${localTime}.

About the user:
${describePersona(data.profile, data.insights)}

Their areas (courses, work, goals) with facts:
${describeAreas(data.areas)}

Today's schedule:
${todaysSchedule(data.tasks, today)}`;
}

const system = (data: PersonaData, role: string) =>
  `${role} ${styleInstruction(data.profile)} Base everything ONLY on the facts given; never invent courses, deadlines or numbers. Write in simple English. Answer with JSON only.`;

// ---------------------------------------------------------------- suggestions

export async function suggestTasks(
  data: PersonaData,
  today: string,
  localTime: string
): Promise<Suggestion[]> {
  const raw = (await askJSON(
    system(data, "You are the proactive planning coach inside LifeOS, an AI planner."),
    `${context(data, today, localTime)}

Suggest 3 to 5 useful tasks for today. Rules:
- Priority order: exams/deadlines coming soon; weekly time targets not met; areas not worked on for several days; missed work; goals; then learning their interests/skills.
- Link each suggestion to an area ref (a1, a2...) when it belongs to one; use null for interest/skill learning.
- Skip areas the user doesn't want AI help for. Avoid areas the user ignored 3+ times unless a deadline is under 7 days away.
- Don't repeat something already scheduled today, and don't suggest their recurring routines (gym, prayer...): those are already planned.
- Session length: follow what the user completes (see "learned" facts) and their session preference; 15-120 minutes.
- reason: max 14 words, concrete ("Your Database exam is in 7 days.").
- why: 1-2 sentences explaining with the real numbers (days left, sessions this week, last session, progress).

JSON: {"suggestions": [{"title": "...", "minutes": 45, "emoji": "📚", "area": "a1" | null, "priority": "low|medium|high", "reason": "...", "why": "..."}]}`,
    1500
  )) as { suggestions?: unknown };

  const suggestions = list(raw?.suggestions)
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
        priority: PRIORITIES.includes(s.priority as TaskPriority) ? (s.priority as TaskPriority) : "medium",
        ...areaLink(area),
      };
    })
    .filter((s): s is Suggestion => !!s)
    .slice(0, 5);

  if (!suggestions.length) throw new AIError("The AI couldn't come up with suggestions. Try again.", 502);
  return suggestions;
}

// ---------------------------------------------------------------- now / free time

// Minutes from now until the next timed task today (or bedtime), capped.
export function freeWindow(data: PersonaData, today: string, localTime: string): number {
  const now = timeToMinutes(localTime);
  const sleep = data.profile.ai_profile.schedule.sleep;
  let end = sleep && timeToMinutes(sleep) > now ? timeToMinutes(sleep) - 30 : 23 * 60 + 30;
  for (const t of data.tasks) {
    if (t.due_date !== today || !t.due_time || t.status === "done" || t.status === "skipped") continue;
    const start = timeToMinutes(t.due_time);
    if (start > now && start < end) end = start;
  }
  // Work / university later today also ends the free window
  for (const b of blocksOn(data.profile.ai_profile.blocks, today)) {
    const start = timeToMinutes(b.start);
    if (start > now && start < end) end = start;
  }
  return Math.max(0, Math.min(end - now, 180));
}

export async function planNow(
  data: PersonaData,
  today: string,
  localTime: string,
  requestedMinutes: number | null,
  exclude: string[]
): Promise<NowResult> {
  // At least 15 minutes, so there's always something useful to suggest
  const minutes = Math.max(requestedMinutes ?? freeWindow(data, today, localTime), 15);
  const freeTime = requestedMinutes !== null;

  // Tasks the plan may use: recent overdue, today's untimed, the next 7
  // days, undated. Today's timed tasks are appointments at a fixed time, so
  // they are never "done now".
  const horizon = addDays(today, 7);
  const candidates = data.tasks
    .filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "skipped" &&
        !(t.due_date === today && t.due_time) &&
        (!t.due_date || (t.due_date >= addDays(today, -14) && t.due_date <= horizon))
    )
    .slice(0, 40);
  const taskLines = candidates
    .map(
      (t, i) =>
        `[t${i + 1}] "${t.title}" ${t.due_date ? (t.due_date < today ? `OVERDUE since ${t.due_date}${t.due_time ? ` (was at ${hhmm(t.due_time)})` : ""}` : t.due_date === today ? "today, any time" : `due ${t.due_date}`) : "no date"}, priority ${t.priority}, ${taskMinutes(t)} min`
    )
    .join("\n");

  const nowMinutes = timeToMinutes(localTime);
  const nextFixed = data.tasks
    .filter(
      (t) =>
        t.due_date === today &&
        t.due_time &&
        t.status !== "done" &&
        t.status !== "skipped" &&
        timeToMinutes(t.due_time) > nowMinutes
    )
    .sort((a, b) => a.due_time!.localeCompare(b.due_time!))[0];

  const raw = (await askJSON(
    system(data, "You are the focus coach inside LifeOS. The user asked what to do right now."),
    `${context(data, today, localTime)}

Open tasks:
${taskLines || "(none)"}

The user has ${minutes} minutes ${freeTime ? "of free time, starting now" : "free right now"}.${
      !freeTime && nextFixed
        ? ` Their next fixed appointment is "${nextFixed.title}" at ${hhmm(nextFixed.due_time)}; the plan must end before it and must NOT include it.`
        : ""
    }
${exclude.length ? `They don't want these right now: ${exclude.join("; ")}.` : ""}

Make a plan for this time: 1-4 steps that fit in ${minutes} minutes in total (including breaks). Use existing tasks (by ref) when they fit, otherwise create new useful steps linked to an area (a1...). Put the most important and urgent work first (exams and deadlines soon, weekly targets not met); add a short break (5-10 min) between focus blocks over 45 minutes. Follow the user's preferred session length and learned behaviour. Don't pick things that only make sense at another time of day (e.g. a morning run in the evening) and don't pick their routines (gym etc.).
${freeTime ? "Also give 3 different single-activity options (each one work session that could fill most of the time) so the user can choose." : "options must be an empty list."}
message: 2-3 short sentences, e.g. "You have 90 minutes free. I recommend Database revision then your graduation project. This moves two important goals forward."
Each reason: max 12 words.
Steps have type "work" or "break". A break's title is just "Break".

JSON: {"message": "...", "plan": [{"type": "work", "task": "t3" | null, "area": "a1" | null, "title": "...", "minutes": 45, "reason": "..."}, {"type": "break", "title": "Break", "minutes": 10}], "options": [{"task": "t2" | null, "area": "a2" | null, "title": "...", "minutes": 60, "reason": "..."}]}`,
    1400
  )) as { message?: unknown; plan?: unknown; options?: unknown };

  const toStep = (s: Record<string, unknown>): NowStep | null => {
    const match = /^t(\d+)$/.exec(String(s.task ?? ""));
    const task = match ? candidates[Number(match[1]) - 1] : undefined;
    const isBreak = s.type === "break";
    const title = isBreak ? "Break" : cleanText(s.title, 120) ?? task?.title;
    if (!title) return null;
    const area = areaRef(data.areas, s.area);
    return {
      taskId: isBreak ? null : task?.id ?? null,
      title: isBreak ? title : task?.title ?? title,
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
  const byId = (id: string | null) => (id ? data.areas.find((a) => a.id === id) ?? null : null);
  return (
    byId(task.project_id) ??
    byId(task.goal_id) ??
    (task.category
      ? data.areas.find((a) => a.name.toLowerCase() === task.category!.toLowerCase()) ?? null
      : null)
  );
}

function kindLabel(area: Area | null, task: Task): string {
  if (!area) return task.category ? `${task.category} tasks` : "other tasks";
  if (area.kind === "course") return "study sessions";
  if (area.type === "goal") return "goal sessions";
  return "project sessions";
}

export function weeklyStats(
  data: PersonaData,
  weekStart: string,
  today: string,
  previous: AreaProgress[] | null
): WeeklyReview["stats"] {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = data.tasks.filter((t) => t.due_date && t.due_date >= weekStart && t.due_date <= weekEnd);
  const done = inWeek.filter((t) => t.status === "done");

  const byKind = new Map<string, number>();
  const byArea = new Map<string, { count: number; minutes: number }>();
  for (const t of done) {
    const area = areaOfTask(t, data);
    const label = kindLabel(area, t);
    byKind.set(label, (byKind.get(label) ?? 0) + 1);
    const name = area?.name ?? t.category ?? "Other";
    const entry = byArea.get(name) ?? { count: 0, minutes: 0 };
    entry.count++;
    entry.minutes += taskMinutes(t);
    byArea.set(name, entry);
  }

  const missed = inWeek
    .filter((t) => t.status === "skipped" || (t.status !== "done" && t.due_date! < today))
    .map((t) => ({ title: t.title, date: t.due_date!, area: areaOfTask(t, data)?.name ?? null }))
    .slice(0, 20);

  const before = new Map((previous ?? []).map((p) => [p.id, p.now]));
  const progress: AreaProgress[] = data.areas.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    now: a.progress,
    before: before.get(a.id) ?? null,
  }));

  return {
    completed: done.length,
    planned: inWeek.filter((t) => t.status !== "skipped").length,
    minutes: done.reduce((sum, t) => sum + taskMinutes(t), 0),
    byKind: [...byKind].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    byArea: [...byArea]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.minutes - a.minutes),
    missed,
    progress,
  };
}

export async function reviewWeek(
  data: PersonaData,
  weekStart: string,
  today: string,
  localTime: string,
  previous: AreaProgress[] | null
): Promise<WeeklyReview> {
  const stats = weeklyStats(data, weekStart, today, previous);
  const weekEnd = addDays(weekStart, 6);

  const raw = (await askJSON(
    system(data, "You are the weekly review coach inside LifeOS."),
    `${context(data, today, localTime)}

Week reviewed: ${weekStart} to ${weekEnd}.
Completed ${stats.completed} of ${stats.planned} planned tasks (${stats.minutes} minutes).
By type: ${stats.byKind.map((k) => `${k.count} ${k.label}`).join(", ") || "nothing completed"}.
By area: ${stats.byArea.map((a) => `${a.name}: ${a.count} sessions, ${a.minutes} min`).join("; ") || "none"}.
Missed or skipped: ${stats.missed.map((m) => `${m.title} (${m.date})`).join("; ") || "none"}.
Progress (user's estimate): ${stats.progress.map((p) => `${p.name}: ${p.before !== null ? `${p.before}% → ` : ""}${p.now}%`).join("; ") || "none"}.

Write the review:
- headline: one encouraging, honest sentence about the week.
- highlights: 2-3 short things that went well (use real numbers).
- suggestions: 2-4 concrete recommendations for next week, e.g. "Give more time to Database: your exam is in 9 days." or "Your project is going well. Keep 3 sessions next week."

JSON: {"headline": "...", "highlights": ["..."], "suggestions": ["..."]}`,
    900
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

