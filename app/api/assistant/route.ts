import { AIError, consumeCredit, getUserClient } from "@/lib/ai/planDay";
import { askAssistant, buildProposal, loadContext } from "@/lib/assistant/server";
import type { AssistantResponse, ChatMessage } from "@/lib/assistant/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const MAX_MESSAGE_LENGTH = 2000;

// POST /api/assistant
//   { messages: ChatMessage[], today: "YYYY-MM-DD", localTime: "HH:MM" }
// Requires "Authorization: Bearer <supabase access token>".
// Each user message uses one daily AI credit. Nothing is written to the
// database here: changes come back as a proposal the user approves.
export async function POST(request: Request) {
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: { messages?: unknown; today?: string; localTime?: string };
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

  // "today" and the time come from the browser so they match the user's timezone
  const today =
    body.today && DATE_PATTERN.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const localTime =
    body.localTime && TIME_PATTERN.test(body.localTime) ? body.localTime : "12:00";

  try {
    const supabase = await getUserClient(accessToken);
    const remaining = await consumeCredit(supabase);
    const ctx = await loadContext(supabase, today, localTime);
    const { text, args } = await askAssistant(ctx, messages);
    const proposal = args ? buildProposal(args, ctx) : null;

    const reply =
      text ||
      proposal?.summary ||
      (args
        ? "I couldn't turn that into tasks. Could you say it another way, with dates or days?"
        : "Sorry, I didn't get that. Could you rephrase?");

    return Response.json({ reply, proposal, remaining } satisfies AssistantResponse);
  } catch (error) {
    if (error instanceof AIError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Assistant route error:", error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
