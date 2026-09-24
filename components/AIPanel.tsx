"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { callAI } from "@/lib/ai/client";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";
import { getAICreditsLeft } from "@/lib/queries/profiles";
import { toLocalDateString } from "@/utils/date";
import { Spinner } from "@/components/ui";
import { CalendarIcon, SparklesIcon } from "@/components/icons";
import { TaskCheckbox } from "@/components/TaskList";
import type { AIResult, PlanItem } from "@/lib/ai/planDay";
import type { Task } from "@/types/task";

type Mode = "plan" | "next";

const timeOptions = [
  { minutes: null, label: "Any" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
  { minutes: 240, label: "4h" },
  { minutes: 480, label: "8h" },
];

export default function AIPanel({
  tasks,
  onToggle,
}: {
  tasks: Task[];
  onToggle: (task: Task) => void;
}) {
  const { user, session } = useAuth();
  const [loadingMode, setLoadingMode] = useState<Mode | null>(null);
  const [result, setResult] = useState<AIResult | null>(null);
  const [error, setError] = useState("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (user) getAICreditsLeft(user.id).then(setCreditsLeft);
  }, [user]);

  const hasOpenTasks = tasks.some((t) => t.status !== "done");
  const outOfCredits = creditsLeft === 0;

  const ask = async (mode: Mode) => {
    if (!session) return;
    setLoadingMode(mode);
    setError("");
    setResult(null);

    try {
      const now = new Date();
      const data = await callAI(session, {
        mode,
        today: toLocalDateString(now),
        localTime: now.toTimeString().slice(0, 5),
        availableMinutes: minutes,
      });
      setResult(data.result);
      if (data.remaining !== undefined) setCreditsLeft(data.remaining);
    } catch (e) {
      setError((e as Error).message);
      // The limit may have been hit; refresh the counter
      if (user) getAICreditsLeft(user.id).then(setCreditsLeft);
    } finally {
      setLoadingMode(null);
    }
  };

  // Show the live task (so ticking updates it), falling back to the AI's copy
  const renderItem = (item: PlanItem, index?: number) => {
    const task = tasks.find((t) => t.id === item.taskId);
    const done = task?.status === "done";
    return (
      <li key={item.taskId} className="flex items-start gap-3 py-2">
        {task ? (
          <TaskCheckbox done={done} title={task.title} onToggle={() => onToggle(task)} />
        ) : (
          <span className="mt-0.5 h-[22px] w-[22px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`leading-snug ${done ? "text-muted line-through" : "text-ink"}`}>
            {index !== undefined && (
              <span className="mr-1.5 font-semibold text-accent">{index + 1}.</span>
            )}
            {item.title}
          </p>
          {item.reason && <p className="mt-0.5 text-sm text-muted">{item.reason}</p>}
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-3">
      <button
        onClick={() => ask("plan")}
        disabled={!hasOpenTasks || loadingMode !== null || outOfCredits}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-grad-from to-grad-to text-[17px] font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
      >
        {loadingMode === "plan" ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <CalendarIcon className="h-5 w-5" />
        )}
        {loadingMode === "plan" ? "Planning your day..." : "Plan My Day"}
      </button>

      {hasOpenTasks ? (
        <div className="flex items-center gap-2">
          <div
            className="flex flex-1 gap-0.5 rounded-xl bg-surface p-1 shadow-card"
            role="group"
            aria-label="Time I have today"
          >
            {timeOptions.map((option) => (
              <button
                key={option.label}
                onClick={() => setMinutes(option.minutes)}
                aria-pressed={minutes === option.minutes}
                className={`flex-1 rounded-lg py-1 text-xs font-medium transition ${
                  minutes === option.minutes
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.minutes === null ? "Any time" : option.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => ask("next")}
            disabled={loadingMode !== null || outOfCredits}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-surface px-3 text-xs font-semibold text-accent shadow-card transition hover:bg-accent-soft disabled:opacity-60"
          >
            {loadingMode === "next" ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <SparklesIcon className="h-3.5 w-3.5" />
            )}
            What now?
          </button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted">
          Add some tasks and the AI can plan your day.
        </p>
      )}

      {creditsLeft !== null && (
        <p className={`text-center text-xs ${outOfCredits ? "text-danger" : "text-muted"}`}>
          {outOfCredits
            ? `You've used today's ${AI_DAILY_LIMIT} AI questions. More tomorrow!`
            : `${creditsLeft} of ${AI_DAILY_LIMIT} AI questions left today`}
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
              <SparklesIcon className="h-3.5 w-3.5" />
              {result.kind === "next" ? "Do this now" : "Your plan"}
            </p>
            <button
              onClick={() => setResult(null)}
              className="text-xs text-muted hover:text-ink"
            >
              Hide
            </button>
          </div>

          {result.kind === "message" && <p className="py-2 text-ink">{result.text}</p>}

          {result.kind === "next" && <ul>{renderItem(result.item)}</ul>}

          {result.kind === "plan" && (
            <>
              <ul className="divide-y divide-line">
                {result.items.map((item, i) => renderItem(item, i))}
              </ul>
              {result.later.length > 0 && (
                <p className="border-t border-line pt-2 text-sm text-muted">
                  <span className="font-medium">Can wait:</span>{" "}
                  {result.later.map((item) => item.title).join(", ")}
                </p>
              )}
              {result.note && (
                <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
                  {result.note}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
