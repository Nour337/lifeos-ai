"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { postAI } from "@/lib/persona/client";
import { addSuggestion, nextFreeSlot, startPlan, undoPlan } from "@/lib/persona/schedule";
import { recordIgnored } from "@/lib/queries/persona";
import { deleteTask, moveTask, setTaskStatus } from "@/lib/queries/tasks";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { Skeleton, Spinner } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";
import { formatDate, formatDuration } from "@/utils/date";
import type { NowResult, NowStep, Suggestion, SuggestionSet } from "@/lib/persona/types";
import type { AIProfile } from "@/types/persona";
import type { Task } from "@/types/task";

const FREE_OPTIONS = [30, 60, 120, 180];

// The one place on Today for "what should I work on?": the best next thing
// right now, a plan for free time, and more ideas from the user's goals.
// Each answer uses one AI point; Start turns a plan into timed tasks.
export default function FocusCard({ tasks, profile }: { tasks: Task[]; profile: AIProfile | null }) {
  const { user, session } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState<"now" | number | null>(null);
  const [result, setResult] = useState<NowResult | null>(null);
  const [freeMinutes, setFreeMinutes] = useState<number | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [chosen, setChosen] = useState<NowStep | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);

  const ask = async (minutes: number | null, exclude: string[] = []) => {
    if (!session) return;
    setLoading(minutes ?? "now");
    setError("");
    setChosen(null);
    try {
      const data = await postAI<{ result: NowResult }>(session, "/api/coach", { mode: "now", minutes, exclude });
      setResult(data.result);
      setFreeMinutes(minutes);
      // With options ("I have free time"), let the user choose first
      setShowPlan(data.result.options.length === 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const start = async (steps: NowStep[]) => {
    if (!user) return;
    setStarting(true);
    const done = await startPlan(user.id, steps, tasks, profile);
    setStarting(false);
    if (!done) {
      toast("Couldn't schedule the plan. Try again.", { tone: "error" });
      return;
    }
    setResult(null);
    notifyTasksChanged();
    const first = steps.find((s) => !s.isBreak);
    toast(`Started: ${first?.title ?? "your plan"} 💪`, {
      action: {
        label: "Undo",
        onClick: async () => {
          if (!(await undoPlan(done))) toast("Couldn't undo.", { tone: "error" });
          notifyTasksChanged();
        },
      },
    });
  };

  const current = result ? (chosen ? [chosen] : result.plan) : [];
  const excludeNow = () => [
    ...(result?.plan ?? []).filter((s) => !s.isBreak).map((s) => s.title),
    ...(result?.options ?? []).map((s) => s.title),
  ];

  return (
    <section className="space-y-2.5" aria-label="Focus">
      <button
        onClick={() => ask(null)}
        disabled={loading !== null}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-grad-from to-grad-to text-[17px] font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-70"
      >
        {loading === "now" ? <Spinner className="h-5 w-5" /> : <SparklesIcon className="h-5 w-5" />}
        {loading === "now" ? "Thinking…" : "What's the best thing to do now?"}
      </button>

      <div className="flex items-center gap-1.5 rounded-2xl bg-surface p-1.5 shadow-card">
        <span className="shrink-0 px-2 text-sm font-medium text-muted">I have</span>
        {FREE_OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => ask(m)}
            disabled={loading !== null}
            className="flex h-9 flex-1 items-center justify-center rounded-xl bg-accent-soft text-sm font-semibold text-accent transition hover:brightness-95 disabled:opacity-60"
          >
            {loading === m ? <Spinner className="h-4 w-4" /> : formatDuration(m)}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {result && (
        <div className="animate-sheet-in rounded-2xl bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
              <SparklesIcon className="h-3.5 w-3.5" />
              {freeMinutes ? `${formatDuration(freeMinutes)} free` : "Right now"}
            </p>
            <button onClick={() => setResult(null)} className="text-xs text-muted hover:text-ink">
              Hide
            </button>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed text-ink">{result.message}</p>

          {/* Free time: pick one option, or let the AI decide */}
          {!showPlan && result.options.length > 0 && (
            <div className="mt-3 space-y-2">
              {result.options.map((option, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setChosen(option);
                    setShowPlan(true);
                  }}
                  className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left transition hover:border-accent/40 hover:bg-accent-soft/40"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {option.title} <span className="font-normal text-muted">· {formatDuration(option.minutes)}</span>
                    </span>
                    {option.reason && <span className="block text-sm text-muted">{option.reason}</span>}
                  </span>
                </button>
              ))}
              {result.plan.length > 0 && (
                <button
                  onClick={() => setShowPlan(true)}
                  className="w-full rounded-xl bg-accent-soft py-2.5 text-sm font-semibold text-accent transition hover:brightness-95"
                >
                  ✨ You decide
                </button>
              )}
            </div>
          )}

          {showPlan && current.length > 0 && (
            <>
              <ol className="mt-3 space-y-1.5">
                {current.map((step, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${
                      step.isBreak ? "bg-surface-2/60" : "bg-accent-soft/50"
                    }`}
                  >
                    <span className="mt-0.5 text-base" aria-hidden="true">
                      {step.isBreak ? "☕" : `${i + 1}.`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block ${step.isBreak ? "text-muted" : "font-medium text-ink"}`}>
                        {step.title} <span className="font-normal text-muted">— {formatDuration(step.minutes)}</span>
                      </span>
                      {!step.isBreak && step.reason && <span className="block text-sm text-muted">{step.reason}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={() => start(current)}
                  disabled={starting}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-grad-from to-grad-to text-sm font-semibold text-white shadow-sm shadow-accent/25 disabled:opacity-60"
                >
                  {starting && <Spinner className="h-3.5 w-3.5" />}
                  Start
                </button>
                <button
                  onClick={() => {
                    if (chosen || result.options.length) {
                      setChosen(null);
                      setShowPlan(false);
                    } else {
                      setResult(null);
                    }
                  }}
                  className="h-10 rounded-xl border border-line text-sm font-medium text-ink hover:bg-surface-2"
                >
                  Change
                </button>
                <button
                  onClick={() => ask(freeMinutes, excludeNow())}
                  disabled={loading !== null}
                  className="h-10 rounded-xl border border-line text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
                >
                  {loading !== null ? <Spinner className="h-3.5 w-3.5" /> : "Something else"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-surface shadow-card">
        <button
          onClick={() => setShowIdeas((v) => !v)}
          aria-expanded={showIdeas}
          className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-ink"
        >
          💡 More ideas from your goals
          <span className="ml-auto text-muted">{showIdeas ? "−" : "+"}</span>
        </button>
        {showIdeas && <Suggestions tasks={tasks} profile={profile} />}
      </div>
    </section>
  );
}

// Today's suggestions, made once a day on the server (loaded only when the
// user opens them). With a big overdue backlog they're catch-up picks.
function Suggestions({ tasks, profile }: { tasks: Task[]; profile: AIProfile | null }) {
  const { user, session } = useAuth();
  const toast = useToast();
  const [set, setSet] = useState<SuggestionSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (!session) return;
      setLoading(true);
      setError("");
      try {
        const data = await postAI<{ suggestions: SuggestionSet }>(session, "/api/coach", { mode: "suggest", refresh });
        setSet(data.suggestions);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  // Opening the section loads today's ideas (cached on the server)
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current || !session) return;
    requested.current = true;
    load();
  }, [session, load]);

  const handle = async (id: string) => {
    if (!set) return;
    const handled = [...set.handled, id];
    setSet({ ...set, handled });
    await supabase.from("daily_suggestions").update({ handled }).eq("day", set.day);
  };

  const add = async (s: Suggestion, schedule: boolean) => {
    if (!user) return;
    setBusy(s.id);
    const when = schedule ? nextFreeSlot(tasks, s.minutes, profile) : { date: set?.day ?? "", time: null };
    if (!when) {
      setBusy(null);
      toast("Your next 7 days are full. Add it without a time instead.", { tone: "error" });
      return;
    }

    // Catch-up: reschedule the user's own overdue task
    if (s.kind === "recover" && s.taskId) {
      const task = tasks.find((t) => t.id === s.taskId);
      const ok = task ? await moveTask(task, when.date, when.time) : null;
      setBusy(null);
      if (!ok) return toast("Couldn't move the task. Try again.", { tone: "error" });
      handle(s.id);
      notifyTasksChanged();
      return toast(`Moved “${s.title}” to ${when.time ? `${formatDate(when.date)} at ${when.time}` : "today"}`);
    }

    const task = await addSuggestion(user.id, s, when);
    setBusy(null);
    if (!task) return toast("Couldn't add the task. Try again.", { tone: "error" });
    handle(s.id);
    notifyTasksChanged();
    const where = when.time ? `${when.date === set?.day ? "today" : formatDate(when.date)} at ${when.time}` : "today";
    toast(`Added “${s.title}” ${where}`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await deleteTask(task.id);
          if (set) setSet({ ...set, handled: set.handled.filter((h) => h !== s.id) });
          notifyTasksChanged();
        },
      },
    });
  };

  const ignore = async (s: Suggestion) => {
    handle(s.id);
    if (s.kind === "recover" && s.taskId) {
      await setTaskStatus(s.taskId, "skipped");
      notifyTasksChanged();
      toast(`Let go of “${s.title}”.`);
      return;
    }
    if (user && s.areaId) recordIgnored(user.id, s.areaId);
    toast("Got it. I'll suggest that less often.");
  };

  const visible = set?.items.filter((s) => !set.handled.includes(s.id)) ?? [];

  return (
    <div className="px-4 pb-4">
      {set?.recovery && (
        <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          You have a few overdue tasks, so let&apos;s catch up before adding anything new.
        </p>
      )}
      {loading && !set ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : error && !visible.length ? (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      ) : visible.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted">
          {set?.items.length ? "All done with today's ideas 🎉" : "No ideas yet."}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((s) => (
            <li key={s.id} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none" aria-hidden="true">
                  {s.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    {s.title} <span className="font-normal text-muted">— {formatDuration(s.minutes)}</span>
                  </p>
                  {s.reason && <p className="mt-0.5 text-sm text-muted">{s.reason}</p>}
                </div>
              </div>

              {openWhy === s.id && s.why && (
                <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
                  <span className="font-semibold">Why? </span>
                  {s.why}
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {s.kind === "new" && (
                  <button
                    onClick={() => add(s, false)}
                    disabled={busy === s.id}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Add today
                  </button>
                )}
                <button
                  onClick={() => add(s, true)}
                  disabled={busy === s.id}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${
                    s.kind === "recover" ? "bg-accent text-white" : "bg-accent-soft text-accent"
                  }`}
                >
                  {s.kind === "recover" ? "Find a time" : "Schedule"}
                </button>
                <button
                  onClick={() => ignore(s)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
                >
                  {s.kind === "recover" ? "Let it go" : "Not for me"}
                </button>
                {s.why && (
                  <button
                    onClick={() => setOpenWhy(openWhy === s.id ? null : s.id)}
                    aria-expanded={openWhy === s.id}
                    className="ml-auto rounded-lg px-2 py-1.5 text-sm font-medium text-muted hover:text-accent"
                  >
                    Why?
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => load(true)}
        disabled={loading}
        className="mt-3 flex items-center gap-1.5 text-sm font-medium text-accent hover:underline disabled:opacity-50"
      >
        {loading && <Spinner className="h-3.5 w-3.5" />}
        {loading ? "Thinking…" : "New ideas · 1 point"}
      </button>
    </div>
  );
}
