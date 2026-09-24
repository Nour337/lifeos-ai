"use client";

import { useCallback } from "react";
import { useToast } from "@/components/Toast";
import {
  deleteTask,
  restoreTask,
  setTaskDueDate,
  toggleTaskStatus,
} from "@/lib/queries/tasks";
import { describeDue, toLocalDateString } from "@/utils/date";
import type { Task } from "@/types/task";

// Tick / delete with instant UI updates, error messages, and Undo.
// Shared by every screen that shows tasks.
export function useTaskActions(
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>,
  refresh: () => void
) {
  const toast = useToast();

  const toggle = useCallback(
    async (task: Task) => {
      const isRepeatCompletion = task.repeat && task.status !== "done";
      if (!isRepeatCompletion) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, status: task.status === "done" ? "todo" : "done" }
              : t
          )
        );
      }

      const result = await toggleTaskStatus(task);
      if (!result.ok) {
        toast("Couldn't update the task. Try again.", { tone: "error" });
        refresh();
        return;
      }

      if (result.movedTo) {
        const next = describeDue(result.movedTo, toLocalDateString()).label;
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, due_date: result.movedTo! } : t))
        );
        toast(`Done! Next one: ${next}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              if (!(await setTaskDueDate(task.id, result.previousDueDate ?? null))) {
                toast("Couldn't undo. Try again.", { tone: "error" });
              }
              refresh();
            },
          },
        });
      }
    },
    [setTasks, refresh, toast]
  );

  const remove = useCallback(
    async (task: Task) => {
      setTasks((prev) => prev.filter((t) => t.id !== task.id));

      if (!(await deleteTask(task.id))) {
        toast("Couldn't delete the task. Try again.", { tone: "error" });
        refresh();
        return;
      }

      toast("Task deleted", {
        action: {
          label: "Undo",
          onClick: async () => {
            if (!(await restoreTask(task))) {
              toast("Couldn't restore the task.", { tone: "error" });
            }
            refresh();
          },
        },
      });
    },
    [setTasks, refresh, toast]
  );

  return { toggle, remove };
}
