import { supabase } from "@/lib/supabaseClient";
import { DEFAULT_DAILY_POINTS, type Budget } from "@/lib/ai/budget";

// The profiles table stores extra user info; a missing row is normal for
// accounts created before profiles existed, so fall back to null quietly.
export async function getDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching profile:", error.message);
    return null;
  }

  return data?.display_name?.trim() || null;
}

export async function saveDisplayName(
  userId: string,
  displayName: string
): Promise<boolean> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: displayName.trim() || null });

  if (error) {
    console.error("Error saving profile:", error.message);
    return false;
  }

  return true;
}

// Today's AI points (the day follows the user's timezone, like the server)
export async function getAIBudget(): Promise<(Budget & { used: number; plan: string }) | null> {
  const { data, error } = await supabase.rpc("get_ai_budget");
  if (error) {
    console.error("Error fetching AI budget:", error.message);
    return null;
  }
  const used = Number(data?.used ?? 0);
  const limit = Number(data?.limit ?? DEFAULT_DAILY_POINTS);
  return { used, limit, remaining: Math.max(0, limit - used), plan: String(data?.plan ?? "free") };
}
