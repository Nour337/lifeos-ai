import { AIError, getUserSession } from "@/lib/ai/planDay";
import { consumeUsage, loadPersona } from "@/lib/persona/server";
import { planNow, reviewWeek, suggestTasks } from "@/lib/persona/coach";
import type { WeeklyReview } from "@/lib/persona/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

// POST /api/coach
//   { mode: "suggest", today, localTime }                    -> { suggestions }
//   { mode: "now", today, localTime, minutes?, exclude? }    -> { result }
//   { mode: "review", today, localTime, weekStart }          -> { review }
// Requires "Authorization: Bearer <supabase access token>".
// With an active persona these are unlimited Persona AI; without one each
// uses one of the 10 daily AI messages. Every response includes `usage`.
export async function POST(request: Request) {
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: {
    mode?: string;
    today?: string;
    localTime?: string;
    minutes?: number;
    exclude?: unknown;
    weekStart?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const today =
    body.today && DATE_PATTERN.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const localTime = body.localTime && TIME_PATTERN.test(body.localTime) ? body.localTime : "12:00";

  try {
    const { supabase, userId } = await getUserSession(accessToken);

    if (body.mode === "suggest") {
      const data = await loadPersona(supabase, userId, today);
      const usage = await consumeUsage(supabase, data.profile);
      const suggestions = await suggestTasks(data, today, localTime);
      return Response.json({ suggestions, usage });
    }

    if (body.mode === "now") {
      const n = Math.round(Number(body.minutes));
      const minutes = Number.isFinite(n) && n >= 10 && n <= 12 * 60 ? n : null;
      const exclude = (Array.isArray(body.exclude) ? body.exclude : [])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.slice(0, 120))
        .slice(0, 10);
      const data = await loadPersona(supabase, userId, today);
      const usage = await consumeUsage(supabase, data.profile);
      const result = await planNow(data, today, localTime, minutes, exclude);
      return Response.json({ result, usage });
    }

    if (body.mode === "review") {
      if (!body.weekStart || !DATE_PATTERN.test(body.weekStart)) {
        return Response.json({ error: "Missing week." }, { status: 400 });
      }
      const weekStart = body.weekStart;
      const [y, m, d] = weekStart.split("-").map(Number);
      const previousStart = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);

      const [data, previous] = await Promise.all([
        loadPersona(supabase, userId, today),
        supabase
          .from("weekly_reviews")
          .select("review")
          .eq("week_start", previousStart)
          .maybeSingle(),
      ]);
      const usage = await consumeUsage(supabase, data.profile);
      const before = (previous.data?.review as WeeklyReview | undefined)?.stats?.progress ?? null;
      const review = await reviewWeek(data, weekStart, today, localTime, before);

      const { error } = await supabase
        .from("weekly_reviews")
        .upsert({ user_id: userId, week_start: weekStart, review }, { onConflict: "user_id,week_start" });
      if (error) console.error("Saving review failed:", error.message);
      return Response.json({ review, usage });
    }

    return Response.json({ error: "Unknown mode." }, { status: 400 });
  } catch (error) {
    if (error instanceof AIError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Coach route error:", error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
