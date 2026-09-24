import type { Session } from "@supabase/supabase-js";
import type { AIResult } from "@/lib/ai/planDay";

export type AIResponse = { result: AIResult; remaining?: number };

// Browser-side helper for POST /api/ai. Throws an Error with a friendly
// message on failure.
export async function callAI(
  session: Session,
  body: Record<string, unknown>
): Promise<AIResponse> {
  let response: Response;
  try {
    response = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "The assistant is unavailable right now.");
  }
  return data as AIResponse;
}
