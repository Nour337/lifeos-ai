import { createClient } from "@supabase/supabase-js";
import type { Task } from "@/types/task";

export type AIMode = "plan" | "next";

export class AIError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TASKS = 40;

// Query as the signed-in user (their access token), so RLS still applies
// and the AI only ever sees that user's own tasks.
export async function getOpenTasksForUser(accessToken: string): Promise<Task[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    throw new AIError("Your session has expired. Please log in again.", 401);
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(MAX_TASKS);

  if (error) {
    throw new AIError("Couldn't load your tasks.", 500);
  }
  return data as Task[];
}

function formatTask(task: Task, today: string): string {
  const parts = [`- "${task.title}"`, `priority: ${task.priority}`];
  if (task.status === "in_progress") parts.push("already in progress");
  if (task.due_date) {
    const when =
      task.due_date < today
        ? `OVERDUE (was due ${task.due_date})`
        : task.due_date === today
          ? "due TODAY"
          : `due ${task.due_date}`;
    parts.push(when);
  } else {
    parts.push("no due date");
  }
  if (task.estimated_duration) parts.push(`~${task.estimated_duration} min`);
  if (task.category) parts.push(`category: ${task.category}`);
  if (task.description) parts.push(`notes: ${task.description.slice(0, 200)}`);
  return parts.join(", ");
}

export function buildPrompt(
  mode: AIMode,
  tasks: Task[],
  today: string,
  localTime: string
): { system: string; user: string } {
  const system =
    "You are the planning assistant inside LifeOS, a personal productivity app. " +
    "Be concrete and brief. Only refer to tasks from the list you are given, using their exact titles. " +
    "Weigh overdue and due-today tasks first, then priority, then quick wins. " +
    "Do not invent tasks, meetings, or times the user didn't mention. Plain text, no markdown headings.";

  const taskList = tasks.map((t) => formatTask(t, today)).join("\n");
  const context = `Today is ${today}, current local time ${localTime}.\n\nMy open tasks:\n${taskList}`;

  if (mode === "next") {
    return {
      system,
      user:
        `${context}\n\nPick exactly ONE task I should do right now. ` +
        `Reply in this format and nothing else:\nTask: <exact title>\nWhy: <one sentence>`,
    };
  }

  return {
    system,
    user:
      `${context}\n\nPlan the rest of my day. Give a numbered order of at most 6 tasks to work on today, ` +
      `each with a short reason (under 15 words). Leave out tasks that can wait and, in one final line starting with "Later:", ` +
      `name what can be pushed to another day.`,
  };
}

export async function askAI(system: string, user: string): Promise<string> {
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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: 400,
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
        "The AI is rate-limited or out of credit. Try again in a minute.",
        429
      );
    }
    throw new AIError("The AI service returned an error.", 502);
  }

  const json = await response.json();
  const text: string | undefined = json.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new AIError("The AI returned an empty answer. Try again.", 502);
  }
  return text.trim();
}
