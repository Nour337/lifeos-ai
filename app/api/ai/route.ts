import {
  AIError,
  askAI,
  buildPrompt,
  buildStepsPrompt,
  getOpenTasks,
  getTask,
  getUserSession,
  parseNext,
  parsePlan,
  parseSteps,
} from "@/lib/ai/planDay";
import { describePersona } from "@/lib/persona/describe";
import { consumeUsage, loadProfile, type Usage } from "@/lib/persona/server";
import { personaActive } from "@/types/persona";

// Older screens read `remaining`; it's only there for normal (non-persona) use
const remainingOf = (usage: Usage) => (usage.persona ? {} : { remaining: usage.remaining });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

// POST /api/ai
//   { mode: "plan" | "next", today: "YYYY-MM-DD", localTime: "HH:MM", availableMinutes?: number }
//   { mode: "steps", taskId: "<uuid>" }
// Requires "Authorization: Bearer <supabase access token>".
// With an active persona this is unlimited Persona AI; otherwise every answer
// uses one of the 10 daily AI messages (see consume_ai_credit).
export async function POST(request: Request) {
  const accessToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: {
    mode?: string;
    today?: string;
    localTime?: string;
    availableMinutes?: number;
    taskId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const { supabase, userId } = await getUserSession(accessToken);

    if (body.mode === "steps") {
      if (!body.taskId || !UUID_PATTERN.test(body.taskId)) {
        return Response.json({ error: "Missing task." }, { status: 400 });
      }
      const [task, profile] = await Promise.all([
        getTask(supabase, body.taskId),
        loadProfile(supabase, userId),
      ]);
      const usage = await consumeUsage(supabase, profile);
      const raw = await askAI(buildStepsPrompt(task));
      return Response.json({ result: parseSteps(raw, task.id), usage, ...remainingOf(usage) });
    }

    const mode = body.mode === "next" ? "next" : "plan";
    // "today" comes from the browser so it matches the user's timezone
    const today =
      body.today && DATE_PATTERN.test(body.today)
        ? body.today
        : new Date().toISOString().slice(0, 10);
    const localTime = (body.localTime ?? "").slice(0, 5) || "unknown";
    const minutes = Number(body.availableMinutes);
    const availableMinutes =
      Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60 ? minutes : null;

    const tasks = await getOpenTasks(supabase);
    if (tasks.length === 0) {
      // No AI call needed, so no credit used
      return Response.json({
        result: {
          kind: "message",
          text: "You have no open tasks. Add a few and I'll help you plan.",
        },
      });
    }

    const profile = await loadProfile(supabase, userId);
    const usage = await consumeUsage(supabase, profile);
    const persona = personaActive(profile) ? describePersona(profile) : "";
    const raw = await askAI(
      buildPrompt(mode, tasks, today, localTime, availableMinutes, persona)
    );
    const result = mode === "next" ? parseNext(raw, tasks) : parsePlan(raw, tasks);
    return Response.json({ result, usage, ...remainingOf(usage) });
  } catch (error) {
    if (error instanceof AIError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("AI route error:", error);
    return Response.json(
      { error: "Something went wrong. Try again." },
      { status: 500 }
    );
  }
}
