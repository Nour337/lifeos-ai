"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { getProfile, saveProfile } from "@/lib/queries/persona";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { sectionStatus } from "@/lib/persona/sections";
import { nowFields, postAI, queueAssistantPrompt } from "@/lib/persona/client";
import type { OnboardingResponse, OnboardingWidget } from "@/lib/persona/onboarding";
import { SparklesIcon } from "@/components/icons";
import { AI_STYLES, INTEREST_OPTIONS, SECTIONS, type AIStyle, type SectionKey } from "@/types/persona";
import type { ChatMessage } from "@/lib/assistant/types";

type Message = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  quickReplies?: string[];
  multiSelect?: boolean;
  widget?: OnboardingWidget;
};

type Mode = "onboarding" | "update";

const storageKey = (userId: string, mode: Mode) => `lifeos-onboarding-${userId}-${mode}`;
const PLAN_WEEK_PROMPT =
  "Create a balanced plan for this week based on my profile: my courses and exams, projects, goals and routines. Keep my free time.";

const emptySections = () =>
  Object.fromEntries(SECTIONS.map((s) => [s.key, false])) as Record<SectionKey, boolean>;

function intro(mode: Mode, name: string | null): Message {
  if (mode === "update") {
    return {
      id: "intro",
      role: "assistant",
      content: `Hi${name ? ` ${name}` : ""} 👋 What's new? Tell me about a new course or exam, a project, a goal, a change in your schedule, or anything else I should know.`,
      quickReplies: ["New course or exam", "New project", "New goal", "My schedule changed", "Change how you talk to me"],
    };
  }
  return {
    id: "intro",
    role: "assistant",
    content: [
      `Hey${name ? ` ${name}` : ""} 👋`,
      "",
      "I'm your new AI planner. I'll help you organize your life and turn your goals into actionable tasks.",
      "",
      "Before we start, I need to understand you a little. It takes about 3 minutes, and you can skip anything.",
      "",
      name ? "What are you currently doing?" : "First, what should I call you?",
    ].join("\n"),
    quickReplies: name
      ? ["I'm a student", "I work full-time", "I run a business", "I'm a freelancer", "Something else"]
      : [],
  };
}

