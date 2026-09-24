import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";
import type { Task } from "@/types/task";

export type AIMode = "plan" | "next" | "steps";

export class AIError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Shapes returned to the browser
export type PlanItem = { taskId: string; title: string; reason: string };
export type AIResult =
  | { kind: "plan"; items: PlanItem[]; later: PlanItem[]; note: string }
  | { kind: "next"; item: PlanItem }
  | { kind: "steps"; taskId: string; steps: string[] }
  | { kind: "message"; text: string };

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TASKS = 40;

// A Supabase client that acts as the signed-in user (their access token), so
// RLS still applies and the AI only ever sees that user's own data.
export async function getUserClient(accessToken: string): Promise<SupabaseClient> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new AIError("Your session has expired. Please log in again.", 401);
  }
  return supabase;
}

export async function getOpenTasks(supabase: SupabaseClient): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(MAX_TASKS);

  if (error) throw new AIError("Couldn't load your tasks.", 500);
  return data as Task[];
}

export async function getTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new AIError("Couldn't load the task.", 500);
  if (!data) throw new AIError("Task not found.", 404);
  return data as Task;
}

// Uses one of today's AI questions. Returns how many are left.
export async function consumeCredit(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("consume_ai_credit");
  if (error) {
    console.error("consume_ai_credit failed:", error.message);
    throw new AIError("Couldn't check your AI limit. Try again.", 500);
  }
  if (data === -1) {
    throw new AIError(
      `You've used all ${AI_DAILY_LIMIT} AI questions for today. More tomorrow!`,
      429
    );
  }
  return data as number;
}

function describeTask(task: Task, today: string): string {
  const parts = [`priority ${task.priority}`];
  if (task.status === "in_progress") parts.push("already started");
  if (task.due_date) {
    parts.push(
      task.due_date < today
        ? `OVERDUE since ${task.due_date}`
        : task.due_date === today
          ? "due TODAY"
          : `due ${task.due_date}`
    );
    if (task.due_time) parts.push(`at ${task.due_time.slice(0, 5)}`);
  } else {
    parts.push("no due date");
  }
  if (task.estimated_duration) parts.push(`takes ~${task.estimated_duration} min`);
  if (task.category) parts.push(`category ${task.category}`);
  if (task.repeat) parts.push(`repeats ${task.repeat}`);
  let line = `"${task.title}" (${parts.join(", ")})`;
  if (task.description) line += ` — notes: ${task.description.slice(0, 200)}`;
  return line;
}

const SYSTEM_PROMPT =
  "You are the planning assistant inside LifeOS, a personal productivity app. " +
  "Be concrete and brief. Only use tasks from the numbered list you are given. " +
  "Weigh overdue and due-today tasks first, then priority, then quick wins. " +
  "Respect the user's available time when given, using each task's estimated minutes (assume 30 min if unknown). " +
  "Never invent tasks. Always answer with JSON only, in exactly the format requested.";

type Prompt = { system: string; user: string };

export function buildPrompt(
  mode: "plan" | "next",
  tasks: Task[],
  today: string,
  localTime: string,
  availableMinutes: number | null
): Prompt {
  const list = tasks
    .map((task, i) => `${i + 1}. ${describeTask(task, today)}`)
    .join("\n");
  const time = availableMinutes
    ? `I have about ${availableMinutes} minutes for tasks today.`
    : "I didn't say how much time I have.";
  const context = `Today is ${today}, local time ${localTime}. ${time}\n\nMy open tasks:\n${list}`;

  if (mode === "next") {
    return {
      system: SYSTEM_PROMPT,
      user:
        `${context}\n\nPick exactly ONE task to do right now. ` +
        `Reply as JSON: {"n": <task number>, "reason": "<one short sentence>"}`,
    };
  }

  return {
    system: SYSTEM_PROMPT,
    user:
      `${context}\n\nPlan the rest of my day: pick the tasks to do today, in order (at most 6, and fitting my available time if I gave it). ` +
      `Reply as JSON: {"plan": [{"n": <task number>, "reason": "<under 12 words>"}], ` +
      `"later": [<numbers of open tasks that can wait>], "note": "<one short encouraging sentence>"}`,
  };
}

export function buildStepsPrompt(task: Task): Prompt {
  return {
    system:
      "You help people start big tasks by breaking them into small, concrete next actions. " +
      "Each step starts with a verb and takes 15-60 minutes. Answer with JSON only.",
    user:
      `Break this task into 3 to 6 steps: ${describeTask(task, "")}\n\n` +
      `Reply as JSON: {"steps": ["<step>", ...]}`,
  };
}

export async function askAI(prompt: Prompt): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIError(
      "The AI assistant isn't set up yet (OPENAI_API_KEY is missing).",
      503
    );
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AIError("Couldn't reach the AI service. Try again shortly.", 502);
  }

  if (!response.ok) {
    console.error("OpenAI error:", response.status, await response.text());
    if (response.status === 401) {
      throw new AIError("The AI API key is invalid.", 502);
    }
    if (response.status === 429) {
      throw new AIError(
        "The AI is busy or out of credit. Try again in a minute.",
        429
      );
    }
    throw new AIError("The AI service returned an error.", 502);
  }

  const json = await response.json();
  const text: string | undefined = json.choices?.[0]?.message?.content;
  try {
    return JSON.parse(text ?? "");
  } catch {
    throw new AIError("The AI gave an unreadable answer. Try again.", 502);
  }
}

// Turn the model's task numbers back into real tasks, dropping anything invalid.
function pick(tasks: Task[], n: unknown): Task | null {
  const index = Number(n) - 1;
  return Number.isInteger(index) && tasks[index] ? tasks[index] : null;
}

const asText = (value: unknown, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function parsePlan(raw: unknown, tasks: Task[]): AIResult {
  const data = (raw ?? {}) as { plan?: unknown; later?: unknown; note?: unknown };
  const seen = new Set<string>();
  const items: PlanItem[] = [];

  for (const entry of Array.isArray(data.plan) ? data.plan : []) {
    const task = pick(tasks, (entry as { n?: unknown })?.n);
    if (task && !seen.has(task.id)) {
      seen.add(task.id);
      items.push({
        taskId: task.id,
        title: task.title,
        reason: asText((entry as { reason?: unknown }).reason),
      });
    }
  }

  const later: PlanItem[] = [];
  for (const n of Array.isArray(data.later) ? data.later : []) {
    const task = pick(tasks, n);
    if (task && !seen.has(task.id)) {
      seen.add(task.id);
      later.push({ taskId: task.id, title: task.title, reason: "" });
    }
  }

  if (items.length === 0) {
    throw new AIError("The AI couldn't make a plan. Try again.", 502);
  }
  return { kind: "plan", items, later, note: asText(data.note) };
}

export function parseNext(raw: unknown, tasks: Task[]): AIResult {
  const data = (raw ?? {}) as { n?: unknown; reason?: unknown };
  const task = pick(tasks, data.n);
  if (!task) throw new AIError("The AI couldn't pick a task. Try again.", 502);
  return {
    kind: "next",
    item: { taskId: task.id, title: task.title, reason: asText(data.reason) },
  };
}

export function parseSteps(raw: unknown, taskId: string): AIResult {
  const data = (raw ?? {}) as { steps?: unknown };
  const steps = (Array.isArray(data.steps) ? data.steps : [])
    .map((s) => asText(s, 120))
    .filter(Boolean)
    .slice(0, 8);
  if (steps.length === 0) {
    throw new AIError("The AI couldn't split this task. Try again.", 502);
  }
  return { kind: "steps", taskId, steps };
}
