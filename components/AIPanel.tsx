"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { toLocalDateString } from "@/utils/date";

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

  const buttonClass =
    "rounded-md px-4 py-2 text-sm transition disabled:opacity-50";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        AI assistant
      </h2>

      {!hasTasks ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          Add some tasks and the assistant can plan your day.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => ask("plan")}
            disabled={loadingMode !== null}
            className={`${buttonClass} bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200`}
          >
            {loadingMode === "plan" ? "Planning..." : "Plan my day"}
          </button>
          <button
            onClick={() => ask("next")}
            disabled={loadingMode !== null}
            className={`${buttonClass} border border-zinc-300 text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-800`}
          >
            {loadingMode === "next" ? "Thinking..." : "What should I do now?"}
          </button>
        </div>
      )}

      {loadingMode && (
        <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-black dark:border-zinc-600 dark:border-t-white" />
          Asking the assistant...
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {result && (
        <p className="mt-4 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm leading-6 text-black dark:bg-zinc-800 dark:text-zinc-100">
          {result}
        </p>
      )}
    </section>
  );
}
