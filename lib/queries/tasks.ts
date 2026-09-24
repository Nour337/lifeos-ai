import { supabase } from "@/lib/supabaseClient";
import { nextOccurrence, toLocalDateString } from "@/utils/date";
import type { Task, TaskStatus } from "@/types/task";

// Loaders throw so screens can show "Couldn't load..." instead of looking
// empty. Mutations return false on failure so callers can show a message.

export async function getTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
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
  if (task.repeat && task.status !== "done") {
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
