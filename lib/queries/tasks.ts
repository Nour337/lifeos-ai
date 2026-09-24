import { supabase } from "@/lib/supabaseClient";
import {
  minutesToTime,
  nextOccurrence,
  timeToMinutes,
  toLocalDateString,
} from "@/utils/date";
import { isOpen, type Task, type TaskStatus } from "@/types/task";

// Loaders throw so screens can show "Couldn't load..." instead of looking
// empty. Mutations return false on failure so callers can show a message.

export async function getTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("parent_id", null) // subtasks are shown inside their parent
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching tasks:", error.message);
    throw new Error("Couldn't load your tasks.");
  }

  return data as Task[];
}

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .is("parent_id", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching project tasks:", error.message);
    throw new Error("Couldn't load this project's tasks.");
  }

  return data as Task[];
}

export async function deleteTask(id: string): Promise<boolean> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);

  if (error) {
    console.error("Error deleting task:", error.message);
    return false;
  }

  return true;
}

// Puts a deleted task back exactly as it was (used by "Undo").
export async function restoreTask(task: Task): Promise<boolean> {
  const { error } = await supabase.from("tasks").insert(task);

  if (error) {
    console.error("Error restoring task:", error.message);
    return false;
  }

  return true;
}

export type ToggleResult =
  | { ok: false }
  | { ok: true; movedTo?: string; previousDueDate?: string | null };

// Ticking a repeating task doesn't mark it done: it moves to its next date,
// so there is always exactly one copy of it.
export async function toggleTaskStatus(task: Task): Promise<ToggleResult> {
  if (task.repeat && isOpen(task)) {
    const today = toLocalDateString();
    const movedTo = nextOccurrence(task.due_date ?? today, task.repeat, today);
    const { error } = await supabase
      .from("tasks")
      .update({ due_date: movedTo, status: "todo" })
      .eq("id", task.id);

    if (error) {
      console.error("Error advancing repeating task:", error.message);
      return { ok: false };
    }
    return { ok: true, movedTo, previousDueDate: task.due_date };
  }

  const newStatus: TaskStatus = task.status === "done" ? "todo" : "done";
  const { error } = await supabase
    .from("tasks")
    .update({ status: newStatus })
    .eq("id", task.id);

  if (error) {
    console.error("Error toggling task status:", error.message);
    return { ok: false };
  }

  return { ok: true };
}

// Used by calendar drag and drop. `time` undefined = keep the time,
// null = make it an "anytime" task. The duration is kept when moving.
export async function moveTask(
  task: Task,
  date: string,
  time?: string | null
): Promise<Partial<Task> | null> {
  const changes: Partial<Task> = { due_date: date };
  if (time !== undefined) {
    changes.due_time = time;
    changes.end_time = null;
    if (time && task.due_time && task.end_time) {
      const length = timeToMinutes(task.end_time) - timeToMinutes(task.due_time);
      if (length > 0) changes.end_time = minutesToTime(timeToMinutes(time) + length);
    }
  }

  const { error } = await supabase.from("tasks").update(changes).eq("id", task.id);
  if (error) {
    console.error("Error moving task:", error.message);
    return null;
  }
  return changes;
}

export async function setTaskDueDate(
  id: string,
  dueDate: string | null
): Promise<boolean> {
  const { error } = await supabase
    .from("tasks")
    .update({ due_date: dueDate })
    .eq("id", id);

  if (error) {
    console.error("Error updating due date:", error.message);
    return false;
  }

  return true;
}