export default function OnboardingPage() {
  const { user, session } = useAuth();
  const router = useRouter();
  // The layout only renders this page in the browser (after the login check),
  // so reading the URL here is safe.
  const [mode] = useState<Mode>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "update"
      ? "update"
      : "onboarding"
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(emptySections);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load the saved conversation, or start one
  useEffect(() => {
    if (!user) return;
    const m = mode;

    Promise.all([getProfile(user.id), getProjects().catch(() => []), getGoals().catch(() => [])])
      .then(([profile, projects, goals]) => {
        setSections(sectionStatus(profile.ai_profile, projects, goals));
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey(user.id, m)) ?? "null");
          if (Array.isArray(saved?.messages) && saved.messages.length > 1) {
            setMessages(saved.messages);
            setFinished(saved.finished === true);
            return;
          }
        } catch {
          // storage unavailable or corrupt: start fresh
        }
        setMessages([intro(m, profile.display_name)]);
      })
      .catch(() => setMessages([intro(m, null)]));
  }, [user, mode]);

  useEffect(() => {
    if (!user || messages.length === 0) return;
    try {
      localStorage.setItem(
        storageKey(user.id, mode),
        JSON.stringify({ messages: messages.slice(-60), finished })
      );
    } catch {
      // private mode: the conversation still works, it just won't be remembered
    }
  }, [messages, finished, mode, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const send = useCallback(
    async (text: string, base?: Message[]) => {
      const content = text.trim();
      if (!content || !session || sending) return;
      const history = base ?? messages;
      const next = [
        ...history.filter((m) => m.role !== "error"),
        { id: crypto.randomUUID(), role: "user" as const, content },
      ];
      setMessages(next);
      setInput("");
      setSending(true);

      try {
        const data = await postAI<OnboardingResponse>(session, "/api/onboarding", {
          messages: next
            .filter((m): m is Message & { role: "user" | "assistant" } => m.role !== "error")
            .map((m): ChatMessage => ({ role: m.role, content: m.content })),
          today: nowFields().today,
          mode,
        });
        setSections(data.sections);
        if (data.finished) setFinished(true);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.reply,
            quickReplies: data.quickReplies,
            multiSelect: data.multiSelect,
            widget: data.widget,
          },
        ]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "error", content: (e as Error).message },
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [messages, mode, sending, session]
  );

  const retry = () => {
    const withoutError = messages.filter((m) => m.role !== "error");
    const lastUser = [...withoutError].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    send(lastUser.content, withoutError.slice(0, withoutError.lastIndexOf(lastUser)));
  };

  const leave = async (to: "/dashboard" | "/assistant" | "/profile") => {
    if (!user) return;
    setLeaving(true);
    if (mode === "onboarding") {
      const anything = Object.values(sections).some(Boolean);
      await saveProfile(user.id, { onboarding_status: anything || finished ? "done" : "skipped" });
    }
    try {
      localStorage.removeItem(storageKey(user.id, mode));
    } catch {}
    if (to === "/assistant") queueAssistantPrompt(PLAN_WEEK_PROMPT);
    router.replace(to);
  };

  const doneCount = Object.values(sections).filter(Boolean).length;
  const last = messages[messages.length - 1];
  const showControls = last?.role === "assistant" && !sending;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col px-4">
      <header className="sticky top-0 z-10 -mx-4 bg-bg/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <span className="bg-gradient-to-r from-grad-from to-grad-to bg-clip-text text-xl font-bold tracking-tight text-transparent">
            LifeOS
          </span>
          <button
            onClick={() => leave(mode === "update" ? "/profile" : "/dashboard")}
            disabled={leaving}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface hover:text-ink"
          >
            {mode === "update" ? "Done" : finished ? "Go to dashboard" : "Finish later"}
          </button>
        </div>

        {mode === "onboarding" && (
          <div className="mt-3">
            <div className="flex gap-1.5" aria-hidden="true">
              {SECTIONS.map((s) => (
                <span
                  key={s.key}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
                    sections[s.key] ? "bg-gradient-to-r from-grad-from to-grad-to" : "bg-line"
                  }`}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {finished
                ? "All set 🎉"
                : `Getting to know you · ${doneCount} of ${SECTIONS.length}: ${SECTIONS.filter((s) => sections[s.key])
                    .map((s) => s.emoji)
                    .join(" ")}`}
            </p>
          </div>
        )}
      </header>

      <div className="flex-1 space-y-4 pb-4 pt-2" aria-live="polite">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} onRetry={retry} />
        ))}

        {sending && <Typing />}

        {showControls && last.widget === "finish" && (
          <div className="grid gap-2 pl-10 sm:grid-cols-2">
            <button
              onClick={() => leave("/assistant")}
              disabled={leaving}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-grad-from to-grad-to font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 active:scale-[0.99]"
            >
              <SparklesIcon className="h-5 w-5" />
              Yes, plan my week
            </button>
            <button
              onClick={() => leave("/dashboard")}
              disabled={leaving}
              className="h-12 rounded-2xl bg-surface font-semibold text-ink shadow-card transition hover:bg-surface-2"
            >
              Go to my dashboard
            </button>
          </div>
        )}

        {showControls && last.widget === "interests" && (
          <InterestPicker onSubmit={(text) => send(text)} />
        )}

        {showControls && last.widget === "style" && <StylePicker onSubmit={(text) => send(text)} />}

        {showControls &&
          last.widget !== "interests" &&
          last.widget !== "style" &&
          last.widget !== "finish" &&
          !!last.quickReplies?.length && (
            <QuickReplies
              key={last.id}
              options={last.quickReplies}
              multi={!!last.multiSelect}
              onSubmit={(text) => send(text)}
            />
          )}

        <div ref={bottomRef} />
      </div>

      {!(finished && last?.widget === "finish") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="sticky bottom-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-end gap-2 rounded-3xl bg-surface p-2 shadow-[0_8px_30px_rgba(26,27,46,0.12)]"
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
            placeholder="Type your answer…"
            aria-label="Your answer"
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none [field-sizing:content]"
          />
          {!input.trim() && messages.length > 1 && (
            <button
              type="button"
              onClick={() => send("Skip for now")}
              disabled={sending}
              className="h-11 shrink-0 rounded-full px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
            >
              Skip
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
      )}
    </div>
  );
}

function Bubble({ message, onRetry }: { message: Message; onRetry: () => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-grad-from to-grad-to px-4 py-3 text-[15px] leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === "error") {
    return (
      <div className="flex items-center gap-3 pl-10">
        <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{message.content}</p>
        <button onClick={onRetry} className="shrink-0 text-sm font-semibold text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-grad-from to-grad-to text-white shadow-md shadow-accent/30">
        <SparklesIcon className="h-4 w-4" />
      </span>
      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink shadow-card">
        {message.content}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-end gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-grad-from to-grad-to text-white">
        <SparklesIcon className="h-4 w-4" />
      </span>
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
  );
}

const chip = (selected: boolean) =>
  `rounded-full px-3.5 py-2 text-sm font-medium transition active:scale-95 ${
    selected
      ? "bg-accent text-white shadow-sm"
      : "bg-surface text-ink shadow-card hover:bg-accent-soft hover:text-accent"
  }`;

function QuickReplies({
  options,
  multi,
  onSubmit,
}: {
  options: string[];
  multi: boolean;
  onSubmit: (text: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const isSkip = (o: string) => /skip/i.test(o);

  return (
    <div className="space-y-2 pl-10">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => {
              if (!multi || isSkip(o)) return onSubmit(o);
              setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
            }}
            aria-pressed={multi ? picked.includes(o) : undefined}
            className={chip(picked.includes(o))}
          >
            {o}
          </button>
        ))}
      </div>
      {multi && picked.length > 0 && (
        <button
          onClick={() => onSubmit(picked.join(", "))}
          className="rounded-xl bg-gradient-to-r from-grad-from to-grad-to px-4 py-2 text-sm font-semibold text-white shadow-md shadow-accent/30"
        >
          Continue with {picked.length}
        </button>
      )}
    </div>
  );
}

function InterestPicker({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const toggle = (o: string) =>
    setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const all = [...picked, ...custom.split(",").map((s) => s.trim()).filter(Boolean)];

  return (
    <div className="ml-10 space-y-3 rounded-2xl bg-surface p-4 shadow-card">
      <p className="text-sm font-semibold text-ink">Pick everything that interests you</p>
      <div className="flex flex-wrap gap-2">
        {INTEREST_OPTIONS.map((o) => (
          <button
            key={o}
            onClick={() => toggle(o)}
            aria-pressed={picked.includes(o)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition active:scale-95 ${
              picked.includes(o)
                ? "border-accent bg-accent text-white"
                : "border-line text-ink hover:border-accent/40 hover:text-accent"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder="Other (e.g. n8n, public speaking)"
        aria-label="Other interests"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={() => onSubmit("Skip for now")} className="rounded-xl px-3 py-2 text-sm text-muted hover:text-ink">
          Skip
        </button>
        <button
          onClick={() => onSubmit(`I'm interested in: ${all.join(", ")}`)}
          disabled={all.length === 0}
          className="rounded-xl bg-gradient-to-r from-grad-from to-grad-to px-4 py-2 text-sm font-semibold text-white shadow-md shadow-accent/30 disabled:opacity-40"
        >
          Continue{all.length ? ` with ${all.length}` : ""}
        </button>
      </div>
    </div>
  );
}

function StylePicker({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [style, setStyle] = useState<AIStyle | null>(null);
  const [extra, setExtra] = useState("");
  const chosen = AI_STYLES.find((s) => s.value === style);

  return (
    <div className="ml-10 space-y-3 rounded-2xl bg-surface p-4 shadow-card">
      <p className="text-sm font-semibold text-ink">How should your AI behave?</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AI_STYLES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStyle(s.value)}
            aria-pressed={style === s.value}
            className={`rounded-xl border p-3 text-left transition active:scale-[0.98] ${
              style === s.value
                ? "border-accent bg-accent-soft ring-2 ring-accent/30"
                : "border-line hover:border-accent/40"
            }`}
          >
            <span className="text-xl">{s.emoji}</span>
            <span className="mt-1 block font-semibold text-ink">{s.label}</span>
            <span className="block text-xs leading-snug text-muted">{s.text}</span>
          </button>
        ))}
      </div>
      <textarea
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Anything else your AI should know about how you like to work? (optional)"
        aria-label="Custom instructions"
        className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
      <div className="flex justify-end">
        <button
          onClick={() =>
            onSubmit(
              `I want you to be ${chosen!.label} (${chosen!.text.toLowerCase()})${
                extra.trim() ? `. Also: ${extra.trim()}` : ""
              }`
            )
          }
          disabled={!chosen}
          className="rounded-xl bg-gradient-to-r from-grad-from to-grad-to px-4 py-2 text-sm font-semibold text-white shadow-md shadow-accent/30 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
