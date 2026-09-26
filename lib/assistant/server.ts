import { describeContext, READ_TOOLS, runReadTool, type Context } from "@/lib/assistant/context";
import { PATTERN_SCHEMA } from "@/lib/assistant/patterns";
import { PERSONA_TOOL } from "@/lib/assistant/persona-update";
import type { ChatMessage } from "@/lib/assistant/types";
import { complete, parseArgs, type LLMMessage } from "@/lib/ai/llm";
import type { Meter } from "@/lib/ai/usage";
import { PRIORITIES } from "@/types/task";

// The assistant: one chat that always knows the user's persona. The model
// may look things up with read tools, then answers with text and at most one
// plan (propose_changes) and one persona update (update_persona).

const SYSTEM_PROMPT = `You are the AI assistant inside LifeOS, a personal planner. The user talks to you in natural language and you turn it into organized, scheduled tasks. You know their persona (who they are, their courses, work, goals, schedule, routines and learned behaviour): use it for everything.

How to behave:
- Reply in the user's language (or their saved language preference), short and friendly (1-3 sentences). Use 24-hour times.
- Whenever the user wants something scheduled, created, moved, skipped or deleted, call propose_changes IN THIS SAME REPLY. The app shows the plan as a card with Apply / Discard, so that card is how you ask for confirmation: do not ask "would you like me to...?" first, and do not list the tasks in your text.
- Never claim something is saved; say what you propose.
- Ask ONE short question only when the answer would fundamentally change the plan and can't be assumed (e.g. "I need to study tomorrow" → which subject, if they have several courses). Don't ask about details you can reasonably assume (times, durations, generic steps); assume them and list each assumption in "assumptions" (the user sees them on the card).
- Explain briefly WHY you chose something when it isn't obvious ("your Database exam is in 5 days").
- Answer questions ("what do I have Friday?") directly from the data, without propose_changes. Use find_tasks / get_days when the answer is outside what you were given.

Scheduling rules:
- The calendar lists each day's fixed [busy: ...] hours and how full the day is (planned/capacity). Never schedule inside busy hours, respect sleep and rest days, and don't overload a day beyond its capacity: spread work over other days instead.
- Create individual scheduled tasks, never one vague task for a whole routine.
- Repeating routines ("gym 3 days then 1 day off", "study Arabic every weekday") go in "series" with a pattern; the app calculates the dates and keeps creating sessions. Examples: "gym 3 on 1 off" = on_off 3/1; "Mon, Wed, Fri" = days_of_week; "every other day" = every_n_days n=2; "every day except Friday" = days_of_week without fri; "monthly on the 1st" = monthly day=1. Set routine=true for habits (gym, prayer, reading), false for repeating work. Give a series an end ("count" or "until") only when the user implies one; habits can run open-ended by giving "until" a few months ahead.
- To change or stop an existing routine use series_changes with its ref (s1): e.g. "move gym to 19:00 from now on" or "stop my reading habit".
- Dates: use the calendar for the next 14 days; for later dates just write the exact YYYY-MM-DD (use get_days to check a far date's weekday and schedule). Never schedule in the past.
- Give every timed task a duration (duration_minutes or end_time). Use the user's default durations and learned session length when they have them.
- Mark appointments that can't move (exams, meetings, classes) with fixed=true. Mark focus work energy="deep" and small admin energy="light".
- If a requested time overlaps an existing task, still propose it at the requested time: the app detects the conflict and offers choices. You may mention the overlap in one short sentence.
- Big goals ("finish my project in 30 days", "learn Python", "exam in 10 days"): create new_goal (with why, priority and weekly_hours when known), 3-5 milestones with deadlines, and concrete sessions (30-180 min, with times) spread over the available days before the deadline, linked to milestones. For an exam, link sessions to the course (project ref) and space them out with more sessions close to the exam.
- Missed tasks ("I didn't go to the gym today"): mark it skipped (status "skipped") or move it; for routines, don't pile up extra sessions.
- "Move all unfinished tasks to tomorrow": update every open task dated today or earlier.
- Refer to existing items only by their reference (t3, g1, p2, s1).
- Link study tasks to their course (project ref) and work to its project, so progress is tracked.
- "I have 2 hours free": suggest 2-3 concrete options from their goals and deadlines and ask which one; if they say "you decide", propose a balanced plan for that time.
- "Plan my week": spread sessions across their important areas (deadlines first, weekly targets, neglected areas), keeping free time, routines and rest days. Balance their roles (student + work + business all get time).

Remembering:
- When the user tells you something lasting about themselves, call update_persona in the same reply: new roles ("I started working" → their current roles + working), job details, busy hours (also lectures and shifts, with the semester dates when known), an exam or deadline that moved (update_projects / assessments, never a note), new courses, goals changing, skills, preferences. Use "facts" only for what fits nowhere else. Don't save one-off requests.
- After changing busy hours, the app checks existing tasks for new overlaps by itself.`;

