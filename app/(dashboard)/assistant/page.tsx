"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { takeAssistantPrompt } from "@/lib/persona/client";
import { useAuth } from "@/lib/AuthContext";
import { getTasks } from "@/lib/queries/tasks";
import { getAICreditsLeft } from "@/lib/queries/profiles";
import { getProfile } from "@/lib/queries/persona";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";
import { applyProposal } from "@/lib/assistant/apply";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import ProposalCard, { type ProposalState } from "@/components/ProposalCard";
import { BrainIcon, SparklesIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import { getGreeting, toLocalDateString } from "@/utils/date";
import { isOpen, type Task } from "@/types/task";
import { personaActive, roleOf, type Profile } from "@/types/persona";
import type {
  AssistantResponse,
  ChatMessage,
  ConflictChoice,
  Proposal,
} from "@/lib/assistant/types";

type Mode = "chat" | "persona";

type Message = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  proposal?: Proposal;
  proposalState?: ProposalState;
  remembered?: string[];
};

const SUGGESTIONS: Record<Mode, string[]> = {
  chat: [
    "What's on my schedule today?",
    "Gym 3 days, then 1 day off, for 4 weeks at 18:00",
    "Move all unfinished tasks to tomorrow",
    "What did I complete this week?",
  ],
  persona: [
    "Plan my week",
    "What should I work on today?",
    "I have 2 hours free",
    "Balance my study and work this week",
    "Suggest tasks for my goals",
    "I started working",
  ],
};

const storageKey = (userId: string, mode: Mode) =>
  mode === "chat" ? `lifeos-chat-${userId}` : `lifeos-persona-chat-${userId}`;

// Deterministic day summary (no AI call, so nothing is counted)
function buildGreeting(mode: Mode, profile: Profile | null, fallbackName: string, tasks: Task[], today: string): string {
  const name = profile?.display_name ?? fallbackName;
  const todays = tasks
    .filter((t) => t.due_date === today)
    .sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
  const open = todays.filter(isOpen);
  const overdue = tasks.filter((t) => isOpen(t) && t.due_date && t.due_date < today);

  const lines = [`${getGreeting()}, ${name} 👋`];
  if (mode === "persona" && profile) {
    const roles = profile.ai_profile.about.roles.map((r) => `${roleOf(r).emoji} ${roleOf(r).label}`);
    lines.push(
      "",
      `Persona mode is on${roles.length ? ` (${roles.join(" + ")})` : ""}. I know your courses, work, goals and schedule, so just tell me what you need. This chat is unlimited.`
    );
  }
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
  lines.push(
    "",
    mode === "persona"
      ? "Want me to plan your day or week around your goals?"
      : "Tell me what you want to get done and I'll turn it into a plan."
  );
  return lines.join("\n");
}

