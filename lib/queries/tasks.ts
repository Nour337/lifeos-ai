import { supabase } from "@/lib/supabaseClient";
import type { Task, TaskStatus } from "@/types/task";

export async function getTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching tasks:", error.message);
    return [];
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

export async function toggleTaskStatus(
  id: string,
  currentStatus: TaskStatus
): Promise<boolean> {
  const newStatus: TaskStatus = currentStatus === "done" ? "todo" : "done";

  const { error } = await supabase
    .from("tasks")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    console.error("Error toggling task status:", error.message);
    return false;
  }

  return true;
}

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching project tasks:", error.message);
    return [];
  }

  return data as Task[];
}