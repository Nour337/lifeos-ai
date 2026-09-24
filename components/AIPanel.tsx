"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { toLocalDateString } from "@/utils/date";
import { Button, Spinner } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";

type Mode = "plan" | "next";

export default function AIPanel({ hasTasks }: { hasTasks: boolean }) {
  const { session } = useAuth();
  const [loadingMode, setLoadingMode] = useState<Mode | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const ask = async (mode: Mode) => {
    if (!session) return;
    setLoadingMode(mode);
    setError("");
    setResult("");

    try {
      const now = new Date();
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          mode,
          today: toLocalDateString(now),
          localTime: now.toTimeString().slice(0, 5),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "The assistant is unavailable right now.");
      } else {
        setResult(data.result);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <section className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft to-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
          <SparklesIcon className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="font-semibold text-ink">AI assistant</h2>
          <p className="text-xs text-muted">Plans your day from your open tasks</p>
        </div>
      </div>

      {!hasTasks ? (
        <p className="mt-4 text-sm text-muted">
          Add some tasks and the assistant can plan your day.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => ask("plan")} disabled={loadingMode !== null}>
            {loadingMode === "plan" && <Spinner />}
            Plan my day
          </Button>
          <Button
            variant="secondary"
            onClick={() => ask("next")}
            disabled={loadingMode !== null}
          >
            {loadingMode === "next" && <Spinner />}
            What now?
          </Button>
        </div>
      )}

      {loadingMode && !result && (
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
        <div className="mt-4 whitespace-pre-wrap rounded-xl bg-surface p-4 text-[15px] leading-7 text-ink shadow-sm">
          {result}
        </div>
      )}
    </section>
  );
}
