import { supabase } from "@/lib/supabaseClient";

// The profiles table stores extra user info; a missing row is normal for
// accounts created before profiles existed, so fall back to null quietly.
export async function getDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching profile:", error.message);
    return null;
  }

  return data?.display_name ?? data?.full_name ?? data?.name ?? null;
}
