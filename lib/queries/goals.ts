import { supabase } from "@/lib/supabaseClient";
import type { Goal } from "@/types/goal";

export async function getGoals(): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching goals:", error.message);
    return [];
  }

  return data as Goal[];
}

export async function getGoalById(id: string): Promise<Goal | null> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching goal:", error.message);
    return null;
  }

  return data as Goal;
}

export async function deleteGoal(id: string): Promise<boolean> {
  const { error } = await supabase.from("goals").delete().eq("id", id);

  if (error) {
    console.error("Error deleting goal:", error.message);
    return false;
  }

  return true;
}