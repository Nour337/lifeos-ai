import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError } from "@/lib/ai/planDay";
import { expandPattern, parsePattern, MAX_OCCURRENCES } from "@/lib/assistant/patterns";
import {
  addDays,
  minutesToTime,
  timeToMinutes,
} from "@/utils/date";
import type {
  ChatMessage,
  Conflict,
  DraftTask,
  Proposal,
  TaskChange,
} from "@/lib/assistant/types";
import type { Goal } from "@/types/goal";
import type { Project } from "@/types/project";
import type { Task, TaskPriority, TaskStatus } from "@/types/task";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// gpt-4.1-mini follows the tool-calling rules far more reliably than gpt-4o-mini
const DEFAULT_MODEL = "gpt-4.1-mini";
const HISTORY_LIMIT = 20;
const MAX_CREATES = 150;
const DEFAULT_MINUTES = 30; // assumed length of a timed task with no duration

// ---------------------------------------------------------------- context

export type Context = {
  today: string;
  localTime: string;
  name: string | null;
  tasks: Task[];
  goals: Goal[];
  projects: Project[];
  // short references the AI uses ("t3") <-> real ids
  taskRef: Map<string, Task>;
  goalRef: Map<string, Goal>;
  projectRef: Map<string, Project>;
};

export async function loadContext(
  supabase: SupabaseClient,
  today: string,
  localTime: string
): Promise<Context> {
  const from = addDays(today, -7);
  const to = addDays(today, 60);

  const [dated, undated, goals, projects, profile] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .gte("due_date", from)
      .lte("due_date", to)
      .order("due_date")
      .order("due_time", { nullsFirst: false })
      .limit(250),
    supabase
      .from("tasks")
      .select("*")
      .is("parent_id", null)
      .is("due_date", null)
      .not("status", "in", "(done,skipped)")
      .limit(50),
    supabase.from("goals").select("*").limit(50),
    supabase.from("projects").select("*").limit(80),
    supabase.from("profiles").select("display_name").maybeSingle(),
  ]);

  if (dated.error || undated.error || goals.error || projects.error) {
    throw new AIError("Couldn't load your schedule.", 500);
  }

  const tasks = [...(dated.data as Task[]), ...(undated.data as Task[])];
  const ctx: Context = {
    today,
    localTime,
    name: profile.data?.display_name ?? null,
    tasks,
    goals: goals.data as Goal[],
    projects: projects.data as Project[],
    taskRef: new Map(),
    goalRef: new Map(),
    projectRef: new Map(),
  };
  ctx.tasks.forEach((t, i) => ctx.taskRef.set(`t${i + 1}`, t));
  ctx.goals.forEach((g, i) => ctx.goalRef.set(`g${i + 1}`, g));
  ctx.projects.forEach((p, i) => ctx.projectRef.set(`p${i + 1}`, p));
  return ctx;
}

