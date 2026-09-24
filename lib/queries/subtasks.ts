import { supabase } from "@/lib/supabaseClient";
import type { Task } from "@/types/task";

// Subtasks are ordinary task rows with parent_id set. The parent's
// `progress` column caches "% of subtasks done" so lists can show it
// without loading every subtask.

export async function getSubtasks(parentId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("parent_id", parentId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching subtasks:", error.message);
    throw new Error("Couldn't load subtasks.");
  }
  return data as Task[];
}

export async function addSubtasks(
  parent: Pick<Task, "id" | "user_id">,
  titles: string[]
): Promise<boolean> {
  const rows = titles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => ({
      user_id: parent.user_id,
      parent_id: parent.id,
      title,
      status: "todo",
    }));
  if (rows.length === 0) return true;

  const { error } = await supabase.from("tasks").insert(rows);
  if (error) {
    console.error("Error adding subtasks:", error.message);
    return false;
  }
  return syncParentProgress(parent.id);
}

export async function setSubtaskDone(
  subtask: Task,
  done: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "todo" })
    .eq("id", subtask.id);

  if (error) {
    console.error("Error updating subtask:", error.message);
    return false;
  }
  return subtask.parent_id ? syncParentProgress(subtask.parent_id) : true;
}

export async function deleteSubtask(subtask: Task): Promise<boolean> {
  const { error } = await supabase.from("tasks").delete().eq("id", subtask.id);
  if (error) {
    console.error("Error deleting subtask:", error.message);
    return false;
  }
  return subtask.parent_id ? syncParentProgress(subtask.parent_id) : true;
}

// Recalculate the parent's % complete from its subtasks
export async function syncParentProgress(parentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("tasks")
    .select("status")
    .eq("parent_id", parentId);
  if (error) return false;

  const total = data.length;
  const done = data.filter((s) => s.status === "done").length;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  const { error: updateError } = await supabase
    .from("tasks")
    .update({ progress })
    .eq("id", parentId);
  return !updateError;
}
