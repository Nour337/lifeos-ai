import { buildContext } from "@/lib/assistant/context";
import { addMessage, compactIfNeeded, getConversation, historyFor } from "@/lib/assistant/conversation";
import { answerIntent } from "@/lib/assistant/intents";
import { busyConflictFix, savePersonaUpdate } from "@/lib/assistant/persona-update";
import { buildProposal, checkProposal } from "@/lib/assistant/proposal";
import { askAssistant } from "@/lib/assistant/server";
import type { AssistantResponse, Proposal, Remembered } from "@/lib/assistant/types";
import { AIError, handle } from "@/lib/ai/server";
import { metered } from "@/lib/ai/usage";
import { loadPersona } from "@/lib/persona/server";

const MAX_MESSAGE_LENGTH = 2000;

type Body = { message?: unknown; conversationId?: unknown; today?: unknown; localTime?: unknown };

// Two sets of persona changes in one reply (facts from compaction + this turn)
function combine(a: Remembered | null, b: Remembered | null): Remembered | null {
  if (!a || !b) return a ?? b;
  return {
    changes: [...a.changes, ...b.changes].slice(0, 10),
    undo: {
      profile: { ...b.undo.profile, ...a.undo.profile }, // the earliest "before" wins
      rows: [...a.undo.rows, ...b.undo.rows],
    },
  };
}

// New busy hours: tasks that now overlap them are moved in the same plan
function withConflictFix(proposal: Proposal | null, fix: Proposal | null, input: Parameters<typeof checkProposal>[1]) {
  if (!fix) return proposal;
  if (!proposal) return fix;
  const touched = new Set(proposal.updates.map((u) => u.taskId));
  proposal.updates.push(...fix.updates.filter((u) => !touched.has(u.taskId)));
  proposal.summary = `${proposal.summary} ${fix.summary}`;
  checkProposal(proposal, input);
  return proposal;
}

// POST /api/assistant
//   { message: string, conversationId?: uuid, today?, localTime? }
// Requires "Authorization: Bearer <supabase access token>".
// The conversation is stored on the server. Simple requests are answered
// from the data for free; everything else uses one AI point. Nothing is
// written to the task list here: changes come back as a proposal the user
// applies. Persona updates are saved right away (with undo).
export async function POST(request: Request) {
  return handle<Body>(request, "Assistant", async (body, { supabase, userId }) => {
    const content = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
    if (!content) return Response.json({ error: "Send a message first." }, { status: 400 });

    const data = await loadPersona(supabase, userId, body);
    const ctx = buildContext(supabase, data);
    const conversation = await getConversation(supabase, userId, body.conversationId, content);
    const userMessage = await addMessage(supabase, conversation, userId, { role: "user", content });

    // Answered from the data: no AI, no points
    const intent = answerIntent(ctx, content);
    if (intent) {
      const message = await addMessage(supabase, conversation, userId, {
        role: "assistant",
        content: intent.reply,
        proposal: intent.proposal,
      });
      return Response.json({
        conversationId: conversation.id,
        message,
        userMessageId: userMessage.id,
        free: true,
      } satisfies AssistantResponse);
    }

    const compacted = await compactIfNeeded(ctx, conversation);
    const history = await historyFor(supabase, conversation);

    const { value, budget } = await metered(supabase, "chat", async (meter) => {
      const { text, plan, personaUpdate } = await askAssistant(ctx, history, meter);
      const remembered = personaUpdate ? await savePersonaUpdate(ctx, personaUpdate) : null;
      let proposal = plan ? buildProposal(plan, ctx) : null;
      if (remembered && "blocks" in remembered.undo.profile) {
        proposal = withConflictFix(proposal, busyConflictFix(ctx), ctx.input);
      }
      if (!text && !proposal && !remembered) {
        throw new AIError(
          plan
            ? "I couldn't turn that into tasks. Could you say it another way, with dates or days?"
            : "Sorry, I didn't get that. Could you rephrase?",
          502
        );
      }
      return { text, proposal, remembered };
    });

    const remembered = combine(compacted, value.remembered);
    const reply =
      value.text ||
      value.proposal?.summary ||
      (remembered ? "Got it, I've updated what I know about you." : "Done.");
    const message = await addMessage(supabase, conversation, userId, {
      role: "assistant",
      content: reply,
      proposal: value.proposal,
      remembered,
    });

    return Response.json({
      conversationId: conversation.id,
      message,
      userMessageId: userMessage.id,
      budget,
    } satisfies AssistantResponse);
  });
}
