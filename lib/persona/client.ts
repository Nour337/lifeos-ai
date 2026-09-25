import type { Session } from "@supabase/supabase-js";
import type { Usage } from "@/lib/persona/types";

// Browser-side POST to one of the AI routes. Throws an Error with a friendly
// message on failure.
export async function postAI<T>(
  session: Session,
  path: "/api/coach" | "/api/onboarding",
  body: Record<string, unknown>
): Promise<T & { usage?: Usage; remaining?: number }> {
  let response: Response;
  try {
    response = await fetch(path, {
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
    throw new Error(data.error ?? "The AI is unavailable right now.");
  }
  return data;
}

// Date and time in the user's own timezone, for every AI request
export function nowFields(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// Hand a message to the assistant screen, which sends it on arrival
// ("Plan my week" after onboarding, "Change" on a plan...).
const PROMPT_KEY = "lifeos-assistant-prompt";

export function queueAssistantPrompt(text: string) {
  try {
    sessionStorage.setItem(PROMPT_KEY, text);
  } catch {
    // storage blocked: the user just lands on the assistant
  }
}

export function takeAssistantPrompt(): string | null {
  try {
    const text = sessionStorage.getItem(PROMPT_KEY);
    sessionStorage.removeItem(PROMPT_KEY);
    return text;
  } catch {
    return null;
  }
}
