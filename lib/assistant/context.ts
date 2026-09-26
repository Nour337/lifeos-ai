import type { SupabaseClient } from "@supabase/supabase-js";
import { describePattern } from "@/lib/assistant/patterns";
import { areaLine, describePersona, styleInstruction } from "@/lib/persona/describe";
import type { PersonaData } from "@/lib/persona/server";
import { blockIntervals, loadOf, scheduleInput, type ScheduleInput } from "@/lib/schedule";
import { addDays, minutesToTime, weekdayShort } from "@/utils/date";
import { kindOf, type Project } from "@/types/project";
import type { Goal } from "@/types/goal";
import { normalizeTask, type Series, type Task } from "@/types/task";

// What the assistant sees. Always: the persona, the user's areas, a 14-day
// calendar with busy hours and load, and tasks from the recent past to the
// coming week. Anything else (a date months away, an old task) it looks up
// with the read tools below, so a message never carries the whole database.

export const CALENDAR_DAYS = 14;
const TASK_DAYS_AHEAD = 7;

export type Context = {
  supabase: SupabaseClient;
  data: PersonaData;
  today: string;
  localTime: string;
  input: ScheduleInput; // scheduling view of all loaded tasks
  // short references the AI uses ("t3") <-> real rows
  taskRef: Map<string, Task>;
  goalRef: Map<string, Goal>;
  projectRef: Map<string, Project>;
  seriesRef: Map<string, Series>;
};

export function buildContext(supabase: SupabaseClient, data: PersonaData): Context {
  const { today, localTime } = data.clock;
  const ctx: Context = {
    supabase,
    data,
    today,
    localTime,
    input: scheduleInput(data.profile.ai_profile, data.tasks),
    taskRef: new Map(),
    goalRef: new Map(),
    projectRef: new Map(),
    seriesRef: new Map(),
  };
  data.goals.forEach((g, i) => ctx.goalRef.set(`g${i + 1}`, g));
  data.projects.forEach((p, i) => ctx.projectRef.set(`p${i + 1}`, p));
  data.series.forEach((s, i) => ctx.seriesRef.set(`s${i + 1}`, s));

  // In the prompt: overdue open tasks (last 5 weeks), today to a week ahead,
  // and open tasks with no date
  const horizon = addDays(today, TASK_DAYS_AHEAD);
  const shown = data.tasks
    .filter((t) =>
      t.due_date
        ? (t.due_date >= today && t.due_date <= horizon) ||
          (t.due_date < today && t.status !== "done" && t.status !== "skipped")
        : true
    )
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || (a.due_time ?? "99").localeCompare(b.due_time ?? "99"))
    .slice(0, 150);
  shown.forEach((t) => refFor(ctx, t));
  return ctx;
}

// The reference of a task, adding it when a tool found it
export function refFor(ctx: Context, task: Task): string {
  for (const [ref, t] of ctx.taskRef) if (t.id === task.id) return ref;
  const ref = `t${ctx.taskRef.size + 1}`;
  ctx.taskRef.set(ref, task);
  return ref;
}

function refOf<T extends { id: string }>(map: Map<string, T>, id: string | null): string | null {
  if (!id) return null;
  for (const [ref, item] of map) if (item.id === id) return ref;
  return null;
}

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

export function taskLine(ctx: Context, ref: string, t: Task): string {
  const when = t.due_date
    ? `${t.due_date} ${weekdayShort(t.due_date)}${t.due_time ? ` ${hhmm(t.due_time)}${t.end_time ? `-${hhmm(t.end_time)}` : ""}` : ""}`
    : "no date";
  const extra = [
    `status=${t.status}`,
    `priority=${t.priority}`,
    t.estimated_duration ? `${t.estimated_duration}min` : null,
    t.is_fixed ? "FIXED" : null,
    t.energy ? `energy=${t.energy}` : null,
    t.category ? `category=${t.category}` : null,
    t.project_id ? `project=[${refOf(ctx.projectRef, t.project_id)}]` : null,
    t.goal_id ? `goal=[${refOf(ctx.goalRef, t.goal_id)}]` : null,
    t.series_id ? `routine=[${refOf(ctx.seriesRef, t.series_id)}]` : null,
  ].filter(Boolean);
  return `[${ref}] ${when} "${t.title}" ${extra.join(" ")}`;
}

// One calendar line: weekday, busy hours, and how full the day is
function dayLine(ctx: Context, date: string): string {
  const busy = blockIntervals(ctx.input, date)
    .map((b) => `${b.label} ${minutesToTime(b.start)}-${b.end >= 1440 ? "24:00" : minutesToTime(b.end)}`)
    .join(", ");
  const load = loadOf(ctx.input, date);
  const loadText =
    load.capacity === 0 && (ctx.data.profile.ai_profile.schedule.rest_days ?? []).length
      ? "REST DAY"
      : `planned ${load.planned}/${load.capacity} min${load.over ? " OVERLOADED" : ""}`;
  return `${date} ${weekdayShort(date)}${busy ? ` [busy: ${busy}]` : ""} (${loadText})`;
}