function weekdayName(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

function refOf<T>(map: Map<string, T>, value: T | undefined): string | null {
  for (const [ref, item] of map) if (item === value) return ref;
  return null;
}

function describeContext(ctx: Context): string {
  const calendar = Array.from({ length: 60 }, (_, i) => {
    const date = addDays(ctx.today, i);
    return `${date} ${weekdayName(date)}`;
  }).join(", ");

  const goalLines = [...ctx.goalRef]
    .map(([ref, g]) => `[${ref}] ${g.name}${g.target_date ? ` (target ${g.target_date})` : ""}`)
    .join("\n");

  const projectLines = [...ctx.projectRef]
    .map(([ref, p]) => {
      const goal = refOf(ctx.goalRef, ctx.goals.find((g) => g.id === p.goal_id));
      return `[${ref}] ${p.name}${p.deadline ? ` (deadline ${p.deadline})` : ""}${goal ? ` goal=[${goal}]` : ""}`;
    })
    .join("\n");

  const taskLines = [...ctx.taskRef]
    .map(([ref, t]) => {
      const when = t.due_date
        ? `${t.due_date} ${weekdayName(t.due_date)}${t.due_time ? ` ${hhmm(t.due_time)}${t.end_time ? `-${hhmm(t.end_time)}` : ""}` : ""}`
        : "no date";
      const extra = [
        `status=${t.status}`,
        `priority=${t.priority}`,
        t.estimated_duration ? `${t.estimated_duration}min` : null,
        t.category ? `category=${t.category}` : null,
        t.project_id ? `project=[${refOf(ctx.projectRef, ctx.projects.find((p) => p.id === t.project_id))}]` : null,
        t.goal_id ? `goal=[${refOf(ctx.goalRef, ctx.goals.find((g) => g.id === t.goal_id))}]` : null,
        t.repeat ? `repeats ${t.repeat}` : null,
      ].filter(Boolean);
      return `[${ref}] ${when} "${t.title}" ${extra.join(" ")}`;
    })
    .join("\n");

  return [
    `Today is ${ctx.today} (${weekdayName(ctx.today)}), local time ${ctx.localTime}.`,
    ctx.name ? `The user's name is ${ctx.name}.` : "",
    `Calendar for the next 60 days: ${calendar}`,
    `\nGoals:\n${goalLines || "(none)"}`,
    `\nProjects:\n${projectLines || "(none)"}`,
    `\nTasks (past 7 days, next 60 days, and undated open tasks):\n${taskLines || "(none)"}`,
  ].join("\n");
}

// ---------------------------------------------------------------- prompt + tool

const SYSTEM_PROMPT = `You are the AI assistant inside LifeOS, a task manager. The user talks to you in natural language and you turn it into organized, scheduled tasks.

How to behave:
- Reply in the user's language, short and friendly (1-3 sentences). Use 24-hour times.
- Whenever the user wants something scheduled, created, moved, skipped or deleted, call propose_changes IN THIS SAME REPLY. The app shows the proposal as a card with Apply / Discard, so that card is how you ask for confirmation: do not ask "would you like me to...?" first, and do not list the tasks in your text.
- Never claim something is saved; say what you propose.
- Ask ONE short question only when the answer would fundamentally change the plan and can't be assumed (e.g. "I need to study tomorrow" → which subject?). Do not ask for details you can reasonably assume (times, durations, generic steps of a project); assume them and mention it.
- If a requested time overlaps an existing task, still propose it at the requested time: the app detects the conflict and offers the user choices (move the new task, move the existing one, keep both, skip). You may mention the overlap in one short sentence.
- Answer questions ("what do I have today?", "what did I complete this week?") directly from the task list, without calling the tool.

Scheduling rules:
- Create individual scheduled tasks, never one vague task for a whole routine.
- For repeating routines use "series" with a pattern; the app calculates the dates. Examples: "gym 3 days then 1 day off" = on_off 3/1; "Mon, Wed, Fri" = days_of_week; "every other day" = every_n_days n=2; "every day except Friday" = days_of_week without fri. Rest days get no task.
- Always give a series an end: "count" (number of sessions) or "until" (date). If the user gave none, choose something reasonable (e.g. 4 weeks) and say so.
- Only use dates from the calendar provided. Never schedule in the past.
- Give every timed task a duration (duration_minutes or end_time), e.g. gym 60-90 min, study 60-120 min.
- Pick times that do not overlap the user's existing timed tasks. The app double-checks conflicts.
- For big goals ("finish my project in 30 days", "learn Python", "exam in 10 days"): create new_goal, 3-5 milestones with deadlines, and concrete tasks (30-180 min each, with times) spread over the available days, linked to milestones.
- Missed tasks ("I didn't go to the gym today"): propose marking it skipped (or moving it) and shifting the following sessions in that routine by the same amount, keeping the pattern. Moved tasks get status "rescheduled".
- "Move all unfinished tasks to tomorrow": update every open task dated today or earlier.
- Refer to existing items only by their reference, like t3, g1, p2.`;

// Fields shared by one-off tasks and repeating series
const taskFields = {
  title: { type: "string" },
  start_time: { type: "string", description: "HH:MM, 24-hour" },
  end_time: { type: "string", description: "HH:MM, 24-hour" },
  duration_minutes: { type: "integer" },
  priority: { type: "string", enum: ["low", "medium", "high"] },
  category: { type: "string" },
  notes: { type: "string" },
  goal: { type: "string", description: 'Existing goal ref (g1) or "new" for new_goal.' },
  project: { type: "string", description: "Existing project ref (p1)." },
  milestone: { type: "string", description: "Milestone key (m1) from milestones." },
};

const TOOL = {
  type: "function",
  function: {
    name: "propose_changes",
    description:
      "Propose tasks to create, change or delete. Nothing is saved until the user approves.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences describing the plan." },
        new_goal: {
          type: "object",
          description: "Create a new goal (for big objectives).",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            target_date: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["name"],
        },
        milestones: {
          type: "array",
          description: "Milestones of the new goal; each becomes a project.",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Short id like m1, used by tasks." },
              name: { type: "string" },
              deadline: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["key", "name"],
          },
        },
        tasks: {
          type: "array",
          description: "One-off tasks.",
          items: {
            type: "object",
            properties: { ...taskFields, date: { type: "string", description: "YYYY-MM-DD" } },
            required: ["title", "date"],
          },
        },
        series: {
          type: "array",
          description: "Repeating routines; each occurrence becomes its own task.",
          items: {
            type: "object",
            properties: {
              ...taskFields,
              start_date: { type: "string", description: "YYYY-MM-DD of the first possible day" },
              pattern: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["daily", "weekdays", "weekends", "days_of_week", "every_n_days", "on_off"],
                  },
                  days: {
                    type: "array",
                    items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
                  },
                  n: { type: "integer", description: "every_n_days: gap in days" },
                  on_days: { type: "integer", description: "on_off: days on" },
                  off_days: { type: "integer", description: "on_off: days off" },
                },
                required: ["type"],
              },
              count: { type: "integer", description: "Number of sessions." },
              until: { type: "string", description: "Last possible date, YYYY-MM-DD." },
            },
            required: ["title", "start_date", "pattern"],
          },
        },
        updates: {
          type: "array",
          description: "Changes to existing tasks.",
          items: {
            type: "object",
            properties: {
              task: { type: "string", description: "Task ref, e.g. t3" },
              date: { type: "string", description: 'YYYY-MM-DD, or "none" to clear' },
              start_time: { type: "string" },
              end_time: { type: "string" },
              duration_minutes: { type: "integer" },
              status: {
                type: "string",
                enum: ["todo", "in_progress", "done", "skipped", "rescheduled"],
              },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              title: { type: "string" },
            },
            required: ["task"],
          },
        },
        deletes: {
          type: "array",
          description: "Task refs to delete (only when the user wants them gone).",
          items: { type: "string" },
        },
      },
      required: ["summary"],
    },
  },
};

