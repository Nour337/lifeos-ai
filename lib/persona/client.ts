import type { Session } from "@supabase/supabase-js";
import type { Budget } from "@/lib/ai/budget";

// Browser-side POST to one of the AI routes. Throws an Error with a friendly
// message on failure. A returned budget is announced so every meter on the
// screen updates.
export async function postAI<T>(
  session: Session,
  path: "/api/coach" | "/api/onboarding" | "/api/assistant",
  body: Record<string, unknown>
): Promise<T & { budget?: Budget }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...nowFields(), ...body }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A limit or failure may have changed the count: let meters reload
    announceBudget(null);
    throw new Error(data.error ?? "The AI is unavailable right now.");
  }
  if (data.budget) announceBudget(data.budget);
  return data;
}

export const BUDGET_EVENT = "lifeos:ai-budget";

// null = "reload it"
export function announceBudget(budget: Budget | null) {
  window.dispatchEvent(new CustomEvent(BUDGET_EVENT, { detail: budget }));
}

// Date and time from the browser: only a fallback for the server, which
// uses the timezone saved in the profile
export function nowFields(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// Hand a message to the assistant screen, which sends it on arrival
// ("Plan my week" after onboarding, "Plan next week" from the review...).
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

// Everything this app keeps in the browser for a user (cleared on logout)
export function clearLocalData() {
  try {
    for (const store of [localStorage, sessionStorage]) {
      Object.keys(store)
        .filter((key) => key.startsWith("lifeos-"))
        .forEach((key) => store.removeItem(key));
    }
  } catch {
    // storage blocked: nothing to clear
  }
}