export function describeContext(ctx: Context): string {
  const { data } = ctx;
  const calendar = Array.from({ length: CALENDAR_DAYS }, (_, i) => dayLine(ctx, addDays(ctx.today, i))).join("\n");

  const areaByProject = new Map(data.areas.map((a) => [a.id, a]));
  const projectLines = [...ctx.projectRef]
    .map(([ref, p]) => {
      const goal = refOf(ctx.goalRef, p.goal_id);
      if (p.kind === "milestone") {
        return `[${ref}] Milestone: ${p.name}${p.deadline ? ` (due ${p.deadline})` : ""}${goal ? ` of goal [${goal}]` : ""}`;
      }
      const area = areaByProject.get(p.id);
      return `[${ref}] ${area ? areaLine(area) : `${kindOf(p.kind).label}: ${p.name}`}${goal ? ` goal=[${goal}]` : ""}`;
    })
    .join("\n");

  const goalLines = [...ctx.goalRef]
    .map(([ref, g]) => {
      const area = areaByProject.get(g.id);
      return `[${ref}] ${area ? areaLine(area) : g.name}`;
    })
    .join("\n");

  const assessmentLines = data.assessments
    .filter((a) => !a.done && a.due_date >= ctx.today)
    .slice(0, 30)
    .map((a) => `${a.due_date}${a.due_time ? ` ${hhmm(a.due_time)}` : ""} ${a.title} (${a.type}${a.weight ? `, ${a.weight}%` : ""}) course=[${refOf(ctx.projectRef, a.project_id)}]`)
    .join("\n");

  const seriesLines = [...ctx.seriesRef]
    .filter(([, s]) => !s.until || s.until >= ctx.today)
    .map(
      ([ref, s]) =>
        `[${ref}] ${s.is_routine ? "Routine" : "Repeating task"}: "${s.title}" ${describePattern(s.pattern)}${
          s.due_time ? ` at ${hhmm(s.due_time)}` : ""
        }${s.estimated_duration ? `, ${s.estimated_duration} min` : ""}${s.until ? `, until ${s.until}` : ""}`
    )
    .join("\n");

  const taskLines = [...ctx.taskRef].map(([ref, t]) => taskLine(ctx, ref, t)).join("\n");

  return [
    `Today is ${ctx.today} (${weekdayShort(ctx.today)}), local time ${ctx.localTime}, timezone ${data.clock.timeZone}.`,
    `\nAbout the user (their AI persona; use it for everything):\n${describePersona(data.profile, data.insights, data.series, ctx.today)}`,
    `\n- ${styleInstruction(data.profile)}`,
    `\nCalendar, next ${CALENDAR_DAYS} days (busy = fixed hours; planned/capacity = flexible work vs. what they can realistically do):\n${calendar}`,
    `\nGoals:\n${goalLines || "(none)"}`,
    `\nCourses, projects and milestones:\n${projectLines || "(none)"}`,
    `\nUpcoming exams and assignments:\n${assessmentLines || "(none)"}`,
    `\nRoutines and repeating tasks:\n${seriesLines || "(none)"}`,
    `\nTasks (overdue, today to ${addDays(ctx.today, TASK_DAYS_AHEAD)}, and undated). Use find_tasks for anything else:\n${taskLines || "(none)"}`,
  ].join("\n");
}

// ---------------------------------------------------------------- read tools

export const READ_TOOLS = [
  {
    type: "function",
    function: {
      name: "find_tasks",
      description:
        "Search the user's tasks beyond what is listed (older, later, or by words). Returns tasks with refs you can use in propose_changes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words in the title (optional)" },
          from: { type: "string", description: "YYYY-MM-DD (optional)" },
          to: { type: "string", description: "YYYY-MM-DD (optional)" },
          status: { type: "string", enum: ["open", "done", "any"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_days",
      description:
        "Weekday, busy hours, load and tasks for a range of dates (e.g. far in the future). Max 31 days.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["from", "to"],
      },
    },
  },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Runs a read tool and returns its text result
export async function runReadTool(ctx: Context, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "find_tasks") {
    let query = ctx.supabase.from("tasks").select("*").is("parent_id", null).limit(40);
    const q = typeof args.query === "string" ? args.query.trim().slice(0, 60) : "";
    if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
    if (typeof args.from === "string" && DATE.test(args.from)) query = query.gte("due_date", args.from);
    if (typeof args.to === "string" && DATE.test(args.to)) query = query.lte("due_date", args.to);
    if (args.status === "open") query = query.not("status", "in", "(done,skipped)");
    if (args.status === "done") query = query.eq("status", "done");
    const { data, error } = await query.order("due_date", { ascending: true, nullsFirst: false });
    if (error) return "Search failed.";
    const tasks = (data ?? []).map((t) => normalizeTask(t as Task));
    if (!tasks.length) return "No tasks found.";
    return tasks.map((t) => taskLine(ctx, refFor(ctx, t), t)).join("\n");
  }

  if (name === "get_days") {
    const from = typeof args.from === "string" && DATE.test(args.from) ? args.from : ctx.today;
    let to = typeof args.to === "string" && DATE.test(args.to) ? args.to : from;
    if (to < from) to = from;
    if (addDays(from, 30) < to) to = addDays(from, 30);
    const { data } = await ctx.supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .gte("due_date", from)
      .lte("due_date", to)
      .order("due_date")
      .limit(200);
    const tasks = (data ?? []).map((t) => normalizeTask(t as Task));
    // Include these tasks in load and conflict checks
    const known = new Set(ctx.input.tasks.map((t) => t.id));
    ctx.input.tasks = [...ctx.input.tasks, ...tasks.filter((t) => !known.has(t.id))];
    const lines: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      lines.push(dayLine(ctx, date));
      for (const t of tasks.filter((x) => x.due_date === date)) lines.push(`  ${taskLine(ctx, refFor(ctx, t), t)}`);
    }
    return lines.join("\n");
  }

  return "Unknown tool.";
}
