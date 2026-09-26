"use client";

import { useCallback } from "react";
import { useToast } from "@/components/Toast";
import { getSubtasks } from "@/lib/queries/subtasks";
import { deleteTask, restoreTask, setTaskStatus, toggleTaskStatus } from "@/lib/queries/tasks";
import type { Task, TaskStatus } from "@/types/task";

// Tick / skip / delete with instant UI updates, error messages, and Undo.
// Shared by every screen that shows tasks. Routine sessions are ordinary
// tasks: ticking one records it done; deleting one skips that day.
export function useTaskActions(
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>,
  refresh: () => void
) {
  const toast = useToast();

  const setStatus = useCallback(
    async (task: Task, status: TaskStatus) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
      if (!(await setTaskStatus(task.id, status))) {
        toast("Couldn't update the task. Try again.", { tone: "error" });
        refresh();
      }
    },
    [setTasks, refresh, toast]
  );

  const toggle = useCallback(
    async (task: Task) => {
      const status: TaskStatus = task.status === "done" ? "todo" : "done";
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
      if (!(await toggleTaskStatus(task))) {
        toast("Couldn't update the task. Try again.", { tone: "error" });
        refresh();
      }
    },
    [setTasks, refresh, toast]
  );

  const remove = useCallback(
    async (task: Task) => {
      setTasks((prev) => prev.filter((t) => t.id !== task.id));

      // Subtasks are deleted with their parent, so keep a copy for Undo
      const subtasks = await getSubtasks(task.id).catch(() => [] as Task[]);

      if (!(await deleteTask(task.id))) {
        toast("Couldn't delete the task. Try again.", { tone: "error" });
        refresh();
        return;
      }

      toast(task.series_id ? "Session removed (the routine continues)" : "Task deleted", {
        action: {
          label: "Undo",
          onClick: async () => {
            const restored =
              (await restoreTask(task)) &&
              (await Promise.all(subtasks.map(restoreTask))).every(Boolean);
            if (!restored) {
              toast("Couldn't fully restore the task.", { tone: "error" });
            }
            refresh();
          },
        },
      });
    },
    [setTasks, refresh, toast]
  );

  return { toggle, remove, setStatus };
}
