"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { queueAssistantPrompt } from "@/lib/persona/client";
import { allToTomorrow, fitIntoWeek, letGo, missedTasks } from "@/lib/recovery";
import { scheduleInput } from "@/lib/schedule";
import { updateTasks } from "@/lib/queries/tasks";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/ui";
import type { AIProfile } from "@/types/persona";
import type { Assessment, Project } from "@/types/project";
import type { Task } from "@/types/task";

// "3 tasks from before today didn't happen": one tap to fit them into the
// coming days (no AI), move them all to tomorrow, or let them go. The AI
// is only for rebalancing the whole week.
export default function RecoveryCard({
  tasks,
  today,
  profile,
  projects,
  assessments,
}: {
  tasks: Task[];
  today: string;
  profile: AIProfile | null;
  projects: Project[];
  assessments: Assessment[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const missed = missedTasks(tasks, today);
  if (!missed.length) return null;

  const run = async (label: string, changes: { id: string; fields: Partial<Task> }[], message: string) => {
    setBusy(label);
    const before = changes.map(({ id }) => {
      const t = missed.find((m) => m.id === id)!;
      return {
        id,
        fields: { due_date: t.due_date, due_time: t.due_time, end_time: t.end_time, status: t.status },
      };
    });
    const ok = await updateTasks(changes);
    setBusy(null);
    notifyTasksChanged();
    if (!ok) return toast("Couldn't update everything. Try again.", { tone: "error" });
    toast(message, {
      action: {
        label: "Undo",
        onClick: async () => {
          await updateTasks(before);
          notifyTasksChanged();
        },
      },
    });
  };

  const fit = () => {
    const now = new Date();
    const { changes, unplaced } = fitIntoWeek(
      missed,
      scheduleInput(profile, tasks),
      today,
      now.getHours() * 60 + now.getMinutes() + 10,
      { projects, assessments }
    );
    if (!changes.length) {
      toast("There's no free time this week for these. Try moving them to tomorrow or letting some go.", {
        tone: "error",
      });
      return;
    }
    run(
      "fit",
      changes,
      `Fitted ${changes.length} task${changes.length > 1 ? "s" : ""} into your free time${
        unplaced.length ? ` (${unplaced.length} didn't fit)` : ""
      }.`
    );
  };

  return (
    <section className="rounded-2xl border border-warn/30 bg-warn-soft/50 p-4">
      <p className="font-semibold text-ink">
        ⏰ {missed.length} task{missed.length > 1 ? "s" : ""} from before today didn&apos;t happen
      </p>
      <p className="mt-0.5 truncate text-sm text-muted">
        {missed
          .slice(0, 3)
          .map((t) => t.title)
          .join(" · ")}
        {missed.length > 3 && ` +${missed.length - 3} more`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={fit}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "fit" && <Spinner className="h-3.5 w-3.5" />}
          Fit into free time
        </button>
        <button
          onClick={() => run("tomorrow", allToTomorrow(missed, today), "Moved to tomorrow.")}
          disabled={busy !== null}
          className="rounded-xl bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-card disabled:opacity-60"
        >
          All to tomorrow
        </button>
        <button
          onClick={() => run("skip", letGo(missed), `Let go of ${missed.length} task${missed.length > 1 ? "s" : ""}.`)}
          disabled={busy !== null}
          className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
        >
          Let them go
        </button>
        <button
          onClick={() => {
            queueAssistantPrompt("Rebalance my week around the tasks I missed.");
            router.push("/assistant");
          }}
          className="rounded-xl px-3 py-2 text-sm font-medium text-accent hover:underline"
        >
          ✨ Rebalance my week
        </button>
      </div>
    </section>
  );
}
