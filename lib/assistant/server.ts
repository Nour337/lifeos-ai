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
import { describePersona, styleInstruction } from "@/lib/persona/describe";
import { computeInsights } from "@/lib/persona/insights";
import { toProfile } from "@/lib/persona/server";
import {
  blocksOn,
  cleanText,
  newId,
  mergeBlocks,
  parseAIProfile,
  parseRoles,
  record,
  ROLE_OPTIONS,
  roleOf,
  type Profile,
} from "@/types/persona";
import { kindOf } from "@/types/project";
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
  profile: Profile;
  personaMode: boolean; // Persona chat (unlimited) vs normal chat (10/day)
  persona: string; // the user's AI persona as prompt text ("" in normal chat)
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
  userId: string,
  today: string,
  localTime: string,
  personaMode: boolean
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
    supabase
      .from("profiles")
      .select("display_name, ai_personality, ai_profile, onboarding_status")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (dated.error || undated.error || goals.error || projects.error) {
    throw new AIError("Couldn't load your schedule.", 500);
  }

  const tasks = [...(dated.data as Task[]), ...(undated.data as Task[])];
  const userProfile = toProfile(userId, profile.data);
  const ctx: Context = {
    today,
    localTime,
    name: userProfile.display_name,
    profile: userProfile,
    personaMode,
    persona: personaMode ? describePersona(userProfile, computeInsights(tasks, today)) : "",
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
    // Busy blocks written on each day, so the AI doesn't have to work out weekdays
    const fixed = blocksOn(ctx.profile.ai_profile.blocks, date)
      .map((b) => `${b.label} ${b.start}-${b.end}`)
      .join(", ");
    return `${date} ${weekdayName(date)}${fixed ? ` [busy: ${fixed}]` : ""}`;
  }).join(", ");

  const goalLines = [...ctx.goalRef]
    .map(([ref, g]) => `[${ref}] ${g.name}${g.target_date ? ` (target ${g.target_date})` : ""}`)
    .join("\n");

  const projectLines = [...ctx.projectRef]
    .map(([ref, p]) => {
      const goal = refOf(ctx.goalRef, ctx.goals.find((g) => g.id === p.goal_id));
      const deadline = p.deadline ? ` (${p.kind === "course" ? "exam" : "deadline"} ${p.deadline})` : "";
      return `[${ref}] ${kindOf(p.kind).label}: ${p.name}${deadline}${goal ? ` goal=[${goal}]` : ""}`;
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
    ctx.persona
      ? `\nThe user's AI Persona (who they are, what they do, what they want; use it for everything):\n${ctx.persona}`
      : "",
    `\nCalendar for the next 60 days: ${calendar}`,
    `\nGoals:\n${goalLines || "(none)"}`,
    `\nCourses and projects:\n${projectLines || "(none)"}`,
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
- Refer to existing items only by their reference, like t3, g1, p2.
- Link study tasks to their course (project ref) and work to its project, so progress is tracked.`;

// Added in Persona Mode only
const PERSONA_PROMPT = `Persona Mode: you are this user's personal planner and coach and you know their persona.
- Use what you know about the user: their courses, exams, projects, goals, schedule, routines, preferences and learned behaviour. Respect their sleep time, busy hours and routines, and follow learned behaviour (e.g. no early-morning tasks if they rarely do them; shorter sessions if long ones fail).
- "I have 2 hours free": suggest 2-3 concrete options from their goals and deadlines and ask which one. If they say "you decide", propose a balanced plan for that time with propose_changes.
- "Plan my week" / "create a balanced plan": spread sessions over the week across their important areas (deadlines first), keeping free time and routines.
- The user can have several roles at once (student + working + entrepreneur). Balance them: university deadlines, work and business goals all get time.
- Every calendar day lists its [busy: ...] times (work, university). Never schedule inside them; use the free gaps (before or after work, days off) and respect sleep time.
- When they tell you fixed weekly hours ("I work Sun-Thu 16-22", "uni 9 to 3"), also save them as busy_blocks in update_persona.
- Suggest useful tasks from their persona (courses, exams, work, business ideas, AI/tech learning, goals), prioritised by deadlines and goals, never random, each with a one-line reason.
- When the user tells you something lasting about themselves, call update_persona in the same reply: new roles ("I started working" → roles = their current roles + working), job/company/hours, university details, new interests, skills, tools, courses to take, business ideas, or other facts ("I work night shifts on Fridays", "my exam moved to Dec 20"). Don't save one-off requests.`;

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

const PERSONA_TOOL = {
  type: "function",
  function: {
    name: "update_persona",
    description:
      "Update the user's AI Persona with lasting information (visible and editable on the My AI Persona page).",
    parameters: {
      type: "object",
      properties: {
        roles: {
          type: "array",
          items: { type: "string", enum: ROLE_OPTIONS.map((r) => r.value) },
          description: "The COMPLETE new list of roles, only if it changed.",
        },
        headline: { type: "string" },
        education: {
          type: "object",
          properties: {
            university: { type: "string" },
            faculty: { type: "string" },
            major: { type: "string" },
            term: { type: "string" },
            graduation: { type: "string" },
          },
        },
        job: {
          type: "object",
          properties: {
            job: { type: "string" },
            company: { type: "string" },
            hours: { type: "string" },
            responsibilities: { type: "string" },
          },
        },
        add_interests: { type: "array", items: { type: "string" } },
        add_skills: { type: "array", items: { type: "string" } },
        add_tools: { type: "array", items: { type: "string" } },
        add_learning: { type: "array", items: { type: "string" } },
        add_business_ideas: { type: "array", items: { type: "string" } },
        busy_blocks: {
          type: "array",
          description: "Fixed weekly busy times: university hours, work shifts. Replaces blocks with the same label.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: 'e.g. "University", "Work"' },
              days: { type: "array", items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
              start: { type: "string", description: "HH:MM" },
              end: { type: "string", description: "HH:MM" },
            },
            required: ["label", "days", "start", "end"],
          },
        },
        facts: { type: "array", items: { type: "string" }, description: "Other lasting facts, short sentences." },
      },
    },
  },
};

type ToolArgs = Record<string, unknown>;

export async function askAssistant(
  ctx: Context,
  history: ChatMessage[]
): Promise<{ text: string; args: ToolArgs | null; personaUpdate: ToolArgs | null }> {
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
          {
            role: "system",
            content: ctx.personaMode
              ? `${SYSTEM_PROMPT}\n\n${PERSONA_PROMPT}\n- ${styleInstruction(ctx.profile)}\n\n${describeContext(ctx)}`
              : `${SYSTEM_PROMPT}\n\n${describeContext(ctx)}`,
          },
          ...history.slice(-HISTORY_LIMIT),
        ],
        tools: ctx.personaMode ? [TOOL, PERSONA_TOOL] : [TOOL],
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

  let personaUpdate: ToolArgs | null = null;
  const personaCall = message.tool_calls?.find(
    (c: { function?: { name?: string } }) => c.function?.name === "update_persona"
  );
  if (personaCall && ctx.personaMode) {
    try {
      personaUpdate = JSON.parse(personaCall.function.arguments);
    } catch {
      // a broken persona update isn't worth failing the reply for
    }
  }
  return { text: (message.content ?? "").trim(), args, personaUpdate };
}

