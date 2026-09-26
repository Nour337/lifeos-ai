"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { postAI, queueAssistantPrompt } from "@/lib/persona/client";
import { useToast } from "@/components/Toast";
import { ErrorState, Skeleton, Spinner } from "@/components/ui";
import { SparklesIcon } from "@/components/icons";
import { addDays, formatDate, formatDuration, getWeekDays, toLocalDateString } from "@/utils/date";
import type { AreaProgress, WeeklyReview } from "@/lib/persona/types";
import { roleOf } from "@/types/persona";

type Which = "last" | "this";

function weekStartOf(which: Which, today: string) {
  const monday = getWeekDays(today)[0];
  return which === "this" ? monday : addDays(monday, -7);
}

export default function ReviewPage() {
  const { user, session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const today = toLocalDateString();
  // On Sunday the current week is (almost) over, so review it
  const [which, setWhich] = useState<Which>(() => (new Date().getDay() === 0 ? "this" : "last"));
  const weekStart = weekStartOf(which, today);
  const [reviews, setReviews] = useState<Record<string, WeeklyReview | null>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const tried = useRef(new Set<string>());

  const generate = useCallback(
    async (start: string) => {
      if (!session) return;
      setGenerating(true);
      setError("");
      try {
        const data = await postAI<{ review: WeeklyReview }>(session, "/api/coach", { mode: "review", weekStart: start });
        setReviews((prev) => ({ ...prev, [start]: data.review }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setGenerating(false);
      }
    },
    [session]
  );

  // Load the saved review for this week, or create it once
  useEffect(() => {
    if (!user || weekStart in reviews) return;
    supabase
      .from("weekly_reviews")
      .select("review")
      .eq("week_start", weekStart)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError("Couldn't load your review.");
          return;
        }
        const saved = (data?.review as WeeklyReview | undefined) ?? null;
        setReviews((prev) => ({ ...prev, [weekStart]: saved }));
        if (!saved && !tried.current.has(weekStart)) {
          tried.current.add(weekStart);
          generate(weekStart);
        }
      });
  }, [user, weekStart, reviews, generate]);

  const saveProgress = async (area: AreaProgress, value: number) => {
    const { error: saveError } = await supabase
      .from(area.type === "project" ? "projects" : "goals")
      .update({ progress: value, progress_manual: true })
      .eq("id", area.id);
    if (saveError) {
      toast("Couldn't save progress.", { tone: "error" });
      return;
    }
    setReviews((prev) => {
      const review = prev[weekStart];
      if (!review) return prev;
      return {
        ...prev,
        [weekStart]: {
          ...review,
          stats: {
            ...review.stats,
            progress: review.stats.progress.map((p) => (p.id === area.id ? { ...p, now: value } : p)),
          },
        },
      };
    });
    toast(`${area.name}: ${value}%`);
  };

  const review = reviews[weekStart];
  const loading = !(weekStart in reviews) || (generating && !review);

  const planNextWeek = () => {
    if (!review) return;
    queueAssistantPrompt(
      `Plan my next week based on my weekly review.${
        review.ai.suggestions.length ? ` Your recommendations were: ${review.ai.suggestions.join(" ")}` : ""
      }`
    );
    router.push("/assistant");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Your week</h1>
          <p className="mt-0.5 text-muted">
            {formatDate(weekStart)} – {formatDate(addDays(weekStart, 6))}
          </p>
        </div>
        <div className="flex rounded-xl bg-surface p-1 shadow-card" role="tablist">
          {(["last", "this"] as Which[]).map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={which === w}
              onClick={() => setWhich(w)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                which === w ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {w === "last" ? "Last week" : "This week"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-2xl bg-surface p-4 text-sm text-muted shadow-card">
            <Spinner className="h-4 w-4 text-accent" />
            Your AI is reviewing your week…
          </div>
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : !review ? (
        error ? (
          <ErrorState message={error} onRetry={() => generate(weekStart)} />
        ) : (
          <button
            onClick={() => generate(weekStart)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-grad-from to-grad-to font-semibold text-white shadow-lg shadow-accent/30"
          >
            <SparklesIcon className="h-5 w-5" />
            Create my weekly review · 2 points
          </button>
        )
      ) : (
        <>
          <section className="rounded-2xl bg-hero p-5 text-hero-ink shadow-card">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider opacity-70">
              <SparklesIcon className="h-3.5 w-3.5" />
              AI weekly review
            </p>
            <p className="mt-2 text-lg font-semibold leading-snug">{review.ai.headline}</p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <Stat value={`${review.stats.completed}`} label={`of ${review.stats.planned} done`} />
              <Stat value={formatDuration(review.stats.minutes || 0) || "0m"} label="focused" />
              <Stat value={`${review.stats.missed.length}`} label="missed" />
            </div>
            {(review.stats.moved ?? 0) > 0 && (
              <p className="mt-3 text-center text-sm opacity-75">
                Postponed {review.stats.moved} time{review.stats.moved > 1 ? "s" : ""} this week
              </p>
            )}
          </section>

          {review.stats.byKind.length > 0 && (
            <Card title="Completed" emoji="✅">
              <div className="flex flex-wrap gap-2">
                {review.stats.byKind.map((k) => (
                  <span key={k.label} className="rounded-full bg-ok-soft px-3 py-1.5 text-sm font-medium text-ok">
                    {k.count} {k.label}
                  </span>
                ))}
              </div>
              {review.stats.byArea.length > 0 && (
                <ul className="mt-4 space-y-2.5">
                  {review.stats.byArea.map((a) => {
                    const max = Math.max(...review.stats.byArea.map((x) => x.minutes), 1);
                    return (
                      <li key={a.name}>
                        <div className="mb-1 flex justify-between gap-2 text-sm">
                          <span className="truncate text-ink">{a.name}</span>
                          <span className="shrink-0 text-muted">
                            {a.count} · {formatDuration(a.minutes)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-ok" style={{ width: `${(a.minutes / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {review.stats.balance && review.stats.balance.length > 0 && (
            <Card title="Life balance" emoji="⚖️">
              <p className="mb-3 text-sm text-muted">Where your finished work went, by role{review.stats.balance.some((b) => b.target !== null) ? ", against the split you want" : ""}.</p>
              <ul className="space-y-3">
                {review.stats.balance.map((b) => (
                  <li key={b.role}>
                    <div className="mb-1 flex justify-between gap-2 text-sm">
                      <span className="text-ink">
                        {roleOf(b.role).emoji} {roleOf(b.role).label}
                      </span>
                      <span className="text-muted">
                        {b.share}% · {formatDuration(b.minutes || 0)}
                        {b.target !== null && (
                          <span className={Math.abs(b.share - b.target) > 15 ? "ml-1 font-semibold text-warn" : "ml-1"}>
                            (want {b.target}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${b.share}%` }} />
                      {b.target !== null && (
                        <span className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: `${b.target}%` }} aria-hidden="true" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(review.stats.routines ?? []).length > 0 && (
            <Card title="Routines" emoji="🔁">
              <ul className="space-y-1.5">
                {review.stats.routines.map((r) => (
                  <li key={r.title} className="flex justify-between gap-3 text-sm">
                    <span className="truncate text-ink">{r.title}</span>
                    <span className={`shrink-0 font-medium ${r.done === r.total ? "text-ok" : "text-muted"}`}>
                      {r.done} of {r.total}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {review.stats.missed.length > 0 && (
            <Card title="Missed" emoji="⏰">
              <ul className="space-y-1.5">
                {review.stats.missed.map((m, i) => (
                  <li key={i} className="flex justify-between gap-3 text-sm">
                    <span className="truncate text-ink">{m.title}</span>
                    <span className="shrink-0 text-muted">{formatDate(m.date)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {review.stats.progress.length > 0 && (
            <Card title="Progress" emoji="📈">
              <p className="mb-3 text-sm text-muted">Slide to update where you are now. Next week&apos;s review compares with it.</p>
              <ul className="space-y-4">
                {review.stats.progress.map((p) => (
                  <ProgressRow key={p.id} area={p} onSave={(v) => saveProgress(p, v)} />
                ))}
              </ul>
            </Card>
          )}

          {review.ai.highlights.length > 0 && (
            <Card title="What went well" emoji="🌟">
              <ul className="space-y-1.5">
                {review.ai.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-ink">
                    <span className="text-ok">•</span>
                    {h}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {review.ai.suggestions.length > 0 && (
            <Card title="AI suggestions for next week" emoji="✨">
              <ul className="space-y-2">
                {review.ai.suggestions.map((s) => (
                  <li key={s} className="rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-ink">
                    {s}
                  </li>
                ))}
              </ul>
              <button
                onClick={planNextWeek}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-grad-from to-grad-to font-semibold text-white shadow-md shadow-accent/30"
              >
                <SparklesIcon className="h-4 w-4" />
                Plan next week with AI
              </button>
            </Card>
          )}

          <div className="flex items-center justify-center gap-3 text-xs text-muted">
            <span>Made {new Date(review.generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            <button
              onClick={() => generate(weekStart)}
              disabled={generating}
              className="flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-50"
            >
              {generating && <Spinner className="h-3 w-3" />}
              Refresh · 2 points
            </button>
          </div>
          {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-2 py-3">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs opacity-70">{label}</p>
    </div>
  );
}

function Card({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
        <span aria-hidden="true">{emoji}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProgressRow({ area, onSave }: { area: AreaProgress; onSave: (value: number) => void }) {
  const [value, setValue] = useState(area.now);
  const change = area.before !== null ? area.now - area.before : null;
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium text-ink">{area.name}</span>
        <span className="shrink-0 tabular-nums text-muted">
          {area.before !== null && `${area.before}% → `}
          <span className="font-semibold text-ink">{value}%</span>
          {change !== null && change !== 0 && (
            <span className={change > 0 ? "ml-1 text-ok" : "ml-1 text-danger"}>
              {change > 0 ? `+${change}` : change}
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => value !== area.now && onSave(value)}
        onKeyUp={() => value !== area.now && onSave(value)}
        aria-label={`${area.name} progress`}
        className="w-full accent-[var(--accent)]"
      />
    </li>
  );
}