type ToolArgs = Record<string, unknown>;

export async function askAssistant(
  ctx: Context,
  history: ChatMessage[]
): Promise<{ text: string; args: ToolArgs | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIError("The AI assistant isn't set up yet (OPENAI_API_KEY is missing).", 503);
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${describeContext(ctx)}` },
          ...history.slice(-HISTORY_LIMIT),
        ],
        tools: [TOOL],
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AIError("Couldn't reach the AI service. Try again shortly.", 502);
  }

  if (!response.ok) {
    console.error("OpenAI error:", response.status, await response.text());
    if (response.status === 401) throw new AIError("The AI API key is invalid.", 502);
    if (response.status === 429) {
      throw new AIError("The AI is busy or out of credit. Try again in a minute.", 429);
    }
    throw new AIError("The AI service returned an error.", 502);
  }

  const json = await response.json();
  const message = json.choices?.[0]?.message ?? {};
  const call = message.tool_calls?.find(
    (c: { function?: { name?: string } }) => c.function?.name === "propose_changes"
  );

  let args: ToolArgs | null = null;
  if (call) {
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new AIError("The AI's plan was incomplete. Try asking again.", 502);
    }
  }
  return { text: (message.content ?? "").trim(), args };
}

// ---------------------------------------------------------------- proposal

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "skipped", "rescheduled"];

const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
const time = (v: unknown) => {
  if (typeof v !== "string") return null;
  const t = v.trim().padStart(5, "0"); // "9:00" -> "09:00"
  return TIME.test(t) ? t : null;
};
const minutes = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? n : null;
};
const array = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

export function buildProposal(args: ToolArgs, ctx: Context): Proposal | null {
  const newGoalName = str((args.new_goal as ToolArgs | undefined)?.name, 120);
  const newGoal = newGoalName
    ? {
        name: newGoalName,
        description: str((args.new_goal as ToolArgs).description, 500),
        targetDate: date((args.new_goal as ToolArgs).target_date),
      }
    : null;

  const milestones = array(args.milestones)
    .map((m) => ({ key: str(m.key, 20) ?? "", name: str(m.name, 120) ?? "", deadline: date(m.deadline) }))
    .filter((m) => m.key && m.name)
    .slice(0, 8)
    // A milestone can't be due after the goal itself
    .map((m) =>
      newGoal?.targetDate && m.deadline && m.deadline > newGoal.targetDate
        ? { ...m, deadline: newGoal.targetDate }
        : m
    );
  const milestoneKeys = new Set(milestones.map((m) => m.key));

  // Shared fields of one-off tasks and series
  const base = (raw: Record<string, unknown>) => {
    const start = time(raw.start_time);
    const end = start ? time(raw.end_time) : null;
    const span = start && end ? timeToMinutes(end) - timeToMinutes(start) : null;
    const goalRaw = str(raw.goal, 10);
    const goal = goalRaw ? ctx.goalRef.get(goalRaw) : undefined;
    const project = ctx.projectRef.get(str(raw.project, 10) ?? "");
    const milestone = str(raw.milestone, 20);
    return {
      title: str(raw.title, 150) ?? "",
      notes: str(raw.notes, 500),
      start,
      end: span && span > 0 ? end : null,
      duration: span && span > 0 ? span : minutes(raw.duration_minutes),
      priority: PRIORITIES.includes(raw.priority as TaskPriority) ? (raw.priority as TaskPriority) : "medium",
      category: str(raw.category, 40),
      goalId: goal?.id ?? null,
      newGoal: goalRaw === "new" && !!newGoal,
      projectId: project?.id ?? null,
      milestoneKey: milestone && milestoneKeys.has(milestone) ? milestone : null,
    };
  };

  const creates: DraftTask[] = [];
  const push = (fields: ReturnType<typeof base>, day: string) => {
    if (!fields.title || day < ctx.today || creates.length >= MAX_CREATES) return;
    creates.push({ key: `n${creates.length}`, date: day, conflict: null, ...fields });
  };

  for (const raw of array(args.tasks)) {
    const day = date(raw.date);
    if (day) push(base(raw), day);
  }

  for (const raw of array(args.series)) {
    const pattern = parsePattern(raw.pattern);
    const start = date(raw.start_date);
    if (!pattern || !start) continue;
    const count = Math.min(Math.round(Number(raw.count)) || 0, MAX_OCCURRENCES);
    const dates = expandPattern(pattern, start < ctx.today ? ctx.today : start, {
      count: count > 0 ? count : null,
      until: date(raw.until),
    });
    const fields = base(raw);
    for (const day of dates) push(fields, day);
  }

  const updates: TaskChange[] = [];
  for (const raw of array(args.updates)) {
    const task = ctx.taskRef.get(str(raw.task, 10) ?? "");
    if (!task) continue;
    const after: TaskChange["after"] = {};
    if (raw.date === "none") after.due_date = null;
    else if (date(raw.date)) after.due_date = date(raw.date);
    const start = time(raw.start_time);
    const end = time(raw.end_time);
    if (start) after.due_time = start;
    if (end) after.end_time = end;
    if (start && end && timeToMinutes(end) > timeToMinutes(start)) {
      after.estimated_duration = timeToMinutes(end) - timeToMinutes(start);
    } else if (minutes(raw.duration_minutes)) {
      after.estimated_duration = minutes(raw.duration_minutes);
    }
    if (STATUSES.includes(raw.status as TaskStatus)) after.status = raw.status as TaskStatus;
    if (PRIORITIES.includes(raw.priority as TaskPriority)) after.priority = raw.priority as TaskPriority;
    if (str(raw.title, 150)) after.title = str(raw.title, 150)!;
    // Moving an unfinished task to another day marks it as rescheduled
    if (
      after.due_date !== undefined &&
      after.due_date !== task.due_date &&
      !after.status &&
      (task.status === "todo" || task.status === "in_progress")
    ) {
      after.status = "rescheduled";
    }
    if (Object.keys(after).length === 0) continue;
    updates.push({
      taskId: task.id,
      title: task.title,
      before: { date: task.due_date, start: hhmm(task.due_time), status: task.status },
      after,
    });
  }

  const deletes = (Array.isArray(args.deletes) ? args.deletes : [])
    .map((ref) => ctx.taskRef.get(String(ref)))
    .filter((t): t is Task => !!t)
    .map((t) => ({ taskId: t.id, title: t.title, date: t.due_date }));

  if (!newGoal && creates.length === 0 && updates.length === 0 && deletes.length === 0) {
    return null;
  }

  const proposal: Proposal = {
    summary: str(args.summary, 600) ?? "Here's my plan.",
    newGoal,
    milestones,
    creates,
    updates,
    deletes,
  };
  markConflicts(proposal, ctx);
  return proposal;
}

// ---------------------------------------------------------------- conflicts

type Block = { start: number; end: number; taskId?: string; title?: string };

function taskBlock(start: string, end: string | null, duration: number | null): { start: number; end: number } {
  const s = timeToMinutes(start);
  const e = end ? timeToMinutes(end) : s + (duration ?? DEFAULT_MINUTES);
  return { start: s, end: Math.max(e, s + 1) };
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

// Flags new tasks that overlap existing timed tasks and suggests the next
// free slot the same day (between now-ish and 23:59).
function markConflicts(proposal: Proposal, ctx: Context) {
  const removed = new Set(proposal.deletes.map((d) => d.taskId));
  const moved = new Map(proposal.updates.map((u) => [u.taskId, u]));

  // Existing schedule as it will look after the proposed updates
  const busy = new Map<string, Block[]>();
  for (const task of ctx.tasks) {
    if (removed.has(task.id) || task.status === "done" || task.status === "skipped") continue;
    const change = moved.get(task.id)?.after;
    const day = change?.due_date !== undefined ? change.due_date : task.due_date;
    const start = change?.due_time ?? hhmm(task.due_time);
    if (!day || !start) continue;
    const block = taskBlock(
      start,
      change?.end_time ?? hhmm(task.end_time),
      change?.estimated_duration ?? task.estimated_duration
    );
    busy.set(day, [...(busy.get(day) ?? []), { ...block, taskId: task.id, title: task.title }]);
  }

  for (const draft of proposal.creates) {
    if (!draft.start) continue;
    const block = taskBlock(draft.start, draft.end, draft.duration);
    const dayBusy = busy.get(draft.date) ?? [];
    const clash = dayBusy.find((b) => b.taskId && overlaps(b, block));

    if (clash) {
      const length = block.end - block.start;
      draft.conflict = {
        existingTaskId: clash.taskId!,
        existingTitle: clash.title!,
        existingStart: minutesToTime(clash.start),
        existingEnd: minutesToTime(clash.end),
        suggestedStart: findFreeSlot(dayBusy, clash.end, length),
      } satisfies Conflict;
    }
    // Later new tasks must also avoid this one
    busy.set(draft.date, [...dayBusy, block]);
  }
}

function findFreeSlot(dayBusy: Block[], from: number, length: number): string | null {
  const sorted = [...dayBusy].sort((a, b) => a.start - b.start);
  let candidate = Math.ceil(from / 15) * 15; // round to quarter hours
  for (let guard = 0; guard < 100; guard++) {
    if (candidate + length > 24 * 60) return null;
    const hit = sorted.find((b) => overlaps(b, { start: candidate, end: candidate + length }));
    if (!hit) return minutesToTime(candidate);
    candidate = Math.ceil(hit.end / 15) * 15;
  }
  return null;
}
