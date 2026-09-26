import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "@/lib/assistant/context";
import { savePersonaUpdate } from "@/lib/assistant/persona-update";
import type { ChatMessage, Proposal, Remembered, StoredMessage } from "@/lib/assistant/types";
import { CHEAP_MODEL, completeJSON } from "@/lib/ai/llm";
import { AIError } from "@/lib/ai/server";
import { metered } from "@/lib/ai/usage";
import { liveMemory, MEMORY_LIMIT, parseMemoryItem, type MemoryItem } from "@/types/persona";

// Conversations are stored on the server. The model sees a running summary
// of older turns plus the most recent messages; anything lasting that came
// up is saved to the persona (structured data), so the AI never depends on
// a long chat to remember who the user is.

const RECENT_MESSAGES = 12; // sent as-is
const COMPACT_AFTER = 18; // unsummarized messages before older ones are folded in
const KEEP_AFTER_COMPACT = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Conversation = {
  id: string;
  title: string | null;
  summary: string | null;
  summarized_upto: number;
};

export async function getConversation(
  supabase: SupabaseClient,
  userId: string,
  id: unknown,
  firstMessage: string
): Promise<Conversation> {
  if (typeof id === "string" && UUID.test(id)) {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, summary, summarized_upto")
      .eq("id", id)
      .maybeSingle();
    if (data) return data as Conversation;
  }
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: firstMessage.slice(0, 80) })
    .select("id, title, summary, summarized_upto")
    .single();
  if (error || !data) {
    console.error("Creating conversation failed:", error?.message);
    throw new AIError("Couldn't start the conversation.", 500);
  }
  return data as Conversation;
}

export async function addMessage(
  supabase: SupabaseClient,
  conversation: Conversation,
  userId: string,
  message: {
    role: "user" | "assistant";
    content: string;
    proposal?: Proposal | null;
    remembered?: Remembered | null;
  }
): Promise<StoredMessage> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      user_id: userId,
      role: message.role,
      content: message.content.slice(0, 8000),
      proposal: message.proposal ?? null,
      proposal_state: message.proposal ? "pending" : null,
      remembered: message.remembered ?? null,
    })
    .select("id, role, content, proposal, proposal_state, remembered, created_at")
    .single();
  if (error || !data) {
    console.error("Saving message failed:", error?.message);
    throw new AIError("Couldn't save the message.", 500);
  }
  await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);
  return data as StoredMessage;
}

// What happened to a plan, so the model knows whether it was saved
function asChat(m: StoredMessage): ChatMessage {
  if (!m.proposal) return { role: m.role, content: m.content };
  const state =
    m.proposal_state === "applied"
      ? "the user APPLIED it (it is saved)"
      : m.proposal_state === "discarded"
        ? "the user DISCARDED it"
        : "the user hasn't answered yet";
  return { role: m.role, content: `${m.content}\n[Proposed plan: ${m.proposal.summary} — ${state}]` };
}

async function unsummarized(supabase: SupabaseClient, conversation: Conversation): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, proposal, proposal_state, remembered, created_at")
    .eq("conversation_id", conversation.id)
    .gt("id", conversation.summarized_upto)
    .order("id", { ascending: true })
    .limit(200);
  if (error) throw new AIError("Couldn't load the conversation.", 500);
  return (data ?? []) as StoredMessage[];
}

// The model's view of the conversation: summary + recent turns
export async function historyFor(
  supabase: SupabaseClient,
  conversation: Conversation
): Promise<{ summary: string | null; messages: ChatMessage[] }> {
  const messages = await unsummarized(supabase, conversation);
  const recent = messages.slice(-RECENT_MESSAGES);
  // The history must start with a user turn
  while (recent.length && recent[0].role !== "user") recent.shift();
  return { summary: conversation.summary, messages: recent.map(asChat) };
}