// Fields shared by one-off tasks and repeating series
const taskFields = {
  title: { type: "string" },
  start_time: { type: "string", description: "HH:MM, 24-hour" },
  end_time: { type: "string", description: "HH:MM, 24-hour" },
  duration_minutes: { type: "integer" },
  priority: { type: "string", enum: PRIORITIES },
  category: { type: "string" },
  notes: { type: "string" },
  energy: { type: "string", enum: ["deep", "light"] },
  goal: { type: "string", description: 'Existing goal ref (g1) or "new" for new_goal.' },
  project: { type: "string", description: "Existing project or course ref (p1)." },
  milestone: { type: "string", description: "Milestone key (m1) from milestones." },
};

const PROPOSE_TOOL = {
  type: "function",
  function: {
    name: "propose_changes",
    description: "Propose tasks to create, change or delete. Nothing is saved until the user approves.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences describing the plan." },
        assumptions: {
          type: "array",
          items: { type: "string" },
          description: 'What you assumed that the user didn\'t say, e.g. "60 min per session", "after work at 19:00".',
        },
        new_goal: {
          type: "object",
          description: "Create a new goal (for big objectives).",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            target_date: { type: "string", description: "YYYY-MM-DD" },
            why: { type: "string", description: "Why it matters to them" },
            priority: { type: "string", enum: ["low", "medium", "high", "very_high"] },
            weekly_hours: { type: "number" },
          },
          required: ["name"],
        },
        milestones: {
          type: "array",
          description: "Milestones of the new goal.",
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
            properties: {
              ...taskFields,
              date: { type: "string", description: "YYYY-MM-DD" },
              fixed: { type: "boolean", description: "An appointment that can't move (exam, meeting)." },
            },
            required: ["title", "date"],
          },
        },
        series: {
          type: "array",
          description: "New routines and repeating tasks; each occurrence becomes its own task.",
          items: {
            type: "object",
            properties: {
              ...taskFields,
              start_date: { type: "string", description: "YYYY-MM-DD of the first possible day" },
              pattern: PATTERN_SCHEMA,
              count: { type: "integer", description: "Number of sessions (optional)." },
              until: { type: "string", description: "Last possible date, YYYY-MM-DD (optional)." },
              routine: { type: "boolean", description: "A habit (gym, prayer, reading) rather than repeating work." },
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
              start_time: { type: "string", description: 'HH:MM, or "none" for any time of day' },
              end_time: { type: "string" },
              duration_minutes: { type: "integer" },
              status: { type: "string", enum: ["todo", "in_progress", "done", "skipped"] },
              priority: { type: "string", enum: PRIORITIES },
              title: { type: "string" },
            },
            required: ["task"],
          },
        },
        series_changes: {
          type: "array",
          description: "Stop or change an existing routine (all its sessions from a date on).",
          items: {
            type: "object",
            properties: {
              series: { type: "string", description: "Routine ref, e.g. s1" },
              action: { type: "string", enum: ["stop", "change"] },
              from_date: { type: "string", description: "YYYY-MM-DD, default today" },
              title: { type: "string" },
              start_time: { type: "string" },
              end_time: { type: "string" },
              duration_minutes: { type: "integer" },
              pattern: PATTERN_SCHEMA,
            },
            required: ["series", "action"],
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

const MAX_ROUNDS = 4;

// Runs the conversation turn: read tools are answered and the model asked
// again (at most a few rounds); propose_changes / update_persona end it.
export async function askAssistant(
  ctx: Context,
  history: { summary: string | null; messages: ChatMessage[] },
  meter: Meter
): Promise<{ text: string; plan: ToolArgs | null; personaUpdate: ToolArgs | null }> {
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\n${describeContext(ctx)}${
        history.summary ? `\n\nEarlier in this conversation (summary):\n${history.summary}` : ""
      }`,
    },
    ...history.messages,
  ];

  let text = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS - 1;
    const result = await complete({
      messages,
      tools: lastRound ? [PROPOSE_TOOL, PERSONA_TOOL] : [PROPOSE_TOOL, PERSONA_TOOL, ...READ_TOOLS],
      temperature: 0.3,
      maxTokens: 3000,
      timeoutMs: 55_000,
    });
    meter.add(result);
    text = result.content || text;

    const plan = result.toolCalls.find((c) => c.name === "propose_changes");
    const persona = result.toolCalls.find((c) => c.name === "update_persona");
    const reads = result.toolCalls.filter((c) => c.name === "find_tasks" || c.name === "get_days");
    const brokenPlan = !!plan && !parseArgs(plan);

    if (!brokenPlan && (plan || persona || !reads.length)) {
      return { text: result.content, plan: parseArgs(plan), personaUpdate: parseArgs(persona) };
    }
    if (brokenPlan && lastRound) {
      return { text: result.content, plan: null, personaUpdate: parseArgs(persona) };
    }

    // Answer the lookups and let the model continue
    messages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    });
    for (const call of result.toolCalls) {
      const output = reads.includes(call)
        ? await runReadTool(ctx, call.name, parseArgs(call) ?? {})
        : call === plan && brokenPlan
          ? "The arguments were not valid JSON (maybe cut off). Call propose_changes again with a shorter, valid plan."
          : "Not applied yet: call it again together with your final answer.";
      messages.push({ role: "tool", tool_call_id: call.id, content: output.slice(0, 12000) });
    }
  }
  return { text, plan: null, personaUpdate: null };
}