// Applies an update_persona call. Returns short descriptions of what
// changed, shown under the reply ("Added role: Working").
export async function savePersonaUpdate(
  supabase: SupabaseClient,
  ctx: Context,
  update: ToolArgs
): Promise<string[]> {
  const current = ctx.profile.ai_profile;
  const changes: string[] = [];
  const now = new Date().toISOString();

  const addTo = (list: string[], raw: unknown, label: string) => {
    const next = [...list];
    for (const item of Array.isArray(raw) ? raw : []) {
      const text = cleanText(item, 150);
      if (text && !next.some((x) => x.toLowerCase() === text.toLowerCase())) {
        next.push(text);
        changes.push(`${label}: ${text}`);
      }
    }
    return next;
  };
  const merge = <T extends Record<string, unknown>>(base: T, raw: unknown, label: string): T => {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(record(raw))) {
      const text = cleanText(value, 300);
      if (text && out[key] !== text) {
        out[key] = text;
        changes.push(`${label}: ${text}`);
      }
    }
    return out as T;
  };

  let roles = current.about.roles;
  if (update.roles !== undefined) {
    const next = parseRoles(update.roles);
    if (next.length) {
      next.filter((r) => !roles.includes(r)).forEach((r) => changes.push(`Added role: ${roleOf(r).label}`));
      roles.filter((r) => !next.includes(r)).forEach((r) => changes.push(`Removed role: ${roleOf(r).label}`));
      roles = next;
    }
  }
  const headline = cleanText(update.headline, 100);
  if (headline && headline !== current.about.headline) changes.push(`About: ${headline}`);

  const blocks = mergeBlocks(current.blocks, update.busy_blocks);
  blocks
    .filter((b) => !current.blocks.some((c) => c.id === b.id && c.start === b.start && c.end === b.end))
    .forEach((b) => changes.push(`Busy: ${b.label} ${b.start}–${b.end}`));

  const memory = [...current.memory];
  for (const fact of Array.isArray(update.facts) ? update.facts : []) {
    const text = cleanText(fact, 200);
    if (text && !memory.some((m) => m.text.toLowerCase() === text.toLowerCase())) {
      memory.push({ id: newId(), text, source: "ai", created_at: now });
      changes.push(text);
    }
  }

  const next = parseAIProfile({
    ...current,
    about: { ...current.about, roles, headline: headline ?? current.about.headline },
    education: merge(current.education, update.education, "Education"),
    work: merge(current.work, update.job, "Work"),
    interests: addTo(current.interests, update.add_interests, "Interest"),
    skills: addTo(current.skills, update.add_skills, "Skill"),
    tools: addTo(current.tools, update.add_tools, "Tool to learn"),
    learning: addTo(current.learning, update.add_learning, "To learn"),
    business: {
      ...current.business,
      ideas: addTo(current.business.ideas, update.add_business_ideas, "Business idea"),
    },
    blocks,
    memory: memory.slice(-50),
  });

  if (!changes.length) return [];
  const { error } = await supabase
    .from("profiles")
    .update({ ai_profile: next, updated_at: now })
    .eq("id", ctx.profile.id);
  if (error) {
    console.error("Saving persona update failed:", error.message);
    return [];
  }
  return changes.slice(0, 8);
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
    creates.push({ key: `n${creates.length}`, date: day, conflict: null, movedFrom: null, ...fields });
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