// When a conversation grows, older turns are folded into its summary.
// Lasting facts from them are saved to the persona first (shown to the
// user with Undo), and a full memory is merged instead of cut.
export async function compactIfNeeded(
  ctx: Context,
  conversation: Conversation
): Promise<Remembered | null> {
  const messages = await unsummarized(ctx.supabase, conversation);
  const liveNotes = liveMemory(ctx.data.profile.ai_profile.memory, ctx.today);
  const memoryFull = liveNotes.filter((m) => !m.pinned).length > MEMORY_LIMIT - 10;
  if (messages.length <= COMPACT_AFTER && !memoryFull) return null;

  const fold = messages.length > COMPACT_AFTER ? messages.slice(0, -KEEP_AFTER_COMPACT) : [];
  const transcript = fold
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${asChat(m).content}`)
    .join("\n")
    .slice(-16000);

  try {
    const { value } = await metered(ctx.supabase, "summarize", (meter) =>
      completeJSON(
        "You maintain the memory of a personal planning assistant. Be factual and brief. Answer with JSON only.",
        `${conversation.summary ? `Summary so far:\n${conversation.summary}\n\n` : ""}${
          transcript ? `New part of the conversation:\n${transcript}\n\n` : ""
        }Notes the assistant already keeps about the user:\n${liveNotes
          .map((m) => `[${m.id}]${m.pinned ? " (pinned)" : ""} ${m.text}`)
          .join("\n") || "(none)"}

Return JSON:
- "summary": ${transcript ? "an updated summary of the whole conversation in at most 8 short lines: decisions made, plans applied or discarded, open questions. Leave out facts about the user (they go in facts)." : "the summary so far, unchanged."}
- "facts": lasting facts about the user from the new part that are NOT already in the notes, e.g. {"text": "Works night shifts on Fridays", "category": "constraint", "expires": null}. Categories: fact, preference, constraint, event. "expires" = YYYY-MM-DD when it stops being true, or null. Empty list if none.
- "merge": ${memoryFull ? "the notes rewritten to at most " + (MEMORY_LIMIT - 20) + " items: merge duplicates and related notes, drop anything outdated. Keep pinned notes word for word. Each item {\"id\": existing id or null, \"text\", \"category\"}." : "null"}`,
        { maxTokens: 1500, model: CHEAP_MODEL(), meter }
      )
    );
    const result = (value ?? {}) as { summary?: unknown; facts?: unknown; merge?: unknown };

    if (fold.length && typeof result.summary === "string" && result.summary.trim()) {
      const upto = fold[fold.length - 1].id;
      await ctx.supabase
        .from("conversations")
        .update({ summary: result.summary.trim().slice(0, 3000), summarized_upto: upto })
        .eq("id", conversation.id);
      conversation.summary = result.summary.trim().slice(0, 3000);
      conversation.summarized_upto = upto;
    }

    // Merge first (so new facts aren't merged away), then add the facts
    if (memoryFull && Array.isArray(result.merge) && result.merge.length) {
      const pinned = ctx.data.profile.ai_profile.memory.filter((m) => m.pinned);
      const merged = (result.merge as unknown[])
        .map((raw) => {
          const item = parseMemoryItem({ source: "ai", ...(raw as object) });
          const original = ctx.data.profile.ai_profile.memory.find((m) => m.id === (raw as { id?: string })?.id);
          return item && original ? { ...item, created_at: original.created_at, source: original.source } : item;
        })
        .filter((m): m is MemoryItem => !!m && !pinned.some((p) => p.id === m.id));
      const memory = [...pinned, ...merged].slice(0, MEMORY_LIMIT);
      const { error } = await ctx.supabase
        .from("profiles")
        .update({ ai_profile: { ...ctx.data.profile.ai_profile, memory } })
        .eq("id", ctx.data.profile.id);
      if (!error) ctx.data.profile.ai_profile.memory = memory;
    }

    const facts = Array.isArray(result.facts) ? result.facts.slice(0, 5) : [];
    return facts.length ? await savePersonaUpdate(ctx, { facts }) : null;
  } catch (e) {
    // A failed summary isn't worth failing the user's message for
    console.error("Compacting conversation failed:", (e as Error).message);
    return null;
  }
}
