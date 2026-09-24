import { supabase } from "@/lib/supabaseClient";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";

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

// How many AI questions are left today. The limit resets at midnight UTC,
// matching current_date in consume_ai_credit().
export async function getAICreditsLeft(userId: string): Promise<number | null> {
  const utcToday = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("ai_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("day", utcToday)
    .maybeSingle();

  if (error) {
    console.error("Error fetching AI usage:", error.message);
    return null;
  }

  return Math.max(0, AI_DAILY_LIMIT - (data?.count ?? 0));
}
