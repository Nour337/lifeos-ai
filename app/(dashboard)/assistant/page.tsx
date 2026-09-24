"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getTasks } from "@/lib/queries/tasks";
import { getAICreditsLeft, getDisplayName } from "@/lib/queries/profiles";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";
import { applyProposal } from "@/lib/assistant/apply";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import ProposalCard, { type ProposalState } from "@/components/ProposalCard";
import { SparklesIcon } from "@/components/icons";
import { getGreeting, toLocalDateString } from "@/utils/date";
import { isOpen, type Task } from "@/types/task";
import type {
  AssistantResponse,
  ChatMessage,
  ConflictChoice,
  Proposal,
} from "@/lib/assistant/types";

type Message = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  proposal?: Proposal;
  proposalState?: ProposalState;
};

const SUGGESTIONS = [
  "Gym 3 days, then 1 day off, for 4 weeks at 18:00",
  "I have an exam in 10 days and need to study 5 chapters",
  "Tomorrow: study databases for 2 hours, then work on my project",
  "Move all unfinished tasks to tomorrow",
  "What did I complete this week?",
];

const storageKey = (userId: string) => `lifeos-chat-${userId}`;

// Deterministic morning summary (no AI call, so it doesn't use a credit)
function buildGreeting(name: string, tasks: Task[], today: string): string {
  const todays = tasks
    .filter((t) => t.due_date === today)
    .sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
  const open = todays.filter(isOpen);
  const overdue = tasks.filter((t) => isOpen(t) && t.due_date && t.due_date < today);

  const lines = [`${getGreeting()}, ${name} 👋`];
  if (todays.length) {
    lines.push("", "Today you have:");
    for (const t of todays) {
      const mark = isOpen(t) ? "•" : "✓";
      lines.push(`${mark} ${t.due_time ? `${t.due_time.slice(0, 5)} – ` : ""}${t.title}`);
    }
    lines.push("", `${open.length} of ${todays.length} still to do.`);
  } else {
    lines.push("", "Nothing is scheduled for today yet.");
  }
  if (overdue.length) {
    lines.push(`You also have ${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}.`);
  }
  lines.push("", "Tell me what you want to get done and I'll turn it into a plan. Would you like me to adjust your schedule?");
  return lines.join("\n");
}

