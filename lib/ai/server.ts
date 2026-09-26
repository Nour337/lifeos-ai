import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { nowInZone } from "@/utils/date";

// Shared by every API route: the signed-in user's Supabase client, their
// clock, and turning errors into friendly JSON responses.

export class AIError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// A Supabase client that acts as the signed-in user (their access token), so
// row level security still applies and the AI only ever sees that user's data.
export async function getUserSession(
  accessToken: string
): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new AIError("Your session has expired. Please log in again.", 401);
  }
  return { supabase, userId: data.user.id };
}

export type Clock = { today: string; localTime: string; timeZone: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

// The user's date and time come from their saved timezone. The browser's
// values are only used before a timezone was saved.
export function userClock(timeZone: string, fallback?: { today?: unknown; localTime?: unknown }): Clock {
  if (timeZone && timeZone !== "UTC") return { ...nowInZone(timeZone), timeZone };
  const now = nowInZone("UTC");
  return {
    today: typeof fallback?.today === "string" && DATE_PATTERN.test(fallback.today) ? fallback.today : now.today,
    localTime:
      typeof fallback?.localTime === "string" && TIME_PATTERN.test(fallback.localTime)
        ? fallback.localTime
        : now.localTime,
    timeZone: "UTC",
  };
}

// Runs a POST handler with the parsed body and the user's session;
// AIError becomes { error } with its status, anything else a 500.
export async function handle<B extends Record<string, unknown>>(
  request: Request,
  name: string,
  run: (body: B, session: { supabase: SupabaseClient; userId: string }) => Promise<Response>
): Promise<Response> {
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: B;
  try {
    body = (await request.json()) as B;
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    return await run(body, await getUserSession(accessToken));
  } catch (error) {
    if (error instanceof AIError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(`${name} route error:`, error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
