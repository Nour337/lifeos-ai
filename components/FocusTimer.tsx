"use client";

import { useEffect, useState } from "react";
import { setTaskStatus } from "@/lib/queries/tasks";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { Button, Modal } from "@/components/ui";
import type { Task } from "@/types/task";

const pad = (n: number) => String(n).padStart(2, "0");

// A simple focus timer. Starting it marks the task "in progress" (the
// database records when); finishing marks it done. The real start and
// finish times teach the AI how long things actually take.
export default function FocusTimer({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const toast = useToast();
  const planned = (task?.estimated_duration ?? 25) * 60;
  const [left, setLeft] = useState(planned);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (left === 0 && running) {
      toast(`Time's up for “${task?.title}”. Done, or a few more minutes?`);
      try {
        new Notification("Focus session done", { body: task?.title ?? "" });
      } catch {
        // notifications not allowed: the toast is enough
      }
    }
  }, [left, running, task?.title, toast]);

  if (!task) return null;

  const start = async () => {
    setRunning(true);
    if (task.status !== "in_progress") {
      await setTaskStatus(task.id, "in_progress");
      notifyTasksChanged();
    }
  };

  const finish = async () => {
    setRunning(false);
    if (!(await setTaskStatus(task.id, "done"))) {
      toast("Couldn't save. Try again.", { tone: "error" });
      return;
    }
    notifyTasksChanged();
    toast(`Done: ${task.title} 🎉`);
    onClose();
  };

  const over = left < 0;
  const abs = Math.abs(left);

  return (
    <Modal open title="Focus" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <p className="text-sm text-muted">{task.title}</p>
        <p
          className={`mt-3 text-6xl font-bold tabular-nums tracking-tight ${over ? "text-warn" : "text-ink"}`}
          role="timer"
          aria-live="off"
        >
          {over ? "+" : ""}
          {pad(Math.floor(abs / 60))}:{pad(abs % 60)}
        </p>
        <p className="mt-1 text-xs text-muted">
          {over ? "Over the planned time" : `Planned: ${Math.round(planned / 60)} min`}
        </p>
        <div className="mt-6 grid w-full grid-cols-2 gap-2">
          {running ? (
            <Button variant="secondary" onClick={() => setRunning(false)}>
              Pause
            </Button>
          ) : (
            <Button onClick={start}>{left === planned ? "Start" : "Resume"}</Button>
          )}
          <Button variant={running ? "primary" : "secondary"} onClick={finish}>
            Done ✓
          </Button>
        </div>
        <button onClick={() => setLeft((s) => s + 5 * 60)} className="mt-3 text-sm font-medium text-accent hover:underline">
          +5 minutes
        </button>
      </div>
    </Modal>
  );
}