export default function AssistantPage() {
  const { user, session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore today's conversation, or start a new one with the daily summary
  useEffect(() => {
    if (!user) return;
    const today = toLocalDateString();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(user.id)) ?? "null");
      if (saved?.date === today && Array.isArray(saved.messages) && saved.messages.length) {
        setMessages(saved.messages);
        getAICreditsLeft(user.id).then(setCreditsLeft);
        return;
      }
    } catch {
      // storage unavailable or corrupt: start fresh
    }
    Promise.all([getTasks().catch(() => [] as Task[]), getDisplayName(user.id)]).then(
      ([tasks, displayName]) => {
        const name = displayName ?? user.email?.split("@")[0] ?? "there";
        setMessages([{ id: "greeting", role: "assistant", content: buildGreeting(name, tasks, today) }]);
      }
    );
    getAICreditsLeft(user.id).then(setCreditsLeft);
  }, [user]);

  // Save the conversation (per user, per day)
  useEffect(() => {
    if (!user || messages.length === 0) return;
    try {
      localStorage.setItem(
        storageKey(user.id),
        JSON.stringify({ date: toLocalDateString(), messages: messages.slice(-40) })
      );
    } catch {
      // private mode etc.: the chat still works, it just won't be remembered
    }
  }, [messages, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const updateMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || !session || sending) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput("");
    setSending(true);

    // Only real turns go to the AI; errors are local
    const history: ChatMessage[] = next
      .filter((m): m is Message & { role: "user" | "assistant" } => m.role !== "error")
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const now = new Date();
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages: history,
          today: toLocalDateString(now),
          localTime: now.toTimeString().slice(0, 5),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<AssistantResponse> & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "The assistant is unavailable right now.");

      if (data.remaining !== undefined) setCreditsLeft(data.remaining);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply ?? "",
          proposal: data.proposal ?? undefined,
          proposalState: data.proposal ? "pending" : undefined,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error",
          content: e instanceof Error && e.message !== "Failed to fetch"
            ? e.message
            : "Couldn't reach the server. Check your connection.",
        },
      ]);
      if (user) getAICreditsLeft(user.id).then(setCreditsLeft);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const apply = async (message: Message, choices: Record<string, ConflictChoice>) => {
    if (!user || !message.proposal) return;
    updateMessage(message.id, { proposalState: "applying" });
    try {
      const r = await applyProposal(message.proposal, user.id, choices);
      updateMessage(message.id, { proposalState: "applied" });
      const parts = [
        r.created && `added ${r.created} task${r.created > 1 ? "s" : ""}`,
        r.updated && `updated ${r.updated}`,
        r.deleted && `deleted ${r.deleted}`,
        r.skipped && `skipped ${r.skipped} because of conflicts`,
      ].filter(Boolean);
      // Added to the history so the AI knows the plan was saved
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `✅ Done: ${parts.join(", ") || "nothing to change"}. You'll find it on your Today and Calendar screens.`,
        },
      ]);
      notifyTasksChanged();
    } catch (e) {
      updateMessage(message.id, { proposalState: "pending" });
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "error", content: (e as Error).message },
      ]);
    }
  };

  const startOver = () => {
    if (!user) return;
    try {
      localStorage.removeItem(storageKey(user.id));
    } catch {}
    setMessages([]);
    getTasks()
      .catch(() => [] as Task[])
      .then(async (tasks) => {
        const name = (await getDisplayName(user.id)) ?? user.email?.split("@")[0] ?? "there";
        setMessages([
          { id: "greeting", role: "assistant", content: buildGreeting(name, tasks, toLocalDateString()) },
        ]);
      });
  };

  const outOfCredits = creditsLeft === 0;
  const onlyGreeting = messages.length <= 1;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-grad-from to-grad-to text-white shadow-md shadow-accent/30">
            <SparklesIcon className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-ink">AI Assistant</h1>
            <p className="text-xs text-muted">
              {creditsLeft === null
                ? "Tell me what you want to accomplish"
                : `${creditsLeft} of ${AI_DAILY_LIMIT} messages left today`}
            </p>
          </div>
        </div>
        {!onlyGreeting && (
          <button onClick={startOver} className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-ink">
            New chat
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={m.role === "user" ? "max-w-[85%]" : "w-full max-w-[92%]"}>
              <div
                className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-gradient-to-br from-grad-from to-grad-to text-white"
                    : m.role === "error"
                      ? "rounded-bl-md bg-danger-soft text-danger"
                      : "rounded-bl-md bg-surface text-ink shadow-card"
                }`}
              >
                {m.content}
              </div>
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  state={m.proposalState ?? "pending"}
                  onApply={(choices) => apply(m, choices)}
                  onDiscard={() => updateMessage(m.id, { proposalState: "discarded" })}
                />
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex">
            <div className="flex gap-1 rounded-2xl rounded-bl-md bg-surface px-4 py-4 shadow-card">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 animate-bounce rounded-full bg-accent/60"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {onlyGreeting && !sending && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={outOfCredits}
                className="rounded-full bg-surface px-3.5 py-2 text-left text-sm text-ink shadow-card transition hover:bg-accent-soft hover:text-accent disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-24 mt-4 flex items-end gap-2 rounded-3xl bg-surface p-2 shadow-[0_8px_30px_rgba(26,27,46,0.12)] sm:bottom-4"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          disabled={outOfCredits}
          placeholder={
            outOfCredits
              ? `You've used today's ${AI_DAILY_LIMIT} messages. More tomorrow!`
              : "Tell me what you want to do…"
          }
          aria-label="Message the assistant"
          className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending || outOfCredits}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-grad-from to-grad-to text-white shadow-md shadow-accent/30 transition active:scale-95 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
