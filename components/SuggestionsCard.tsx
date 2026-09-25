"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { nowFields, postAI } from "@/lib/persona/client";
import { addSuggestion, nextFreeSlot } from "@/lib/persona/schedule";
import { recordIgnored } from "@/lib/queries/persona";
import { deleteTask } from "@/lib/queries/tasks";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { Skeleton, Spinner } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";
import { formatDate, formatDuration } from "@/utils/date";
import type { Suggestion } from "@/lib/persona/types";
import type { AIProfile } from "@/types/persona";
import type { Task } from "@/types/task";

type Cache = { date: string; items: Suggestion[]; handled: string[] };

const storageKey = (userId: string) => `lifeos-suggestions-${userId}`;

function readCache(userId: string, today: string): Cache | null {
  try {
    const cache = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "null") as Cache | null;
    return cache?.date === today && Array.isArray(cache.items) ? cache : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, cache: Cache) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(cache));
  } catch {
    // no storage: suggestions just won't survive a reload
  }
}

// Proactive task ideas from the user's persona. Generated once a day
// automatically (own small budget, not the 10 daily questions), kept for
// the day, and refreshable.
export default function SuggestionsCard({
  tasks,
  profile,
  today,
}: {
  tasks: Task[];
  profile: AIProfile | null;
  today: string;
}) {
  const { user, session } = useAuth();
  const toast = useToast();
  // Rendered only in the browser (after login), so storage can be read
  // here. The dashboard remounts this card when the day changes.
  const [cache, setCache] = useState<Cache | null>(() =>
    user ? readCache(user.id, today) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const update = useCallback(
    (next: Cache) => {
      setCache(next);
      if (user) writeCache(user.id, next);
    },
    [user]
  );

  const load = useCallback(async () => {
    if (!session || !user) return;
    setLoading(true);
    setError("");
    try {
      const data = await postAI<{ suggestions: Suggestion[] }>(session, "/api/coach", {
        mode: "suggest",
        ...nowFields(),
      });
      update({ date: today, items: data.suggestions, handled: [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, user, today, update]);

  // No suggestions yet today: fetch them once
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (cache || autoLoaded.current || !session) return;
    autoLoaded.current = true;
    load();
  }, [cache, session, load]);

  const handle = (id: string) =>
    cache && update({ ...cache, handled: [...cache.handled, id] });

  const add = async (s: Suggestion, schedule: boolean) => {
    if (!user) return;
    setBusy(s.id);
    const when = schedule ? nextFreeSlot(tasks, s.minutes, profile) : { date: today, time: null };
    if (!when) {
      setBusy(null);
      toast("Your next 7 days are full. Add it without a time instead.", { tone: "error" });
      return;
    }
    const task = await addSuggestion(user.id, s, when);
    setBusy(null);
    if (!task) {
      toast("Couldn't add the task. Try again.", { tone: "error" });
      return;
    }
    handle(s.id);
    notifyTasksChanged();
    const where = when.time
      ? `${when.date === today ? "today" : formatDate(when.date)} at ${when.time}`
      : "today";
    toast(`Added “${s.title}” ${where}`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await deleteTask(task.id);
          if (cache) update({ ...cache, handled: cache.handled.filter((h) => h !== s.id) });
          notifyTasksChanged();
        },
      },
    });
  };

  const ignore = (s: Suggestion) => {
    handle(s.id);
    if (user && s.area) recordIgnored(user.id, s.area);
    toast("Got it. I'll suggest that less often.");
  };

  const visible = cache?.items.filter((s) => !cache.handled.includes(s.id)) ?? [];

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-grad-from to-grad-to text-white">
            <SparklesIcon className="h-4 w-4" />
          </span>
          AI Suggestions
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
        >
          {loading && <Spinner className="h-3.5 w-3.5" />}
          {loading ? "Thinking…" : "Refresh"}
        </button>
      </div>

      {loading && !cache ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : error && !visible.length ? (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      ) : visible.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted">
          {cache?.items.length ? "All done with today's suggestions 🎉" : "No suggestions yet."}
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
                <button
                  onClick={() => add(s, false)}
                  disabled={busy === s.id}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Add task
                </button>
                <button
                  onClick={() => add(s, true)}
                  disabled={busy === s.id}
                  className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent disabled:opacity-60"
                >
                  Schedule
                </button>
                <button
                  onClick={() => ignore(s)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
                >
                  Ignore
                </button>
                {s.why && (
                  <button
                    onClick={() => setOpenWhy(openWhy === s.id ? null : s.id)}
                    aria-expanded={openWhy === s.id}
                    className="ml-auto rounded-lg px-2 py-1.5 text-sm font-medium text-muted hover:text-accent"
                  >
                    Why am I seeing this?
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
