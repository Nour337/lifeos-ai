import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError } from "@/lib/ai/server";
import type { LLMResult } from "@/lib/ai/llm";
import { DEFAULT_DAILY_POINTS, type AIKind, type Budget } from "@/lib/ai/budget";

// One daily AI budget, measured in points (see consume_ai in
// supabase/migrations/20260926120000_ai_budget.sql and AI_COSTS in
// lib/ai/budget.ts).

export type { AIKind, Budget };

// Collects the tokens of every model call made for one request
export type Meter = { add: (result: LLMResult) => void };

const LIMIT_MESSAGES: Record<string, (limit?: number) => string> = {
  daily_limit: (limit) =>
    `You've used today's ${limit ?? DEFAULT_DAILY_POINTS} AI points. They reset at midnight; everything else keeps working.`,
  rate_limit: () => "That's a lot of AI requests at once. Wait a minute and try again.",
  kind_limit: () => "You've reached today's limit for this. It resets at midnight.",
};

// Reserves the points, runs the request, then settles: a failed request
// gets its points back. Returns the value and what's left of today's budget.
export async function metered<T>(
  supabase: SupabaseClient,
  kind: AIKind,
  run: (meter: Meter) => Promise<T>
): Promise<{ value: T; budget: Budget }> {
  const { data, error } = await supabase.rpc("consume_ai", { p_kind: kind });
  if (error) {
    console.error("consume_ai failed:", error.message);
    throw new AIError("Couldn't check your AI budget. Try again.", 500);
  }
  const reply = (data ?? {}) as { call_id?: number; remaining?: number; limit?: number; error?: string };
  if (reply.error) {
    throw new AIError((LIMIT_MESSAGES[reply.error] ?? LIMIT_MESSAGES.kind_limit)(reply.limit), 429);
  }

  const usage = { model: null as string | null, input: 0, output: 0, ms: 0 };
  const meter: Meter = {
    add: (r) => {
      usage.model = r.model;
      usage.input += r.inputTokens;
      usage.output += r.outputTokens;
      usage.ms += r.ms;
    },
  };

  const finish = (ok: boolean) =>
    supabase
      .rpc("finish_ai", {
        p_call_id: reply.call_id,
        p_ok: ok,
        p_model: usage.model,
        p_input_tokens: usage.input,
        p_output_tokens: usage.output,
        p_latency_ms: usage.ms,
      })
      .then(({ error: e }) => e && console.error("finish_ai failed:", e.message));

  try {
    const value = await run(meter);
    await finish(true);
    return { value, budget: { remaining: reply.remaining ?? 0, limit: reply.limit ?? DEFAULT_DAILY_POINTS } };
  } catch (e) {
    await finish(false);
    throw e;
  }
}
