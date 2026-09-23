import {
  AIError,
  askAI,
  buildPrompt,
  getOpenTasksForUser,
  type AIMode,
} from "@/lib/ai/planDay";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/ai  { mode: "plan" | "next", today: "YYYY-MM-DD", localTime: "HH:MM" }
// Requires "Authorization: Bearer <supabase access token>".
export async function POST(request: Request) {
  const accessToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: { mode?: string; today?: string; localTime?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const mode: AIMode = body.mode === "next" ? "next" : "plan";
  // "today" comes from the browser so it matches the user's timezone
  const today =
    body.today && DATE_PATTERN.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);
  const localTime = (body.localTime ?? "").slice(0, 5) || "unknown";

  try {
    const tasks = await getOpenTasksForUser(accessToken);
    if (tasks.length === 0) {
      return Response.json({
        result: "You have no open tasks. Add a few and I'll help you plan.",
      });
    }

    const prompt = buildPrompt(mode, tasks, today, localTime);
    const result = await askAI(prompt.system, prompt.user);
    return Response.json({ result });
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
