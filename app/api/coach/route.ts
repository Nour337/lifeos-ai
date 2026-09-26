import { AIError, handle } from "@/lib/ai/server";
import { metered, type Budget } from "@/lib/ai/usage";
import {
  breakIntoSteps,
  planNow,
  recoverySet,
  reviewWeek,
  suggestionHash,
  suggestTasks,
} from "@/lib/persona/coach";
import { loadPersona } from "@/lib/persona/server";
import type { SuggestionSet, WeeklyReview } from "@/lib/persona/types";
import { normalizeTask, type Task } from "@/types/task";
import { addDays } from "@/utils/date";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

type Body = {
  mode?: unknown;
  today?: unknown;
  localTime?: unknown;
  minutes?: unknown;
  exclude?: unknown;
  weekStart?: unknown;
  refresh?: unknown;
  taskId?: unknown;
};

// POST /api/coach
//   { mode: "suggest", refresh? }               -> { suggestions: SuggestionSet, budget? }
//   { mode: "now", minutes?, exclude? }         -> { result: NowResult, budget }
//   { mode: "review", weekStart }               -> { review: WeeklyReview, budget }
//   { mode: "steps", taskId }                   -> { steps: string[], budget }
// Requires "Authorization: Bearer <supabase access token>". Dates come from
// the user's saved timezone (today / localTime are only a fallback).
// Suggestions are made once a day (and again only when the user's areas
// change or they ask); with a big overdue backlog they're catch-up picks,
// which need no AI.
export async function POST(request: Request) {
  return handle<Body>(request, "Coach", async (body, { supabase, userId }) => {
    if (body.mode === "suggest") {
      const data = await loadPersona(supabase, userId, body);
      const { today } = data.clock;
      const hash = suggestionHash(data);

      if (body.refresh !== true) {
        const { data: cached } = await supabase
          .from("daily_suggestions")
          .select("day, hash, items, handled")
          .eq("day", today)
          .maybeSingle();
        if (cached && cached.hash === hash) {
          return Response.json({
            suggestions: {
              day: cached.day,
              items: cached.items,
              handled: cached.handled ?? [],
              recovery: (cached.items as { kind?: string }[]).some((s) => s.kind === "recover"),
            } satisfies SuggestionSet,
          });
        }
      }

      let set = body.refresh === true ? null : recoverySet(data);
      let budget: Budget | undefined;
      if (!set) ({ value: set, budget } = await metered(supabase, "suggest", (meter) => suggestTasks(data, meter)));

      const { error } = await supabase
        .from("daily_suggestions")
        .upsert({ user_id: userId, day: today, hash, items: set.items, handled: [] }, { onConflict: "user_id,day" });
      if (error) console.error("Saving suggestions failed:", error.message);
      return Response.json({ suggestions: set, budget });
    }

    if (body.mode === "now") {
      const n = Math.round(Number(body.minutes));
      const minutes = Number.isFinite(n) && n >= 10 && n <= 12 * 60 ? n : null;
      const exclude = (Array.isArray(body.exclude) ? body.exclude : [])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.slice(0, 120))
        .slice(0, 10);
      const data = await loadPersona(supabase, userId, body);
      const { value: result, budget } = await metered(supabase, "now", (meter) =>
        planNow(data, minutes, exclude, meter)
      );
      return Response.json({ result, budget });
    }

    if (body.mode === "review") {
      if (typeof body.weekStart !== "string" || !DATE_PATTERN.test(body.weekStart)) {
        return Response.json({ error: "Missing week." }, { status: 400 });
      }
      const weekStart = body.weekStart;
      const [data, previous] = await Promise.all([
        loadPersona(supabase, userId, body),
        supabase.from("weekly_reviews").select("review").eq("week_start", addDays(weekStart, -7)).maybeSingle(),
      ]);
      const before = (previous.data?.review as WeeklyReview | undefined)?.stats?.progress ?? null;
      const { value: review, budget } = await metered(supabase, "review", (meter) =>
        reviewWeek(data, weekStart, before, meter)
      );

      const { error } = await supabase
        .from("weekly_reviews")
        .upsert({ user_id: userId, week_start: weekStart, review }, { onConflict: "user_id,week_start" });
      if (error) console.error("Saving review failed:", error.message);
      return Response.json({ review, budget });
    }

    if (body.mode === "steps") {
      if (typeof body.taskId !== "string" || !UUID_PATTERN.test(body.taskId)) {
        return Response.json({ error: "Missing task." }, { status: 400 });
      }
      const { data: row, error } = await supabase.from("tasks").select("*").eq("id", body.taskId).maybeSingle();
      if (error) throw new AIError("Couldn't load the task.", 500);
      if (!row) throw new AIError("Task not found.", 404);
      const data = await loadPersona(supabase, userId, body, { ensureSeries: false });
      const { value: steps, budget } = await metered(supabase, "steps", (meter) =>
        breakIntoSteps(normalizeTask(row as Task), data, meter)
      );
      return Response.json({ steps, budget });
    }

    return Response.json({ error: "Unknown mode." }, { status: 400 });
  });
}
