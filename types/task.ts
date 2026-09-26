import type { Pattern } from "@/lib/assistant/patterns";

// One priority scale for tasks, goals and projects
export type TaskPriority = "low" | "medium" | "high" | "very_high";
export type TaskStatus = "todo" | "in_progress" | "done" | "skipped";
export type TaskEnergy = "deep" | "light";
export type TaskSource = "user" | "ai" | "suggestion" | "system";

export const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "very_high"];

export const priorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
};

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
  energy: TaskEnergy | null; // deep focus or light work
  is_fixed: boolean; // an appointment / exam: can't be moved by the planner
  source: TaskSource;
  series_id: string | null; // an occurrence of a routine or repeating task
  occurrence_date: string | null; // the day the series scheduled it (due_date may move)
  started_at: string | null; // set by the database when it goes in progress
  completed_at: string | null; // set by the database when it's done
  created_at: string; // ISO timestamp
}

// A routine or repeating task (see lib/series.ts)
export interface Series {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  pattern: Pattern;
  start_date: string;
  until: string | null;
  count: number | null;
  due_time: string | null;
  end_time: string | null;
  estimated_duration: number | null;
  priority: TaskPriority;
  category: string | null;
  energy: TaskEnergy | null;
  project_id: string | null;
  goal_id: string | null;
  is_routine: boolean;
  exceptions: string[];
  created_at: string;
  updated_at: string;
}

export type TaskEvent = {
  id: number;
  task_id: string | null;
  series_id: string | null;
  type: "created" | "moved" | "started" | "completed" | "reopened" | "skipped" | "deleted";
  title: string | null;
  from_date: string | null;
  to_date: string | null;
  from_time: string | null;
  to_time: string | null;
  source: "user" | "ai" | "system";
  created_at: string;
};

export const statusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Completed",
  skipped: "Skipped",
};

// "Open" = still needs doing. Skipped tasks are closed without being done.
export function isOpen(task: Pick<Task, "status">): boolean {
  return task.status !== "done" && task.status !== "skipped";
}

export function isDone(task: Pick<Task, "status">): boolean {
  return task.status === "done";
}

// Rows from the database may predate some columns (or come from an insert
// that didn't return them): fill the defaults so the rest of the app can
// trust the shape.
export function normalizeTask(row: Partial<Task> & { id: string; title: string }): Task {
  return {
    user_id: "",
    description: null,
    priority: "medium",
    status: "todo",
    due_date: null,
    due_time: null,
    end_time: null,
    estimated_duration: null,
    category: null,
    project_id: null,
    goal_id: null,
    parent_id: null,
    progress: 0,
    energy: null,
    is_fixed: false,
    source: "user",
    series_id: null,
    occurrence_date: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    ...row,
  } as Task;
}
