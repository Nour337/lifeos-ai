"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { callAI } from "@/lib/ai/client";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";
import { getAICreditsLeft } from "@/lib/queries/profiles";
import { toLocalDateString } from "@/utils/date";
import { Button, Spinner } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";
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
    <section className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft to-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
          <SparklesIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink">AI assistant</h2>
          <p className="text-xs text-muted">Plans your day from your open tasks</p>
        </div>
        {creditsLeft !== null && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              outOfCredits ? "bg-danger-soft text-danger" : "bg-surface text-muted"
            }`}
            title="AI questions left today"
          >
            {creditsLeft}/{AI_DAILY_LIMIT} left
          </span>
        )}
      </div>

      {!hasOpenTasks ? (
        <p className="mt-4 text-sm text-muted">
          Add some tasks and the assistant can plan your day.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-muted">
              Time I have today
            </p>
            <div className="flex gap-1 rounded-lg bg-surface/70 p-1">
              {timeOptions.map((option) => (
                <button
                  key={option.label}
                  onClick={() => setMinutes(option.minutes)}
                  className={`flex-1 rounded-md py-1 text-sm font-medium transition ${
                    minutes === option.minutes
                      ? "bg-surface text-ink shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              onClick={() => ask("plan")}
              disabled={loadingMode !== null || outOfCredits}
            >
              {loadingMode === "plan" && <Spinner />}
              Plan my day
            </Button>
            <Button
              variant="secondary"
              onClick={() => ask("next")}
              disabled={loadingMode !== null || outOfCredits}
            >
              {loadingMode === "next" && <Spinner />}
              What now?
            </Button>
          </div>
          {outOfCredits && (
            <p className="mt-2 text-center text-xs text-muted">
              You&apos;ve used today&apos;s {AI_DAILY_LIMIT} AI questions. More tomorrow!
            </p>
          )}
        </>
      )}

      {loadingMode && (
        <div className="mt-4 space-y-2">
          <div className="h-3 w-5/6 animate-pulse rounded bg-accent/15" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-accent/15" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-accent/15" />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-xl bg-surface px-4 py-2 shadow-sm">
          {result.kind === "message" && <p className="py-2 text-ink">{result.text}</p>}

          {result.kind === "next" && (
            <>
              <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-accent">
                Do this now
              </p>
              <ul>{renderItem(result.item)}</ul>
            </>
          )}

          {result.kind === "plan" && (
            <>
              <ul className="divide-y divide-line">
                {result.items.map((item, i) => renderItem(item, i))}
              </ul>
              {result.later.length > 0 && (
                <p className="border-t border-line py-2 text-sm text-muted">
                  <span className="font-medium">Can wait:</span>{" "}
                  {result.later.map((item) => item.title).join(", ")}
                </p>
              )}
              {result.note && (
                <p className="border-t border-line py-2 text-sm text-ink">
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
