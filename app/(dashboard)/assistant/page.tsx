"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { postAI, takeAssistantPrompt } from "@/lib/persona/client";
import { useAuth } from "@/lib/AuthContext";
import { useAIBudget } from "@/lib/useAIBudget";
import { getTasks } from "@/lib/queries/tasks";
import { getProfile } from "@/lib/queries/persona";
import { applyProposal, discardProposal, undoPersonaChanges } from "@/lib/assistant/apply";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import ProposalCard, { type ProposalState } from "@/components/ProposalCard";
import { BrainIcon, MicIcon, SparklesIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import { formatDate, getGreeting, toLocalDateString } from "@/utils/date";
import { isOpen, type Task } from "@/types/task";
import { hasPersona, roleOf, type Profile } from "@/types/persona";
import type { AssistantResponse, ConflictChoice, StoredMessage } from "@/lib/assistant/types";

type Message = StoredMessage & {
  local?: "error" | "note"; // shown only here, never sent to the AI
  state?: ProposalState; // "applying" while saving
  free?: boolean; // answered without AI
};

type ConversationRow = { id: string; title: string | null; updated_at: string };

const SUGGESTIONS = [
  "What should I work on today?",
  "Plan my week",
  "I have 2 hours free",
  "Gym 3 days on, 1 off at 18:00",
  "My exam is in 10 days, make a study plan",
  "Move all unfinished tasks to tomorrow",
];

// Deterministic day summary (no AI call, nothing stored)
function greeting(profile: Profile | null, fallbackName: string, tasks: Task[], today: string): string {
  const name = profile?.display_name ?? fallbackName;
  const todays = tasks
    .filter((t) => t.due_date === today)
    .sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
  const open = todays.filter(isOpen);
  const overdue = tasks.filter((t) => isOpen(t) && t.due_date && t.due_date < today && !t.series_id);

  const lines = [`${getGreeting()}, ${name} 👋`];
  if (hasPersona(profile) && profile) {
    const roles = profile.ai_profile.about.roles.map((r) => `${roleOf(r).emoji} ${roleOf(r).label}`);
    if (roles.length) lines.push("", `I know your ${roles.join(" + ")} life: your courses, work, goals and schedule.`);
  }
  if (todays.length) {
    lines.push("", "Today you have:");
    for (const t of todays) lines.push(`${isOpen(t) ? "•" : "✓"} ${t.due_time ? `${t.due_time.slice(0, 5)} – ` : ""}${t.title}`);
    lines.push("", `${open.length} of ${todays.length} still to do.`);
  } else {
    lines.push("", "Nothing is scheduled for today yet.");
  }
  if (overdue.length) lines.push(`You also have ${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}.`);
  lines.push("", "Tell me what you want to get done and I'll turn it into a plan.");
  return lines.join("\n");
}

// A message shown only on this screen (errors, "Done" notes)
function localMessage(content: string, local: "error" | "note"): Message {
  return {
    id: -Date.now() - Math.random(),
    role: "assistant",
    content,
    proposal: null,
    proposal_state: null,
    remembered: null,
    created_at: new Date().toISOString(),
    local,
  };
}

// Voice input, where the browser supports it
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};
function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function AssistantPage() {
  const { user, session } = useAuth();
  const budget = useAIBudget();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [intro, setIntro] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const pendingPrompt = useRef<string | null>(null);

  const outOfPoints = budget !== null && budget.remaining <= 0;

  const openConversation = useCallback(async (id: string | null) => {
    setShowHistory(false);
    setConversationId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, proposal, proposal_state, remembered, created_at")
      .eq("conversation_id", id)
      .order("id", { ascending: false })
      .limit(60);
    setMessages(((data ?? []) as StoredMessage[]).reverse());
  }, []);

  // The latest conversation (continued on any device), the greeting, and the
  // list of past chats
  useEffect(() => {
    if (!user) return;
    pendingPrompt.current = takeAssistantPrompt();
    Promise.all([
      getProfile(user.id).catch(() => null),
      getTasks().catch(() => [] as Task[]),
      supabase.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(20),
    ]).then(async ([p, tasks, convs]) => {
      setProfile(p);
      setIntro(greeting(p, user.email?.split("@")[0] ?? "there", tasks, toLocalDateString()));
      const list = (convs.data ?? []) as ConversationRow[];
      setConversations(list);
      // Continue today's conversation; a new day starts a new one
      const latest = list[0];
      if (latest && latest.updated_at.slice(0, 10) >= toLocalDateString(new Date(Date.now() - 86_400_000)) && !pendingPrompt.current) {
        await openConversation(latest.id);
      }
      setLoading(false);
    });
  }, [user, openConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const patch = useCallback((id: number, change: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...change } : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !session || sending) return;
      const temp: Message = { ...localMessage(content, "note"), role: "user", local: undefined };
      setMessages((prev) => [...prev, temp]);
      setInput("");
      setSending(true);
      try {
        const data = await postAI<AssistantResponse>(session, "/api/assistant", {
          message: content,
          conversationId,
        });
        if (!conversationId) {
          setConversations((prev) => [
            { id: data.conversationId, title: content.slice(0, 80), updated_at: new Date().toISOString() },
            ...prev,
          ]);
        }
        setConversationId(data.conversationId);
        setMessages((prev) => [
          ...prev.map((m) => (m.id === temp.id ? { ...m, id: data.userMessageId } : m)),
          { ...data.message, free: data.free },
        ]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          localMessage(
            e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't reach the server. Check your connection.",
            "error"
          ),
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [session, sending, conversationId]
  );

  // A message handed over by another screen ("Plan next week"...)
  useEffect(() => {
    if (loading || !pendingPrompt.current || sending) return;
    const prompt = pendingPrompt.current;
    pendingPrompt.current = null;
    send(prompt);
  }, [loading, sending, send]);

  const apply = async (message: Message, choices: Record<string, ConflictChoice>) => {
    if (!message.proposal) return;
    patch(message.id, { state: "applying" });
    try {
      const r = await applyProposal(message.proposal, choices, message.id);
      patch(message.id, { state: undefined, proposal_state: "applied" });
      const parts = [
        r.created && `added ${r.created} task${r.created > 1 ? "s" : ""}`,
        r.updated && `updated ${r.updated}`,
        r.deleted && `deleted ${r.deleted}`,
        r.skipped && `skipped ${r.skipped} because of conflicts`,
      ].filter(Boolean);
      setMessages((prev) => [
        ...prev,
        localMessage(`✅ Done: ${parts.join(", ") || "nothing to change"}. You'll find it on Today and in the Calendar.`, "note"),
      ]);
      notifyTasksChanged();
    } catch (e) {
      patch(message.id, { state: undefined });
      setMessages((prev) => [...prev, localMessage((e as Error).message, "error")]);
    }
  };

  const discard = (message: Message) => {
    patch(message.id, { proposal_state: "discarded" });
    discardProposal(message.id);
  };

  const undoLearned = async (message: Message) => {
    if (!user || !message.remembered) return;
    const ok = await undoPersonaChanges(user.id, message.remembered.undo, message.id);
    if (ok) patch(message.id, { remembered: { ...message.remembered, undone: true } });
    else setMessages((prev) => [...prev, localMessage("Couldn't undo that. Edit it on your persona page.", "error")]);
  };

  const toggleVoice = () => {
    const Speech = speechRecognition();
    if (!Speech) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    const base = input ? `${input.trimEnd()} ` : "";
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join("");
      setInput(base + text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  };

  const empty = messages.length === 0;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-grad-from to-grad-to text-white shadow-md shadow-accent/30">
            <SparklesIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-ink">AI Assistant</h1>
            <p className="truncate text-xs text-muted">
              {budget ? `${budget.remaining} of ${budget.limit} AI points left today` : "…"}
              {" · "}
              {hasPersona(profile) ? (
                <Link href="/profile" className="text-accent hover:underline">
                  knows your persona
                </Link>
              ) : (
                <Link href="/onboarding" className="text-accent hover:underline">
                  tell it about you
                </Link>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {conversations.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-ink"
            >
              History
            </button>
          )}
          {!empty && (
            <button
              onClick={() => openConversation(null)}
              className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-ink"
            >
              New chat
            </button>
          )}
        </div>
      </div>

      {showHistory && (
        <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto rounded-2xl bg-surface p-2 shadow-card">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => openConversation(c.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${
                  c.id === conversationId ? "bg-accent-soft text-accent" : "text-ink"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.title || "Conversation"}</span>
                <span className="shrink-0 text-xs text-muted">{formatDate(c.updated_at.slice(0, 10))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="flex-1 space-y-4" aria-live="polite">
          {empty && (
            <div className="flex justify-start">
              <div className="w-full max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink shadow-card">
                {intro}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={m.role === "user" ? "max-w-[85%]" : "w-full max-w-[92%]"}>
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                    m.role === "user"
                      ? "rounded-br-md bg-gradient-to-br from-grad-from to-grad-to text-white"
                      : m.local === "error"
                        ? "rounded-bl-md bg-danger-soft text-danger"
                        : "rounded-bl-md bg-surface text-ink shadow-card"
                  }`}
                >
                  {m.content}
                </div>
                {m.free && <p className="mt-1 text-xs text-muted">Answered from your data · no points used</p>}
                {m.remembered && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
                    <BrainIcon className="h-4 w-4 shrink-0" />
                    <span className={`min-w-0 flex-1 ${m.remembered.undone ? "line-through opacity-60" : ""}`}>
                      Learned: {m.remembered.changes.join(" · ")}
                    </span>
                    {m.remembered.undone ? (
                      <span className="text-muted">Undone</span>
                    ) : (
                      <button onClick={() => undoLearned(m)} className="font-semibold underline">
                        Undo
                      </button>
                    )}
                  </div>
                )}
                {m.proposal && (
                  <ProposalCard
                    proposal={m.proposal}
                    state={m.state ?? m.proposal_state ?? "pending"}
                    onApply={(choices) => apply(m, choices)}
                    onDiscard={() => discard(m)}
                    onChangeAssumption={(a) => {
                      setInput(`Instead of "${a}", `);
                      inputRef.current?.focus();
                    }}
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

          {empty && !sending && (
            <div className="flex flex-wrap gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
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

          {outOfPoints && (
            <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
              You&apos;ve used today&apos;s AI points. Questions like “what&apos;s on today?” still work, and so does
              everything else in the app. Points reset at midnight.
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      )}

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
          placeholder={listening ? "Listening…" : "Tell me what you want to do…"}
          aria-label="Message the assistant"
          className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none [field-sizing:content]"
        />
        {speechRecognition() && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? "Stop listening" : "Speak"}
            aria-pressed={listening}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
              listening ? "animate-pulse bg-danger-soft text-danger" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <MicIcon className="h-5 w-5" />
          </button>
        )}
        <button
          type="submit"
          disabled={!input.trim() || sending}
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
