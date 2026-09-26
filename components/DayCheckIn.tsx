"use client";

import { useState } from "react";
import { setTaskStatus, updateTasks } from "@/lib/queries/tasks";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { addDays, describeDue, formatDuration } from "@/utils/date";
import { loadOf, scheduleInput } from "@/lib/schedule";
import { isOpen, type Task } from "@/types/task";
import type { AIProfile } from "@/types/persona";

type Deadline = { id: string; name: string; date: string };

const dismissKey = (kind: string, day: string) => `lifeos-${kind}-${day}`;

function dismissed(kind: string, day: string): boolean {
  try {
    return localStorage.getItem(dismissKey(kind, day)) === "1";
  } catch {
    return false;
  }
}

// The daily loop, without AI: a morning brief (what today holds) and an
// evening check-in (tick off or move what's left in 30 seconds).
export default function DayCheckIn({
  tasks,
  today,
  hour,
  profile,
  deadlines,
}: {
  tasks: Task[];
  today: string;
  hour: number;
  profile: AIProfile | null;
  deadlines: Deadline[];
}) {
  const toast = useToast();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const todays = tasks
    .filter((t) => t.due_date === today && !t.parent_id)
    .sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
  const open = todays.filter(isOpen);

  const kind = hour < 12 ? "brief" : hour >= 18 && open.length ? "checkin" : null;
  if (!kind || hidden[kind] || dismissed(kind, today)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(kind, today), "1");
    } catch {
      // storage blocked: hide for this visit only
    }
    setHidden((h) => ({ ...h, [kind]: true }));
  };

  if (kind === "brief") {
    const load = loadOf(scheduleInput(profile, tasks), today);
    const first = open.find((t) => t.due_time);
    const routines = open.filter((t) => t.series_id).length;
    const soon = deadlines.filter((d) => d.date >= today && d.date <= addDays(today, 7)).slice(0, 2);
    return (
      <section className="rounded-2xl bg-hero p-4 text-hero-ink shadow-card">
        <div className="flex items-start justify-between gap-3">
          <p className="font-semibold">☀️ Your day</p>
          <button onClick={dismiss} className="text-xs opacity-70 hover:opacity-100">
            Got it
          </button>
        </div>
        <ul className="mt-2 space-y-1 text-sm opacity-90">
          <li>
            {open.length
              ? `${open.length} task${open.length > 1 ? "s" : ""} today${routines ? ` (${routines} routine${routines > 1 ? "s" : ""})` : ""}`
              : "Nothing planned yet — tell the assistant what you want to get done."}
          </li>
          {first && (
            <li>
              First: {first.title} at {first.due_time!.slice(0, 5)}
            </li>
          )}
          {load.capacity > 0 && load.planned > 0 && (
            <li className={load.over ? "font-semibold text-warn" : ""}>
              {formatDuration(load.planned)} of work planned for ~{formatDuration(load.capacity)} of realistic time
              {load.over ? " — consider moving something." : "."}
            </li>
          )}
          {soon.map((d) => (
            <li key={d.id}>
              🏁 {d.name}: {describeDue(d.date, today).label.toLowerCase()}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const act = async (task: Task, action: "done" | "tomorrow" | "skip") => {
    setHidden((h) => ({ ...h, [task.id]: true }));
    const ok =
      action === "done"
        ? await setTaskStatus(task.id, "done")
        : action === "skip"
          ? await setTaskStatus(task.id, "skipped")
          : await updateTasks([{ id: task.id, fields: { due_date: addDays(today, 1) } }]);
    if (!ok) toast("Couldn't update the task. Try again.", { tone: "error" });
    notifyTasksChanged();
  };

  const left = open.filter((t) => !hidden[t.id]);
  if (!left.length) return null;

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">🌙 How did today go?</p>
          <p className="text-sm text-muted">Tick off or move what&apos;s left. It helps your AI plan better.</p>
        </div>
        <button onClick={dismiss} className="text-xs text-muted hover:text-ink">
          Later
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {left.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-xl bg-surface-2/60 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{t.title}</span>
            <button
              onClick={() => act(t, "done")}
              className="rounded-lg bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok"
              aria-label={`Done: ${t.title}`}
            >
              ✓ Done
            </button>
            {!t.series_id && (
              <button
                onClick={() => act(t, "tomorrow")}
                className="rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
                aria-label={`Move to tomorrow: ${t.title}`}
              >
                Tomorrow
              </button>
            )}
            <button
              onClick={() => act(t, "skip")}
              className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:text-ink"
              aria-label={`Skip: ${t.title}`}
            >
              Skip
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
