export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done" | "skipped" | "rescheduled";
export type TaskRepeat = "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null; // ISO date string, e.g. "2026-08-15"
  due_time: string | null; // start time "HH:MM:SS", or null for "anytime"
  end_time: string | null; // "HH:MM:SS"
  estimated_duration: number | null; // minutes
  category: string | null;
  project_id: string | null;
  goal_id: string | null;
  parent_id: string | null; // set on subtasks
  progress: number; // 0-100, manual when a task has no subtasks
  repeat: TaskRepeat | null;
  created_at: string; // ISO timestamp
}

export const statusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Completed",
  skipped: "Skipped",
  rescheduled: "Rescheduled",
};

// "Open" = still needs doing. Skipped tasks are closed without being done.
export function isOpen(task: Pick<Task, "status">): boolean {
  return task.status !== "done" && task.status !== "skipped";
}

export function isDone(task: Pick<Task, "status">): boolean {
  return task.status === "done";
}
