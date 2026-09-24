export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskRepeat = "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null; // ISO date string, e.g. "2026-08-15"
  estimated_duration: number | null; // minutes
  category: string | null;
  project_id: string | null;
  goal_id: string | null;
  repeat: TaskRepeat | null;
  created_at: string; // ISO timestamp
}