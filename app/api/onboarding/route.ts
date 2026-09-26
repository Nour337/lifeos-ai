import { handle } from "@/lib/ai/server";
import { metered } from "@/lib/ai/usage";
import type { ChatMessage } from "@/lib/assistant/types";
import { askOnboarding, finishOnboarding, saveOnboardingTurn, toResponse } from "@/lib/persona/onboarding";
import { quickStartDone, sectionStatus } from "@/lib/persona/sections";
import { loadPersona } from "@/lib/persona/server";
import { toSeries } from "@/lib/series";
import type { Project } from "@/types/project";
import type { Series } from "@/types/task";

const MAX_MESSAGE_LENGTH = 2000;

type Body = { messages?: unknown; today?: unknown; localTime?: unknown; mode?: unknown };

// POST /api/onboarding
//   { messages: ChatMessage[], mode?: "onboarding" | "update" }
// Requires "Authorization: Bearer <supabase access token>".
// Creating the persona is free (onboarding points cost 0, capped per day).
// What the AI learns is saved straight away; the response is its next question.
export async function POST(request: Request) {
  return handle<Body>(request, "Onboarding", async (body, { supabase, userId }) => {
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
    const mode = body.mode === "update" ? "update" : "onboarding";

    const { value } = await metered(supabase, "onboarding", async (meter) => {
      const data = await loadPersona(supabase, userId, body, { ensureSeries: false });
      const args = await askOnboarding(data, messages, mode, meter);
      const { profile, finished } = await saveOnboardingTurn(supabase, userId, data, args);

      // Recount sections with the projects, goals and routines saved this turn
      const [projects, goals, series] = await Promise.all([
        supabase.from("projects").select("kind"),
        supabase.from("goals").select("id"),
        supabase.from("task_series").select("*"),
      ]);
      const sections = sectionStatus(
        profile,
        (projects.data ?? []) as Pick<Project, "kind">[],
        goals.data ?? [],
        (series.data ?? []).map(toSeries).filter((s): s is Series => !!s)
      );

      // Quick start covered: finish now instead of asking "ready to wrap up?"
      if (mode === "onboarding" && !finished && quickStartDone(sections) && args.widget !== "style" && args.widget !== "interests") {
        const userTurns = messages.filter((m) => m.role === "user").length;
        if (userTurns >= 3) {
          const fresh = await loadPersona(supabase, userId, body, { ensureSeries: false });
          const reply = await finishOnboarding(supabase, userId, fresh, meter);
          return toResponse({ ...args, reply, quick_replies: [] }, sections, true);
        }
      }
      return toResponse(args, sections, finished);
    });

    return Response.json(value);
  });
}