export default function AssistantPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  // A message handed over by another screen ("Plan my week"); it belongs
  // to the persona chat
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const prompt = takeAssistantPrompt();
    getAICreditsLeft(user.id).then(setCreditsLeft);
    getProfile(user.id)
      .catch(() => null)
      .then((p) => {
        setProfile(p);
        if (prompt) setPendingPrompt(prompt);
        setMode((current) => current ?? (prompt || personaActive(p) ? "persona" : "chat"));
      });
  }, [user]);

  const active = personaActive(profile);
  const used = creditsLeft === null ? null : AI_DAILY_LIMIT - creditsLeft;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <div className="mb-3 flex rounded-2xl bg-surface p-1 shadow-card" role="tablist">
        {(
          [
            { value: "chat", label: "💬 AI Chat" },
            { value: "persona", label: "🧠 My AI Persona" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={mode === tab.value}
            onClick={() => setMode(tab.value)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
              mode === tab.value
                ? "bg-gradient-to-r from-grad-from to-grad-to text-white shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Usage: 10/day for normal chat, unlimited for Persona */}
      {mode === "chat" && (
        <div className="mb-4 rounded-2xl bg-surface p-3.5 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-ink">AI Usage</p>
            <p className="text-sm tabular-nums text-muted">
              {used === null ? "…" : `${used} / ${AI_DAILY_LIMIT} messages today`}
            </p>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={AI_DAILY_LIMIT}
            aria-valuenow={used ?? 0}
            aria-label="AI messages used today"
          >
            <div
              className={`h-full rounded-full transition-all ${
                creditsLeft === 0 ? "bg-danger" : "bg-gradient-to-r from-grad-from to-grad-to"
              }`}
              style={{ width: `${((used ?? 0) / AI_DAILY_LIMIT) * 100}%` }}
            />
          </div>
          <p className={`mt-1.5 text-xs ${creditsLeft === 0 ? "text-danger" : "text-muted"}`}>
            {creditsLeft === 0
              ? `You've reached your ${AI_DAILY_LIMIT} AI messages for today. Your tasks still work as usual.`
              : creditsLeft !== null
                ? `${creditsLeft} messages remaining today · resets every day`
                : " "}
          </p>
        </div>
      )}

      {mode === "persona" && active && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-ok-soft p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ok text-white">
            <BrainIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Persona Active ✓</p>
            <p className="text-xs text-muted">Unlimited Persona AI · doesn&apos;t use your 10 daily messages</p>
          </div>
          <Link href="/profile" className="shrink-0 text-sm font-medium text-accent hover:underline">
            View
          </Link>
        </div>
      )}

      {mode === null ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : mode === "persona" && !active ? (
        <CreatePersona />
      ) : (
        <ChatPane
          key={mode}
          mode={mode}
          profile={profile}
          outOfCredits={mode === "chat" && creditsLeft === 0}
          onRemaining={setCreditsLeft}
          onSwitchToPersona={active ? () => setMode("persona") : undefined}
          initialPrompt={mode === "persona" ? pendingPrompt : null}
          onPromptUsed={() => setPendingPrompt(null)}
        />
      )}
    </div>
  );
}

function CreatePersona() {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-surface px-6 py-10 text-center shadow-card">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-grad-from to-grad-to text-white shadow-lg shadow-accent/30">
        <BrainIcon className="h-7 w-7" />
      </span>
      <h2 className="mt-4 text-lg font-bold text-ink">Create your AI Persona</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        Tell your AI who you are (student, working, entrepreneur… or all of them), what you&apos;re working on and what you want.
        Then planning, suggestions and this chat become <strong className="text-ink">unlimited</strong>.
      </p>
      <Link
        href="/onboarding"
        className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-grad-from to-grad-to px-5 font-semibold text-white shadow-md shadow-accent/30"
      >
        <SparklesIcon className="h-4 w-4" />
        Create my persona · 3 min
      </Link>
    </div>
  );
}

function ChatPane({
  mode,
  profile,
  outOfCredits,
  onRemaining,
  onSwitchToPersona,
  initialPrompt,
  onPromptUsed,
}: {
  mode: Mode;
  profile: Profile | null;
  outOfCredits: boolean;
  onRemaining: (remaining: number) => void;
  onSwitchToPersona?: () => void;
  initialPrompt: string | null;
  onPromptUsed: () => void;
}) {
  const { user, session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingPrompt = useRef(initialPrompt);

  const greet = useCallback(() => {
    if (!user) return;
    getTasks()
      .catch(() => [] as Task[])
      .then((tasks) => {
        const fallback = user.email?.split("@")[0] ?? "there";
        setMessages([
          {
            id: "greeting",
            role: "assistant",
            content: buildGreeting(mode, profile, fallback, tasks, toLocalDateString()),
          },
        ]);
      });
  }, [user, mode, profile]);

  // Restore today's conversation, or start a new one with the day summary
  useEffect(() => {
    if (!user) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(user.id, mode)) ?? "null");
      if (saved?.date === toLocalDateString() && Array.isArray(saved.messages) && saved.messages.length) {
        setMessages(saved.messages);
        return;
      }
    } catch {
      // storage unavailable or corrupt: start fresh
    }
    greet();
  }, [user, mode, greet]);

  // Save the conversation (per user, per mode, per day)
  useEffect(() => {
    if (!user || messages.length === 0) return;
    try {
      localStorage.setItem(
        storageKey(user.id, mode),
        JSON.stringify({ date: toLocalDateString(), messages: messages.slice(-40) })
      );
    } catch {
      // private mode etc.: the chat still works, it just won't be remembered
    }
  }, [messages, mode, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const updateMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || !session || sending || outOfCredits) return;

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
          mode: mode === "persona" ? "persona" : "normal",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<AssistantResponse> & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "The assistant is unavailable right now.");

      if (data.remaining !== undefined) onRemaining(data.remaining);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply ?? "",
          proposal: data.proposal ?? undefined,
          proposalState: data.proposal ? "pending" : undefined,
          remembered: data.remembered?.length ? data.remembered : undefined,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error",
          content:
            e instanceof Error && e.message !== "Failed to fetch"
              ? e.message
              : "Couldn't reach the server. Check your connection.",
        },
      ]);
      if (user && mode === "chat") getAICreditsLeft(user.id).then((n) => n !== null && onRemaining(n));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Send a handed-over message once the conversation has loaded
  useEffect(() => {
    if (!pendingPrompt.current || messages.length === 0 || sending) return;
    const prompt = pendingPrompt.current;
    pendingPrompt.current = null;
    onPromptUsed();
    send(prompt);
  });

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
      localStorage.removeItem(storageKey(user.id, mode));
    } catch {}
    setMessages([]);
    greet();
  };

  const onlyGreeting = messages.length <= 1;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-grad-from to-grad-to text-white shadow-md shadow-accent/30">
            {mode === "persona" ? <BrainIcon className="h-5 w-5" /> : <SparklesIcon className="h-5 w-5" />}
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink">
              {mode === "persona" ? "Persona AI" : "AI Assistant"}
            </h1>
            <p className="text-xs text-muted">
              {mode === "persona" ? "Knows who you are · unlimited" : "Quick help with your tasks · 10 a day"}
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
              {m.remembered && (
                <Link
                  href="/profile"
                  className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl bg-accent-soft px-3 py-2 text-xs font-medium text-accent hover:underline"
                >
                  🧠 Persona updated: {m.remembered.join(" · ")}
                </Link>
              )}
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

        {onlyGreeting && !sending && !outOfCredits && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS[mode].map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full bg-surface px-3.5 py-2 text-left text-sm text-ink shadow-card transition hover:bg-accent-soft hover:text-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {outOfCredits && onSwitchToPersona && (
          <button
            onClick={onSwitchToPersona}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ok-soft py-3 text-sm font-semibold text-ok"
          >
            <BrainIcon className="h-4 w-4" />
            Continue in the Persona chat (unlimited)
          </button>
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
              ? `You've reached your ${AI_DAILY_LIMIT} AI messages for today.`
              : mode === "persona"
                ? "Tell your Persona AI what you need…"
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
    </>
  );
}