type Block = { start: number; end: number; taskId?: string; title?: string; fixed?: boolean };

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

  // Existing schedule as it will look after the proposed updates, plus the
  // user's fixed busy blocks (university, work)
  const busy = new Map<string, Block[]>();
  const blocks = ctx.profile.ai_profile.blocks;
  const dayBusy = (day: string): Block[] => {
    if (!busy.has(day)) {
      busy.set(
        day,
        blocksOn(blocks, day).map((b) => ({
          start: timeToMinutes(b.start),
          end: timeToMinutes(b.end),
          title: b.label,
          fixed: true,
        }))
      );
    }
    return busy.get(day)!;
  };
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
    dayBusy(day).push({ ...block, taskId: task.id, title: task.title });
  }

  // The user's day: from an hour after waking to half an hour before bed
  const schedule = ctx.profile.ai_profile.schedule;
  const dayStart = schedule.wake ? timeToMinutes(schedule.wake) + 60 : 8 * 60;
  const sleep = schedule.sleep ? timeToMinutes(schedule.sleep) : null;
  const dayEnd = sleep && sleep > 12 * 60 ? sleep - 30 : 24 * 60;

  for (const draft of proposal.creates) {
    if (!draft.start) continue;
    let block = taskBlock(draft.start, draft.end, draft.duration);
    const today = dayBusy(draft.date);

    // Work and university can't move, so a new task inside them is moved to
    // the nearest free time that day (after the busy block, else earlier)
    const fixedClash = today.find((b) => b.fixed && overlaps(b, block));
    if (fixedClash) {
      const length = block.end - block.start;
      const slot =
        findFreeSlot(today, fixedClash.end, length, dayEnd) ??
        findFreeSlot(today, dayStart, length, dayEnd);
      if (slot) {
        const shift = timeToMinutes(slot) - block.start;
        draft.movedFrom = `${draft.start} (${fixedClash.title})`;
        draft.start = slot;
        if (draft.end) draft.end = minutesToTime(timeToMinutes(draft.end) + shift);
        block = taskBlock(draft.start, draft.end, draft.duration);
      }
    }

    const clash = today.find((b) => (b.taskId || b.fixed) && overlaps(b, block));

    if (clash) {
      const length = block.end - block.start;
      draft.conflict = {
        existingTaskId: clash.taskId ?? null,
        existingTitle: clash.title!,
        existingStart: minutesToTime(clash.start),
        existingEnd: minutesToTime(clash.end),
        suggestedStart: findFreeSlot(today, clash.end, length),
      } satisfies Conflict;
    }
    // Later new tasks must also avoid this one
    today.push(block);
  }
}

function findFreeSlot(dayBusy: Block[], from: number, length: number, until = 24 * 60): string | null {
  const sorted = [...dayBusy].sort((a, b) => a.start - b.start);
  let candidate = Math.ceil(from / 15) * 15; // round to quarter hours
  for (let guard = 0; guard < 100; guard++) {
    if (candidate + length > until) return null;
    const hit = sorted.find((b) => overlaps(b, { start: candidate, end: candidate + length }));
    if (!hit) return minutesToTime(candidate);
    candidate = Math.ceil(hit.end / 15) * 15;
  }
  return null;
}
