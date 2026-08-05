import { supabase } from "@/lib/supabaseClient";
import type { Task } from "@/types/task";

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