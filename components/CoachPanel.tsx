"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { nowFields, postAI } from "@/lib/persona/client";
import { startPlan, undoPlan } from "@/lib/persona/schedule";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { announceCredits } from "@/components/AIPanel";
import { Spinner } from "@/components/ui";
import { ClockIcon, SparklesIcon } from "@/components/icons";
import { formatDuration } from "@/utils/date";
import type { NowResult, NowStep } from "@/lib/persona/types";
import type { Task } from "@/types/task";

const FREE_OPTIONS = [30, 60, 120, 180];

// "What should I do now?" and "I have free time". Each answer uses one of
// the daily AI questions; Start turns the plan into timed tasks from now.
export default function CoachPanel({ tasks }: { tasks: Task[] }) {
  const { user, session } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState<"now" | number | null>(null);
  const [result, setResult] = useState<NowResult | null>(null);
  const [freeMinutes, setFreeMinutes] = useState<number | null>(null);
  const [showFree, setShowFree] = useState(false);
  const [showPlan, setShowPlan] = useState(true);
  const [chosen, setChosen] = useState<NowStep | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const ask = async (minutes: number | null, exclude: string[] = []) => {
    if (!session) return;
    setLoading(minutes ?? "now");
    setError("");
    setChosen(null);
    try {
      const data = await postAI<{ result: NowResult }>(session, "/api/coach", {
        mode: "now",
        ...nowFields(),
        minutes,
        exclude,
      });
      setResult(data.result);
      setFreeMinutes(minutes);
      // With options ("I have free time"), let the user choose first
      setShowPlan(data.result.options.length === 0);
      setShowFree(false);
      if (data.usage && !data.usage.persona) announceCredits(data.usage.remaining);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const start = async (steps: NowStep[]) => {
    if (!user) return;
    setStarting(true);
    const done = await startPlan(user.id, steps, tasks);
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
    <section className="space-y-2.5">
      <button
        onClick={() => ask(null)}
        disabled={loading !== null}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-grad-from to-grad-to text-[17px] font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-70"
      >
        {loading === "now" ? <Spinner className="h-5 w-5" /> : <SparklesIcon className="h-5 w-5" />}
        {loading === "now" ? "Thinking…" : "What should I do now?"}
      </button>

      <div className="rounded-2xl bg-surface p-1.5 shadow-card">
        <button
          onClick={() => setShowFree((v) => !v)}
          aria-expanded={showFree}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-ink transition hover:bg-surface-2"
        >
          <ClockIcon className="h-4 w-4 text-accent" />
          I have free time
          <span className="ml-auto text-muted">{showFree ? "−" : "+"}</span>
        </button>
        {showFree && (
          <div className="grid grid-cols-4 gap-1.5 px-1 pb-1 pt-1">
            {FREE_OPTIONS.map((m) => (
              <button
                key={m}
                onClick={() => ask(m)}
                disabled={loading !== null}
                className="flex h-10 items-center justify-center rounded-xl bg-accent-soft text-sm font-semibold text-accent transition hover:brightness-95 disabled:opacity-60"
              >
                {loading === m ? <Spinner className="h-4 w-4" /> : formatDuration(m)}
              </button>
            ))}
          </div>
        )}
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
                      {option.title}{" "}
                      <span className="font-normal text-muted">· {formatDuration(option.minutes)}</span>
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
                      {!step.isBreak && step.reason && (
                        <span className="block text-sm text-muted">{step.reason}</span>
                      )}
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
                      setShowFree(true);
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
    </section>
  );
}
