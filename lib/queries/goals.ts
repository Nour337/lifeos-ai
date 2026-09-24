import { supabase } from "@/lib/supabaseClient";
import type { Goal } from "@/types/goal";

export async function getGoals(): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching goals:", error.message);
    throw new Error("Couldn't load your goals.");
  }

  return data as Goal[];
}

export async function getGoalById(id: string): Promise<Goal | null> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // No row = not found (null); a real error should surface as an error
  if (error) {
    console.error("Error fetching goal:", error.message);
    throw new Error("Couldn't load this goal.");
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