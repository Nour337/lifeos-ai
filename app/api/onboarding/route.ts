import { AIError, getUserSession } from "@/lib/ai/planDay";
import { consumeExtraCredit, loadPersona } from "@/lib/persona/server";
import {
  askOnboarding,
  finishOnboarding,
  saveOnboardingTurn,
  toResponse,
} from "@/lib/persona/onboarding";
import { sectionStatus } from "@/lib/persona/sections";
import type { ChatMessage } from "@/lib/assistant/types";
import type { Project } from "@/types/project";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESSAGE_LENGTH = 2000;

// POST /api/onboarding
//   { messages: ChatMessage[], today: "YYYY-MM-DD", mode?: "onboarding" | "update" }
// Requires "Authorization: Bearer <supabase access token>".
// Creating the persona never uses the 10 daily AI messages. What the
// AI learns is saved straight away; the response is its next question.
export async function POST(request: Request) {
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: { messages?: unknown; today?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Send a message first." }, { status: 400 });
  }

  const today =
    body.today && DATE_PATTERN.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const mode = body.mode === "update" ? "update" : "onboarding";

  try {
    const { supabase, userId } = await getUserSession(accessToken);
    const remaining = await consumeExtraCredit(supabase, "onboarding");
    const data = await loadPersona(supabase, userId, today);
    const args = await askOnboarding(data, messages, today, mode);
    const { profile, finished } = await saveOnboardingTurn(supabase, userId, data, args);

    // Recount sections with the projects and goals saved this turn
    const [projects, goals] = await Promise.all([
      supabase.from("projects").select("kind"),
      supabase.from("goals").select("id"),
    ]);
    const sections = sectionStatus(
      profile,
      (projects.data ?? []) as Pick<Project, "kind">[],
      goals.data ?? []
    );

    // Everything is known: finish now instead of asking "ready to wrap up?"
    if (mode === "onboarding" && !finished && Object.values(sections).every(Boolean)) {
      const fresh = await loadPersona(supabase, userId, today);
      const reply = await finishOnboarding(supabase, userId, fresh, today);
      return Response.json({
        ...toResponse({ ...args, reply, quick_replies: [] }, sections, true),
        remaining,
      });
    }

    return Response.json({ ...toResponse(args, sections, finished), remaining });
  } catch (error) {
    if (error instanceof AIError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Onboarding route error:", error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
